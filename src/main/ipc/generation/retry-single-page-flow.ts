import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import { createGenerationPageCallbacks, generatePagesWithRetry } from './helpers'
import { resolveCommonContext } from './common-context'
import type { DesignContract } from '../../tools/types'
import { parseSessionMetadata } from './session-metadata'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import { normalizeLayoutIntent, type LayoutIntent } from '@shared/layout-intent'

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

  // Read failed page metadata from DB
  const pageSnapshots = await db.listLatestGenerationPageSnapshot(sessionId)
  const pageSnapshot = pageSnapshots.find((p) => p.page_id === pageId)
  if (!pageSnapshot) throw new Error(`Page ${pageId} not found in session`)

  const pageNumber = pageSnapshot.page_number
  const title = pageSnapshot.title || `Page ${pageNumber}`
  const contentOutline = pageSnapshot.content_outline || title
  const layoutIntent = normalizeLayoutIntent(pageSnapshot.layout_intent)

  // Resolve htmlPath from metadata
  const metadata = parseSessionMetadata(
    typeof sessionRecord.metadata === 'string' ? sessionRecord.metadata : undefined
  )
  const metaPage = Array.isArray(metadata.generatedPages)
    ? metadata.generatedPages.find((p: { pageId?: string; pageNumber?: number }) =>
        p.pageId === pageId || p.pageNumber === pageNumber
      )
    : undefined
  const htmlPath =
    metaPage?.htmlPath || pageSnapshot.html_path || path.join(common.projectDir, `${pageId}.html`)

  log.info('[generate:retrySinglePage] context resolved', {
    sessionId,
    pageId,
    pageNumber,
    projectDir: common.projectDir
  })

  return {
    ...common,
    sessionId,
    pageId,
    pageNumber,
    title,
    contentOutline,
    layoutIntent,
    htmlPath,
    sessionRecord,
    messageScope: 'page' as const,
    messagePageId: pageId,
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

  // Rebuild index.html with updated pages
  const metadata = parseSessionMetadata(
    typeof sessionRecord.metadata === 'string' ? sessionRecord.metadata : undefined
  )
  const existingPages: Array<{ pageId?: string; pageNumber?: number; title?: string; htmlPath?: string }> =
    Array.isArray(metadata.generatedPages)
      ? metadata.generatedPages.filter((p: { pageId?: string; pageNumber?: number }) => p.pageId || p.pageNumber)
      : []

  // Read actual generated title from DB (LLM may change it during retry)
  const runPages = await db.listGenerationPages(context.runId)
  const latestPageRecord = runPages.find((p) => p.page_id === context.pageId)
  const actualTitle = latestPageRecord?.title || context.title

  // Check if the failed page exists in metadata; if not, insert it
  const pageExistsInMetadata = existingPages.some(
    (p) => p.pageId === context.pageId || p.pageNumber === context.pageNumber
  )
  if (!pageExistsInMetadata) {
    existingPages.push({
      pageId: context.pageId,
      pageNumber: context.pageNumber,
      title: actualTitle,
      htmlPath: context.htmlPath
    })
    // Sort by pageNumber to maintain order
    existingPages.sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0))
  }

  // Update the failed page in the list (keep same position, same pageId)
  const updatedPages = existingPages.map((p) =>
    (p.pageId === context.pageId || p.pageNumber === context.pageNumber)
      ? { ...p, title: actualTitle, htmlPath: context.htmlPath }
      : p
  )

  // Emit page_updated event
  emitChunk({
    type: 'page_updated',
    payload: {
      runId: context.runId,
      stage: 'rendering',
      label: progressText(context.appLocale, 'completed'),
      progress: 95,
      currentPage: context.pageNumber,
      totalPages: updatedPages.length,
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
  const generatedPages = updatedPages.map((p: { pageNumber?: number; title?: string; pageId?: string; htmlPath?: string }) => ({
    pageNumber: p.pageNumber || 0,
    title: p.title || '',
    pageId: p.pageId || `page-${p.pageNumber}`,
    htmlPath: p.htmlPath || ''
  }))

  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    generatedPages,
    indexPath,
    projectId: context.projectId
  })
  await db.updateProjectStatus(context.projectId, 'draft')

  // Check if there are still failed pages in the session
  const remainingSnapshots = await db.listLatestGenerationPageSnapshot(context.sessionId)
  const hasFailedPages = remainingSnapshots.some((s) => s.status === 'failed')
  // If other pages are still failed, session must NOT be 'completed'
  const targetStatus = hasFailedPages ? 'failed' : 'completed'

  await db.updateSessionStatus(context.sessionId, targetStatus)

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
      totalPages: updatedPages.length
    }
  })
}
