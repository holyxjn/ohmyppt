import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import { createGenerationPageCallbacks, generatePagesWithRetry } from './generation-utils'
import { resolveCommonContext } from './context'
import type { DesignContract } from '../../tools/types'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import { normalizeLayoutIntent, type LayoutIntent } from '@shared/layout-intent'
import {
  ensureHistoryBaselineSafe,
  recordHistoryOperationSafe
} from '../../history/git-history-service'

// ── Independent RetrySinglePage context ──

export type RetrySinglePageContext = {
  sessionId: string
  runId: string
  pageId: string
  pageNumber: number
  title: string
  contentOutline: string
  layoutIntent: LayoutIntent
  htmlPath: string
  provider: string
  apiKey: string
  model: string
  providerBaseUrl: string
  modelTimeouts: Record<ModelTimeoutProfile, number>
  projectDir: string
  abortSignal: AbortSignal
  styleId: string
  styleSkillPrompt: string
  topic: string
  deckTitle: string
  appLocale: 'zh' | 'en'
  sessionRecord: Record<string, unknown>
  previousSessionStatus: string
  messageScope: 'main' | 'page'
  messagePageId: string
  projectId: string
  effectiveMode: 'retrySinglePage'
}

export async function resolveRetrySinglePageContext(
  ctx: IpcContext,
  sessionId: string,
  pageId: string
): Promise<RetrySinglePageContext> {
  const { db } = ctx

  log.info('[generate:retrySinglePage] resolving context', { sessionId, pageId })
  const common = await resolveCommonContext(ctx, sessionId)
  const { sessionRecord } = common

  const sessionPages = await db.listSessionPages(sessionId)
  const sessionPage = sessionPages.find((page) => page.file_slug === pageId || page.id === pageId)
  if (!sessionPage) {
    throw new Error(`Page ${pageId} not found in session_pages`)
  }
  const fileSlug = sessionPage.file_slug

  // Read failed page metadata from DB
  const pageSnapshots = await db.listLatestGenerationPageSnapshot(sessionId)
  const pageSnapshot = pageSnapshots.find((p) => p.page_id === fileSlug)

  const pageNumber = sessionPage.page_number
  const title = sessionPage.title || pageSnapshot?.title || `Page ${pageNumber}`
  const contentOutline = pageSnapshot?.content_outline || title
  const layoutIntent = normalizeLayoutIntent(pageSnapshot?.layout_intent)
  const htmlPath =
    sessionPage.html_path ||
    pageSnapshot?.html_path ||
    path.join(common.projectDir, `${fileSlug}.html`)

  log.info('[generate:retrySinglePage] context resolved', {
    sessionId,
    pageId: fileSlug,
    pageNumber,
    projectDir: common.projectDir
  })

  return {
    ...common,
    sessionId,
    pageId: fileSlug,
    pageNumber,
    title,
    contentOutline,
    layoutIntent,
    htmlPath,
    sessionRecord,
    messageScope: 'page' as const,
    messagePageId: sessionPage.id,
    effectiveMode: 'retrySinglePage' as const
  }
}

// ── Execute single page retry ──

