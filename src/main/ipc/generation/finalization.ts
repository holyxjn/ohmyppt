import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import type { FinalizeContext, FinalizeGenerationArgs } from './types'
import { derivePageNumber } from './metadata-parser'

export async function finalizeGenerationSuccess(
  ctx: IpcContext,
  args: FinalizeGenerationArgs
): Promise<void> {
  const { db, emitGenerateChunk } = ctx
  const { context, indexPath, totalPages, generatedPages } = args
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
