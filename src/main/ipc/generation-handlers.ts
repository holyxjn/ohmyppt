import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import type { IpcContext } from './context'
import type { GenerationContext, GenerationService } from './generation-flow'

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
    }

    let context: GenerationContext | null = null
    try {
      context = await resolveGenerationContext(event, payload)
      beginSessionRunState({
        sessionId: context.sessionId,
        runId: context.runId,
        mode: context.effectiveMode,
        totalPages: context.totalPages
      })
      await executeGeneration(context)
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
            'Continue generating the unfinished slides in this session.',
            'Determine the content language from the existing topic, outline, source materials, and the user supplement; do not infer it from this instruction language.',
            `User supplement:\n${retrySupplement}`
          ].join('\n')
        : 'Continue generating the unfinished slides in this session. Determine the content language from the existing topic, outline, and source materials; do not infer it from this instruction language.'
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
    }
    await db.updateSessionStatus(sessionId, 'failed')
    return { success: true }
  })
}
