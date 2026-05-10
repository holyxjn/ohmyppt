import fs from 'fs'
import type { GenerateChunkEvent } from '@shared/generation'
import { progressText } from '@shared/progress'
import type { PPTDatabase } from '../../db/database'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import { runDeepAgentDeckGeneration } from '../engine/generate'
import type { AnyFlowContext, EmitAssistantFn } from './types'

export const uiText = (locale: 'zh' | 'en', zh: string, en: string): string =>
  locale === 'en' ? en : zh

export const isEditValidationRetryableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '')
  return /HTML 验证失败|HTML 落盘校验失败|页面编辑结果验证失败/i.test(message)
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
    return runArgs.outlineTitles.map((title, index) => ({
      pageId: `page-${index + 1}`,
      title,
      reason
    }))
  }
  return [{ pageId: 'page-1', title: 'Untitled', reason }]
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