export async function executeRetrySinglePageGeneration(
  ctx: IpcContext,
  context: RetrySinglePageContext
): Promise<void> {
  const {
    db,
    agentManager,
    getPageSourceUrl,
    createDeckProgressEmitter,
    PAGE_GENERATION_TEMPERATURE
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }

  const emitChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)
  const indexPath = path.join(context.projectDir, 'index.html')
  await ensureHistoryBaselineSafe(db, context.sessionId, context.projectDir)

  // Read designContract
  const sessionRecord = context.sessionRecord
  let designContract: DesignContract | undefined
  if (
    typeof sessionRecord.designContract === 'string' &&
    sessionRecord.designContract.trim().length > 0
  ) {
    try {
      designContract = JSON.parse(sessionRecord.designContract) as DesignContract
    } catch {
      // ignore
    }
  }
  if (!designContract) {
    throw new Error('当前会话缺少设计契约，无法重试。')
  }

  // Emit progress
  emitChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'rendering',
      label: progressText(context.appLocale, 'generating'),
      progress: 10,
      totalPages: 1
    }
  })

  // Write scaffold before generation
  await fs.promises.writeFile(
    context.htmlPath,
    `<section data-page-scaffold="${context.pageId}" data-page-number="${context.pageNumber}">
<main data-role="content"><p>Regenerating...</p></main>
</section>`,
    'utf-8'
  )

  // Create run + page records
  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'retrySinglePage',
    totalPages: 1,
    metadata: { retrySinglePage: true, pageId: context.pageId }
  })
  await db.upsertGenerationPage({
    runId: context.runId,
    sessionId: context.sessionId,
    pageId: context.pageId,
    pageNumber: context.pageNumber,
    title: context.title,
    contentOutline: context.contentOutline,
    layoutIntent: context.layoutIntent,
    htmlPath: context.htmlPath,
    status: 'pending'
  })

  const pageFileMap: Record<string, string> = { [context.pageId]: context.htmlPath }
  const pageCallbacks = createGenerationPageCallbacks({
    db,
    runId: context.runId,
    sessionId: context.sessionId
  })
  await generatePagesWithRetry({
    runArgs: {
      sessionId: context.sessionId,
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      modelTimeoutMs: context.modelTimeouts.agent,
      temperature: PAGE_GENERATION_TEMPERATURE,
      styleId: context.styleId,
      styleSkillPrompt: context.styleSkillPrompt,
      appLocale: context.appLocale,
      topic: context.topic,
      deckTitle: context.deckTitle,
      userMessage: `重新生成第 ${context.pageNumber} 页「${context.title}」`,
      outlineTitles: [context.title],
      outlineItems: [{
        title: context.title,
        contentOutline: context.contentOutline,
        layoutIntent: context.layoutIntent
      }],
      sourceDocumentPaths: [],
      generationMode: 'generate',
      pageTasks: [{
        pageNumber: context.pageNumber,
        pageId: context.pageId,
        title: context.title,
        contentOutline: context.contentOutline,
        layoutIntent: context.layoutIntent
      }],
      designContract,
      projectDir: context.projectDir,
      indexPath,
      pageFileMap,
      agentManager,
      emit: (chunk) => emitChunk(chunk),
      ...pageCallbacks,
      runId: context.runId,
      signal: context.abortSignal
    },
    emitChunk,
    appLocale: context.appLocale,
    runId: context.runId,
    totalPages: 1,
    beforeRetry: async () => {
      await fs.promises.writeFile(
        context.htmlPath,
        `<section data-page-scaffold="${context.pageId}" data-page-number="${context.pageNumber}">
<main data-role="content"><p>Retrying...</p></main>
</section>`,
        'utf-8'
      )
    },
    buildRetryRunArgs: (runArgs) => ({
      ...runArgs,
      userMessage: `重新生成第 ${context.pageNumber} 页「${context.title}」，确保使用 PPT.createChart 而不是 new Chart。`
    })
  })

  // Validate generated page
  if (!fs.existsSync(context.htmlPath)) {
    throw new Error(`${context.pageId}.html 缺失`)
  }
  const newHtml = await fs.promises.readFile(context.htmlPath, 'utf-8')
  const validation = validatePersistedPageHtml(newHtml, context.pageId)
  if (!validation.valid) {
    throw new Error(`重试页面 HTML 验证失败: ${validation.errors.join('; ')}`)
  }

  // Read actual generated title from DB (LLM may change it during retry)
  const runPages = await db.listGenerationPages(context.runId)
  const latestPageRecord = runPages.find((p) => p.page_id === context.pageId)
  const actualTitle = latestPageRecord?.title || context.title
  const existingSessionPages = await db.listSessionPages(context.sessionId, { includeDeleted: true })
  const existingBySlug = new Map(existingSessionPages.map((sp) => [sp.file_slug, sp]))
  const currentSessionPage = existingBySlug.get(context.pageId)
  await db.upsertSessionPage({
    id: currentSessionPage?.id || nanoid(),
    sessionId: context.sessionId,
    legacyPageId:
      currentSessionPage?.legacy_page_id ||
      (context.pageId.match(/^page-\d+$/) ? context.pageId : null),
    fileSlug: context.pageId,
    pageNumber: context.pageNumber,
    title: actualTitle,
    htmlPath: context.htmlPath,
    status: 'completed',
    error: null
  })
  const updatedSessionPages = existingSessionPages
    .filter((page) => !page.deleted_at)
    .map((page) =>
      page.file_slug === context.pageId
        ? {
            ...page,
            title: actualTitle,
            html_path: context.htmlPath,
            status: 'completed',
            error: null
          }
        : page
    )
    .sort((a, b) => a.page_number - b.page_number)

  // Emit page_updated event
  emitChunk({
    type: 'page_updated',
    payload: {
      runId: context.runId,
      stage: 'rendering',
      label: progressText(context.appLocale, 'completed'),
      progress: 95,
      currentPage: context.pageNumber,
      totalPages: updatedSessionPages.length,
      id: context.messagePageId,
      pageNumber: context.pageNumber,
      title: actualTitle,
      pageId: context.pageId,
      htmlPath: context.htmlPath,
      html: newHtml,
      sourceUrl: getPageSourceUrl(context.htmlPath)
    }
  })

  // Finalize — update metadata and project status, but only mark session 'completed'
  // if there are no remaining failed pages.
  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    indexPath,
    projectId: context.projectId
  })
  await db.updateProjectStatus(context.projectId, 'draft')

  // Check if there are still failed pages in the session
  const remainingSessionPages = await db.listSessionPages(context.sessionId)
  const hasFailedPages = remainingSessionPages.some((page) => page.status !== 'completed')
  // If other pages are still failed, session must NOT be 'completed'
  const targetStatus = hasFailedPages ? 'failed' : 'completed'

  await db.updateSessionStatus(context.sessionId, targetStatus)
  await recordHistoryOperationSafe(db, {
    sessionId: context.sessionId,
    projectDir: context.projectDir,
    type: 'retry',
    scope: 'page',
    prompt: `重新生成第 ${context.pageNumber} 页「${context.title}」`,
    metadata: {
      runId: context.runId,
      pageId: context.pageId
    }
  })

  log.info('[generate:retrySinglePage] completed', {
    sessionId: context.sessionId,
    pageId: context.pageId,
    hasFailedPages,
    targetStatus
  })

  emitChunk({
    type: 'run_completed',
    payload: {
      runId: context.runId,
      totalPages: updatedSessionPages.length
    }
  })
}
