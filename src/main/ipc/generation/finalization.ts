import log from 'electron-log/main.js'
import path from 'path'
import { customAlphabet, nanoid } from 'nanoid'
import type { IpcContext } from '../context'
import type { FinalizeContext, FinalizeGenerationArgs } from './types'
import { recordHistoryOperationStrict } from '../../history/git-history-service'
import type { SessionPageRecord } from '../../db/database'

const pageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

const syncGeneratedPagesToSessionPages = async (
  ctx: IpcContext,
  args: {
    sessionId: string
    generatedPages: Array<{
      id?: string
      pageNumber: number
      title: string
      pageId?: string
      htmlPath?: string
    }>
  }
): Promise<void> => {
  const existingPages = await ctx.db.listSessionPages(args.sessionId, { includeDeleted: true })
  const existingBySlug = new Map<string, SessionPageRecord>()
  for (const row of existingPages) {
    existingBySlug.set(row.file_slug, row)
    if (row.legacy_page_id) existingBySlug.set(row.legacy_page_id, row)
  }

  for (const page of args.generatedPages) {
    const fileSlug = page.pageId || `page-${pageSlugId()}`
    const existing = existingBySlug.get(fileSlug)
    await ctx.db.upsertSessionPage({
      id: page.id || existing?.id || nanoid(),
      sessionId: args.sessionId,
      legacyPageId: existing?.legacy_page_id || (fileSlug.match(/^page-\d+$/) ? fileSlug : null),
      fileSlug,
      pageNumber: page.pageNumber,
      title: page.title || `第 ${page.pageNumber} 页`,
      htmlPath: page.htmlPath || '',
      status: 'completed',
      error: null
    })
  }
}

export async function finalizeGenerationSuccess(
  ctx: IpcContext,
  args: FinalizeGenerationArgs
): Promise<void> {
  const { db, emitGenerateChunk } = ctx
  const { context, indexPath, totalPages, generatedPages } = args
  const contextWithPrompt = context as FinalizeContext & { userMessage?: unknown }
  await syncGeneratedPagesToSessionPages(ctx, {
    sessionId: context.sessionId,
    generatedPages
  })
  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    indexPath,
    projectId: context.projectId
  })
  if (args.designContract) {
    await db.updateSessionDesignContract(context.sessionId, args.designContract)
  }
  await db.updateProjectStatus(context.projectId, 'draft')
  await db.updateSessionStatus(context.sessionId, 'completed')
  await recordHistoryOperationStrict(db, {
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
