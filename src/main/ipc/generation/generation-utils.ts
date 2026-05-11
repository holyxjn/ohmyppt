import fs from 'fs'
import path from 'path'
import type { GenerateChunkEvent } from '@shared/generation'
import { progressText } from '@shared/progress'
import type { PPTDatabase } from '../../db/database'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import { runDeepAgentDeckGeneration } from '../engine/generate'
import type { AnyFlowContext, EmitAssistantFn } from './types'

export const uiText = (locale: 'zh' | 'en', zh: string, en: string): string =>
  locale === 'en' ? en : zh

export const resolvePageHtmlPath = (args: {
  projectDir: string
  fileSlug: string
  candidates?: Array<string | null | undefined>
}): string => {
  const projectRoot = path.resolve(args.projectDir)
  const fallback = path.resolve(projectRoot, `${args.fileSlug}.html`)
  const candidates = [...(args.candidates || []), fallback]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) continue
    const resolved = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(projectRoot, candidate)
    const relativeToProject = path.relative(projectRoot, resolved)
    if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) continue
    if (fs.existsSync(resolved)) return resolved
  }
  return fallback
}

export const isEditValidationRetryableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '')
  return /HTML 验证失败|HTML 落盘校验失败|页面编辑结果验证失败/i.test(message)
}

export const isEditToolSchemaRetryableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '')
  if (!/Received tool input did not match expected schema/i.test(message)) return false
  return /Error invoking tool '(update_single_page_file|update_page_file|edit_file)'/i.test(message)
}

export const buildEditValidationRetryMessage = (originalMessage: string, detail: string): string =>
  [
    originalMessage,
    '',
    'Retry requirement:',
    `- The previous edit failed validation: ${detail}`,
    '- Retry once and fix the validation error directly.',
    '- Only modify the affected page HTML. Keep the page scaffold, runtime scripts, and balanced tags valid.',
    '- Do not modify index.html.'
  ].join('\n')

export const buildEditToolSchemaRetryMessage = (args: {
  originalMessage: string
  detail: string
  allowedTool: 'update_single_page_file' | 'update_page_file' | 'edit_file'
  selectedPageId?: string | null
}): string => {
  const targetPageLine =
    args.allowedTool === 'edit_file'
      ? '- You must target only the selected page file and provide file_path, old_string, and new_string.'
      : args.selectedPageId
        ? `- For this task, pageId must be exactly: "${args.selectedPageId}".`
        : '- You must provide a valid pageId explicitly for each page you modify.'
  const callLine =
    args.allowedTool === 'update_single_page_file'
      ? 'You must call update_single_page_file(pageId, content) exactly once.'
      : args.allowedTool === 'update_page_file'
        ? 'You must call update_page_file(pageId, content) with explicit pageId for each page you modify.'
        : args.allowedTool === 'edit_file'
          ? 'You must call edit_file(file_path, old_string, new_string) with all required fields (old_string is required).'
          : 'You must fix the tool call arguments and provide all required fields.'
  const contentLine =
    args.allowedTool === 'edit_file'
      ? '- old_string must exactly match the current file content and new_string must contain the replacement only.'
      : '- content must be a complete creative page HTML fragment only (no html/head/body).'
  return [
    args.originalMessage,
    '',
    'Retry requirement:',
    `- The previous run failed because the tool call schema was invalid: ${args.detail}`,
    '- Retry once. You must fix the tool call arguments and ensure all required fields are provided.',
    `- ${callLine}`,
    targetPageLine,
    contentLine,
    '- Do not add any explanations or extra text outside the tool call.',
    '- Do not modify index.html.'
  ].join('\n')
}

export const buildEditNoChangeRetryMessage = (args: {
  originalMessage: string
  allowedTool: 'update_single_page_file' | 'update_page_file'
  selectedPageId?: string | null
}): string => {
  const callLine =
    args.allowedTool === 'update_single_page_file'
      ? 'You must call update_single_page_file(pageId, content) exactly once.'
      : 'You must call update_page_file(pageId, content) with explicit pageId for each page you modify.'
  const targetPageLine = args.selectedPageId
    ? `- For this task, pageId must be exactly: "${args.selectedPageId}".`
    : '- You must provide a valid pageId explicitly for each page you modify.'
  return [
    args.originalMessage,
    '',
    'Retry requirement:',
    '- The previous run completed without writing any page changes.',
    '- Retry once and make the requested edit by writing the updated page HTML.',
    `- ${callLine}`,
    targetPageLine,
    '- content must be a complete creative page HTML fragment only (no html/head/body).',
    '- Do not use edit_file or write_file.',
    '- Do not modify index.html.'
  ].join('\n')
}

export type EditedPageDescriptor = {
  id?: string
  pageNumber: number
  title: string
  pageId: string
  html: string
  htmlPath: string
}

export type InvalidEditedPage = {
  page: EditedPageDescriptor
  reason: string
}

