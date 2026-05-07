import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import type { GenerationContext, GenerationService } from './generation-flow'
import type { SessionStatus } from '../../db/schema'
import { resolveAddPageContext, executeAddPageGeneration, type AddPageContext } from '../generation/add-page-flow'
import { resolveRetrySinglePageContext, executeRetrySinglePageGeneration, type RetrySinglePageContext } from '../generation/retry-single-page-flow'
import { finalizeGenerationFailure as finalizeAddPageFailure } from '../generation/finalize'

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
    executeRetryFailedPages
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

  ipcMain.handle('generate:addPage', async (_event, payload) => {
    pruneFinishedSessionRunStates()
    const addPagePayload =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const requestedSessionId =
      typeof addPagePayload.sessionId === 'string' ? addPagePayload.sessionId.trim() : ''
    if (!requestedSessionId) {
      throw new Error('sessionId 不能为空')
    }
    const userMsg = typeof addPagePayload.userMessage === 'string' ? addPagePayload.userMessage.trim() : ''
    if (!userMsg) {
      throw new Error('userMessage is required for addPage')
    }

    {
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

    let addPageCtx: AddPageContext | null = null
    try {
      const insertAfter = Number(addPagePayload.insertAfterPageNumber) || 0

      // Resolve context independently — no shared resolveGenerationContext
      addPageCtx = await resolveAddPageContext(ctx, requestedSessionId, userMsg, insertAfter)

      // Persist user message
      await db.addMessage(addPageCtx.sessionId, {
        role: 'user',
        content: userMsg,
        type: 'text',
        chat_scope: 'main' as const
      })

      beginSessionRunState({
        sessionId: addPageCtx.sessionId,
        runId: addPageCtx.runId,
        mode: 'addPage',
        previousSessionStatus: addPageCtx.previousSessionStatus,
        totalPages: 1
      })

      await executeAddPageGeneration(ctx, addPageCtx)
      return { success: true, runId: addPageCtx.runId }
    } catch (error) {
      if (addPageCtx) {
        await finalizeAddPageFailure(ctx, addPageCtx, error)
      }
      throw error
    } finally {
      if (requestedSessionId) {
        startingSessionIds.delete(requestedSessionId)
      }
      if (addPageCtx) {
        agentManager.removeSession(addPageCtx.sessionId)
      }
    }
  })

  ipcMain.handle('generate:retrySinglePage', async (_event, payload) => {
    pruneFinishedSessionRunStates()
    const addPagePayload =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const requestedSessionId =
      typeof addPagePayload.sessionId === 'string' ? addPagePayload.sessionId.trim() : ''
    const requestedPageId =
      typeof addPagePayload.pageId === 'string' ? addPagePayload.pageId.trim() : ''
    if (!requestedSessionId) {
      throw new Error('sessionId 不能为空')
    }
    if (!requestedPageId) {
      throw new Error('pageId 不能为空')
    }

    {
      const runningState = sessionRunStates.get(requestedSessionId)
      if (runningState?.status === 'running') {
        log.info('[generate:retrySinglePage] attach to existing run', {
          sessionId: requestedSessionId,
          runId: runningState.runId
        })
        return { success: true, runId: runningState.runId, alreadyRunning: true }
      }
    }

    let retryCtx: RetrySinglePageContext | null = null
    try {
      retryCtx = await resolveRetrySinglePageContext(ctx, requestedSessionId, requestedPageId)

      beginSessionRunState({
        sessionId: retryCtx.sessionId,
        runId: retryCtx.runId,
        mode: 'retrySinglePage',
        previousSessionStatus: retryCtx.previousSessionStatus,
        totalPages: 1
      })

      await executeRetrySinglePageGeneration(ctx, retryCtx)
      return { success: true, runId: retryCtx.runId }
    } catch (error) {
      if (retryCtx) {
        await finalizeAddPageFailure(ctx, retryCtx as any, error)
      }
      throw error
    } finally {
      if (retryCtx) {
        agentManager.removeSession(retryCtx.sessionId)
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
