import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import type { IpcContext } from './context'
import type { GenerationContext, GenerationService } from './generation-flow'
import type { SessionStatus } from '../db/schema'

function normalizeRestoredSessionStatus(status: unknown): SessionStatus {
  return status === 'completed' || status === 'failed' || status === 'archived' ? status : 'active'
}

export function registerGenerationHandlers(
  ctx: IpcContext,
  generationService: GenerationService
): void {
  const {
    db,
    agentManager,
    sessionRunStates,
    pruneFinishedSessionRunStates,
    beginSessionRunState,
    emitGenerateChunk
  } = ctx
  const {
    resolveGenerationContext,
    finalizeGenerationFailure,
    executeGeneration,
    executeRetryFailedPages,
    executeAddPageGeneration
  } = generationService
  const startingSessionIds = new Set<string>()

  ipcMain.handle('generate:state', async (_event, rawSessionId: unknown) => {
    pruneFinishedSessionRunStates()
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const activeState = sessionRunStates.get(sessionId)
    if (activeState) {
      return {
        sessionId,
        runId: activeState.runId,
        status: activeState.status,
        hasActiveRun: activeState.status === 'running',
        progress: activeState.progress,
        totalPages: activeState.totalPages,
        events: activeState.events,
        error: activeState.error,
        startedAt: activeState.startedAt,
        updatedAt: activeState.updatedAt
      }
    }

    const session = await db.getSession(sessionId)
    const sessionRecord = (session || {}) as Record<string, unknown>
    const sessionStatus = String(sessionRecord.status || 'active')
    const normalizedStatus =
      sessionStatus === 'completed' ? 'completed' : sessionStatus === 'failed' ? 'failed' : 'idle'
    const pageCount = Number(sessionRecord.page_count ?? sessionRecord.pageCount ?? 1) || 1
    return {
      sessionId,
      runId: null,
      status: normalizedStatus,
      hasActiveRun: false,
      progress: normalizedStatus === 'completed' ? 100 : 0,
      totalPages: Math.max(1, Math.floor(pageCount)),
      events: [],
      error: null,
      startedAt: null,
      updatedAt: null
    }
  })

  ipcMain.handle('generate:start', async (event, payload) => {
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    if (requestedSessionId) {
      const runningState = sessionRunStates.get(requestedSessionId)
      if (runningState?.status === 'running') {
        log.info('[generate:start] attach to existing run', {
          sessionId: requestedSessionId,
          runId: runningState.runId
        })
        return { success: true, runId: runningState.runId, alreadyRunning: true }
      }
      if (startingSessionIds.has(requestedSessionId)) {
        log.info('[generate:start] attach to starting run', {
          sessionId: requestedSessionId
        })
        return { success: true, alreadyRunning: true }
      }
      startingSessionIds.add(requestedSessionId)
    }

    let context: GenerationContext | null = null
    try {
      context = await resolveGenerationContext(event, payload)
      beginSessionRunState({
        sessionId: context.sessionId,
        runId: context.runId,
        mode: context.effectiveMode,
        totalPages: context.totalPages,
        previousSessionStatus: context.previousSessionStatus
      })
      await executeGeneration(context)
      return { success: true, runId: context.runId }
    } catch (error) {
      if (context) {
        await finalizeGenerationFailure(context, error)
      }
      throw error
    } finally {
      if (requestedSessionId) {
        startingSessionIds.delete(requestedSessionId)
      }
      if (context) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:retryFailedPages', async (event, payload) => {
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    if (requestedSessionId) {
      const runningState = sessionRunStates.get(requestedSessionId)
      if (runningState?.status === 'running') {
        log.info('[generate:retryFailedPages] attach to existing run', {
          sessionId: requestedSessionId,
          runId: runningState.runId
        })
        return { success: true, runId: runningState.runId, alreadyRunning: true }
      }
    }

    let context: GenerationContext | null = null
    try {
      const retryPayload =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const retrySupplement =
        typeof retryPayload.userMessage === 'string' && retryPayload.userMessage.trim().length > 0
          ? retryPayload.userMessage.trim()
          : ''
      const retryUserMessage = retrySupplement
        ? [
            '继续生成本会话中未完成的页面。页面正文、标题、图表标签必须保持与现有页面相同语言。',
            'Continue generating the unfinished slides in this session. Keep slide text, titles, and chart labels in the same language as existing slides.',
            'Determine the content language from the existing topic, outline, source materials, existing slides, and the user supplement; do not infer it from this instruction language.',
            `User supplement:\n${retrySupplement}`
          ].join('\n')
        : [
            '继续生成本会话中未完成的页面。页面正文、标题、图表标签必须保持与现有页面相同语言。',
            'Continue generating the unfinished slides in this session. Keep slide text, titles, and chart labels in the same language as existing slides.',
            'Determine the content language from the existing topic, outline, source materials, and existing slides; do not infer it from this instruction language.'
          ].join('\n')
      context = await resolveGenerationContext(
        event,
        {
          ...retryPayload,
          type: 'deck',
          userMessage: retryUserMessage
        },
        { persistUserMessage: false, mode: 'retry' }
      )
      beginSessionRunState({
        sessionId: context.sessionId,
        runId: context.runId,
        mode: 'retry',
        previousSessionStatus: context.previousSessionStatus,
        totalPages: Math.max(
          1,
          (await db.listLatestGenerationPageSnapshot(context.sessionId)).filter(
            (page) => page.status !== 'completed'
          ).length || context.totalPages
        )
      })
      await executeRetryFailedPages(context)
      return { success: true, runId: context.runId }
    } catch (error) {
      if (context) {
        await finalizeGenerationFailure(context, error)
      }
      throw error
    } finally {
      if (context) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:addPage', async (event, payload) => {
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    if (requestedSessionId) {
      const runningState = sessionRunStates.get(requestedSessionId)
      if (runningState?.status === 'running') {
        log.info('[generate:addPage] attach to existing run', {
          sessionId: requestedSessionId,
          runId: runningState.runId
        })
        return { success: true, runId: runningState.runId, alreadyRunning: true }
      }
      if (startingSessionIds.has(requestedSessionId)) {
        log.info('[generate:addPage] attach to starting run', {
          sessionId: requestedSessionId
        })
        return { success: true, alreadyRunning: true }
      }
      startingSessionIds.add(requestedSessionId)
    }

    let context: GenerationContext | null = null
    try {
      const addPagePayload =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const userMsg = typeof addPagePayload.userMessage === 'string' ? addPagePayload.userMessage.trim() : ''
      if (!userMsg) {
        throw new Error('userMessage is required for addPage')
      }
      const insertAfter = Number(addPagePayload.insertAfterPageNumber) || 0
      // Encode insertAfterPageNumber as a prefix so the flow can parse it out
      const flowUserMessage = `[addPage:insertAfter=${insertAfter}]${userMsg}`
      context = await resolveGenerationContext(event, {
        sessionId: requestedSessionId,
        type: 'deck',
        userMessage: flowUserMessage
      }, { persistUserMessage: false, mode: 'addPage' })
      // Persist the clean user message separately
      await db.addMessage(context.sessionId, {
        role: 'user',
        content: userMsg,
        type: 'text',
        chat_scope: 'main' as const
      })
      beginSessionRunState({
        sessionId: context.sessionId,
        runId: context.runId,
        mode: 'addPage',
        previousSessionStatus: context.previousSessionStatus,
        totalPages: context.totalPages + 1
      })
      await executeAddPageGeneration(context)
      return { success: true, runId: context.runId }
    } catch (error) {
      if (context) {
        await finalizeGenerationFailure(context, error)
      }
      throw error
    } finally {
      if (requestedSessionId) {
        startingSessionIds.delete(requestedSessionId)
      }
      if (context) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:cancel', async (_event, sessionId) => {
    agentManager.cancelSession(sessionId)
    const activeState = sessionRunStates.get(sessionId)
    if (activeState?.status === 'running') {
      emitGenerateChunk(sessionId, {
        type: 'run_error',
        payload: {
          runId: activeState.runId,
          message: '生成已取消'
        }
      })
      await db.updateSessionStatus(
        sessionId,
        normalizeRestoredSessionStatus(activeState.previousSessionStatus)
      )
    }
    return { success: true }
  })
}