export const validateChangedPages = (
  changedPageDescriptors: EditedPageDescriptor[]
): InvalidEditedPage[] =>
  changedPageDescriptors
    .map((page) => {
      const validation = validatePersistedPageHtml(page.html, page.pageId)
      return validation.valid
        ? null
        : {
            page,
            reason: validation.errors.join('; ')
          }
    })
    .filter((item): item is InvalidEditedPage => Boolean(item))

type DeckGenerationArgs = Parameters<typeof runDeepAgentDeckGeneration>[0]
type DeckGenerationResult = Awaited<ReturnType<typeof runDeepAgentDeckGeneration>>

type CreateGenerationPageCallbacksArgs = {
  db: PPTDatabase
  runId: string
  sessionId: string
}

type GeneratePagesWithRetryArgs = {
  runArgs: DeckGenerationArgs
  emitChunk: (chunk: GenerateChunkEvent) => void
  appLocale: 'zh' | 'en'
  runId: string
  totalPages: number
  retryDetail?: string
  beforeRetry?: () => Promise<void>
  buildRetryRunArgs?: (runArgs: DeckGenerationArgs) => DeckGenerationArgs
}

function buildFallbackFailedPages(
  runArgs: DeckGenerationArgs,
  reason: string
): DeckGenerationResult['failedPages'] {
  if (Array.isArray(runArgs.pageTasks) && runArgs.pageTasks.length > 0) {
    return runArgs.pageTasks.map((task) => ({
      pageId: task.pageId,
      title: task.title,
      reason
    }))
  }
  if (Array.isArray(runArgs.outlineTitles) && runArgs.outlineTitles.length > 0) {
    const pageIds = Object.keys(runArgs.pageFileMap || {})
    if (pageIds.length > 0) {
      return runArgs.outlineTitles.map((title, index) => ({
        pageId: pageIds[index] || pageIds[Math.min(index, pageIds.length - 1)],
        title,
        reason
      }))
    }
  }
  const fallbackPageId = Object.keys(runArgs.pageFileMap || {})[0] || 'unknown-page'
  return [{ pageId: fallbackPageId, title: 'Untitled', reason }]
}

export function createGenerationPageCallbacks(
  args: CreateGenerationPageCallbacksArgs
): Pick<DeckGenerationArgs, 'onPageCompleted' | 'onPageFailed'> {
  const { db, runId, sessionId } = args
  const onPageCompleted: NonNullable<DeckGenerationArgs['onPageCompleted']> = async (page) => {
    if (!fs.existsSync(page.htmlPath)) {
      throw new Error(`${page.pageId}.html 缺失`)
    }
    const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const validation = validatePersistedPageHtml(html, page.pageId)
    if (!validation.valid) {
      throw new Error(`HTML 验证失败 (${page.pageId}): ${validation.errors.join('; ')}`)
    }
    await db.upsertGenerationPage({
      runId,
      sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'completed'
    })
  }

  const onPageFailed: NonNullable<DeckGenerationArgs['onPageFailed']> = async (page) => {
    await db.upsertGenerationPage({
      runId,
      sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'failed',
      error: page.reason
    })
  }

  return { onPageCompleted, onPageFailed }
}

export async function generatePagesWithRetry(
  args: GeneratePagesWithRetryArgs
): Promise<DeckGenerationResult> {
  const {
    runArgs,
    emitChunk,
    appLocale,
    runId,
    totalPages,
    retryDetail,
    beforeRetry,
    buildRetryRunArgs
  } = args

  const firstResult = await runDeepAgentDeckGeneration(runArgs).catch((err) => {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      summary: '',
      failedPages: buildFallbackFailedPages(runArgs, reason)
    } satisfies DeckGenerationResult
  })

  if (firstResult.failedPages.length === 0) return firstResult

  emitChunk({
    type: 'llm_status',
    payload: {
      runId,
      stage: 'rendering',
      label: progressText(appLocale, 'retrying'),
      progress: 15,
      totalPages,
      detail: retryDetail
    }
  })

  if (beforeRetry) {
    await beforeRetry()
  }

  const retryResult = await runDeepAgentDeckGeneration(
    buildRetryRunArgs ? buildRetryRunArgs(runArgs) : runArgs
  )
  if (retryResult.failedPages.length > 0) {
    throw new Error(retryResult.failedPages.map((p) => `${p.pageId}: ${p.reason}`).join('; '))
  }
  return retryResult
}

export function createEmitAssistantMessage(
  db: PPTDatabase,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitGenerateChunk: (sessionId: string, chunk: any) => void
): EmitAssistantFn {
  return async (context: AnyFlowContext, content: string): Promise<void> => {
    if (!content.trim()) return
    const messageId = await db.addMessage(context.sessionId, {
      role: 'assistant',
      content: content.trim(),
      type: 'text',
      chat_scope: context.messageScope,
      page_id: context.messagePageId
    })
    emitGenerateChunk(context.sessionId, {
      type: 'assistant_message',
      payload: {
        id: messageId,
        runId: context.runId,
        content: content.trim(),
        chatType: context.messageScope,
        pageId: context.messagePageId
      }
    })
  }
}
