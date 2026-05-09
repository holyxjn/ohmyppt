import log from 'electron-log/main.js'
import path from 'path'
import type { IpcContext } from '../context'
import type { FinalizeContext, FinalizeGenerationArgs } from './types'
import { derivePageNumber } from './metadata-parser'
import { recordHistoryOperationSafe } from '../../history/git-history-service'

export async function finalizeGenerationSuccess(
  ctx: IpcContext,
  args: FinalizeGenerationArgs
): Promise<void> {
  const { db, emitGenerateChunk } = ctx
  const { context, indexPath, totalPages, generatedPages } = args
  const contextWithPrompt = context as FinalizeContext & { userMessage?: unknown }
  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    generatedPages: generatedPages.map((page) => ({
      pageNumber: derivePageNumber(page.pageId, page.pageNumber),
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath
    })),
    indexPath,
    projectId: context.projectId
  })
  if (args.designContract) {
    await db.updateSessionDesignContract(context.sessionId, args.designContract)
  }
  await db.updateProjectStatus(context.projectId, 'draft')
  await db.updateSessionStatus(context.sessionId, 'completed')
  await recordHistoryOperationSafe(db, {
    sessionId: context.sessionId,
    projectDir: path.dirname(indexPath),
    type:
      context.effectiveMode === 'addPage'
        ? 'addPage'
        : context.effectiveMode === 'retry'
          ? 'retry'
          : context.effectiveMode === 'retrySinglePage'
            ? 'retry'
            : 'generate',
    scope: context.effectiveMode === 'retrySinglePage' ? 'page' : 'session',
    prompt: typeof contextWithPrompt.userMessage === 'string' ? contextWithPrompt.userMessage : null,
    metadata: {
      runId: context.runId,
      effectiveMode: context.effectiveMode,
      totalPages
    }
  })
  log.info('[generate:start] completed', {
    sessionId: context.sessionId,
    styleId: context.styleId,
    totalPages
  })
  emitGenerateChunk(context.sessionId, {
    type: 'run_completed',
    payload: {
      runId: context.runId,
      totalPages
    }
  })
}

export async function finalizeGenerationFailure(
  ctx: IpcContext,
  context: FinalizeContext,
  error: unknown
): Promise<void> {
  const { db, emitGenerateChunk } = ctx
  const message =
    error instanceof Error && error.message.length > 0 ? error.message : 'Generation failed'
  log.error('[generate:start] failed', {
    sessionId: context.sessionId,
    styleId: context.styleId,
    message
  })
  const generationRun = await db.getGenerationRun(context.runId)
  if (generationRun && generationRun.status === 'running') {
    await db.updateGenerationRunStatus(context.runId, 'failed', message)
  }
  await db.updateSessionStatus(
    context.sessionId,
    (context.effectiveMode === 'edit' || context.effectiveMode === 'retry' || context.effectiveMode === 'addPage' || context.effectiveMode === 'retrySinglePage') &&
      context.previousSessionStatus !== 'active'
      ? (context.previousSessionStatus as 'completed' | 'failed' | 'archived')
      : 'failed'
  )
  await db.addMessage(context.sessionId, {
    role: 'system',
    content: message,
    type: 'stream_chunk',
    chat_scope: context.messageScope,
    page_id: context.messagePageId
  })
  emitGenerateChunk(context.sessionId, {
    type: 'run_error',
    payload: { runId: context.runId, message }
  })
}
