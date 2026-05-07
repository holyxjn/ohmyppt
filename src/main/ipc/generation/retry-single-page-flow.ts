import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import { runDeepAgentDeckGeneration } from '../generate'
import type { DesignContract } from '../../tools/types'
import { parseSessionMetadata } from './session-metadata'
import { resolveActiveModelConfig, resolveGlobalModelTimeouts } from '../model-config-utils'
import {
  loadStyleSkill,
  listStyleCatalog,
  hasStyleSkill
} from '../../utils/style-skills'
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
  const { db, agentManager, resolveStoragePath, ensureSessionAssets } = ctx

  log.info('[generate:retrySinglePage] resolving context', { sessionId, pageId })

  const session = await db.getSession(sessionId)
  if (!session) throw new Error('Session not found')
  const sessionRecord = session as unknown as Record<string, unknown>
  const previousSessionStatus = String(sessionRecord.status || 'active')

  // Read failed page metadata from DB
  const pageSnapshots = await db.listLatestGenerationPageSnapshot(sessionId)
  const pageSnapshot = pageSnapshots.find((p) => p.page_id === pageId)
  if (!pageSnapshot) throw new Error(`Page ${pageId} not found in session`)

  const pageNumber = pageSnapshot.page_number
  const title = pageSnapshot.title || `Page ${pageNumber}`
  const contentOutline = pageSnapshot.content_outline || title
  const layoutIntent = normalizeLayoutIntent(pageSnapshot.layout_intent)

  // Model config
  const activeModel = await resolveActiveModelConfig(ctx)
  const modelTimeouts = await resolveGlobalModelTimeouts(ctx)

  // Style
  const styleCatalog = listStyleCatalog()
  const defaultStyleId =
    styleCatalog.find((item) => item.styleKey === 'minimal-white')?.id ??
    styleCatalog[0]?.id ??
    ''
  const styleIdRaw =
    typeof sessionRecord.styleId === 'string' ? String(sessionRecord.styleId).trim() : ''
  const styleId = styleIdRaw || defaultStyleId
  if (!styleId || !hasStyleSkill(styleId)) {
    throw new Error(`styleId 不存在或不可用：${styleId}`)
  }
  const styleSkill = loadStyleSkill(styleId)

  // Project dir
  const existingProject = await db.getProject(sessionId)
  const storagePath = await resolveStoragePath()
  const projectDir = existingProject?.output_path || path.join(storagePath, sessionId)
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
  }
  await ensureSessionAssets(projectDir)

  // Resolve htmlPath from metadata
  const metadata = parseSessionMetadata(
    typeof sessionRecord.metadata === 'string' ? sessionRecord.metadata : undefined
  )
  const metaPage = Array.isArray(metadata.generatedPages)
    ? metadata.generatedPages.find((p: { pageId?: string; pageNumber?: number }) =>
        p.pageId === pageId || p.pageNumber === pageNumber
      )
    : undefined
  const htmlPath = metaPage?.htmlPath || pageSnapshot.html_path || path.join(projectDir, `${pageId}.html`)

  // Agent
  agentManager.ensureSession({
    sessionId,
    provider: activeModel.provider,
    model: activeModel.model,
    baseUrl: activeModel.baseUrl,
    projectDir
  })
  const entry = agentManager.beginRun(sessionId)
  if (!entry) throw new Error('Session not found')

  // Locale
  const settings = await db.getAllSettings()
  const appLocale: 'zh' | 'en' = settings.locale === 'en' ? 'en' : 'zh'

  const topic = String(sessionRecord.topic || '当前主题')
  const deckTitle = String(sessionRecord.title || 'OpenPPT Preview')

  const projectId =
    existingProject?.id ??
    await db.createProject({
      session_id: sessionId,
      title: String(sessionRecord.title || 'Untitled'),
      output_path: entry.projectDir
    })

  log.info('[generate:retrySinglePage] context resolved', {
    sessionId,
    pageId,
    pageNumber,
    projectDir: entry.projectDir
  })

  return {
    sessionId,
    runId: crypto.randomUUID(),
    pageId,
    pageNumber,
    title,
    contentOutline,
    layoutIntent,
    htmlPath,
    provider: activeModel.provider,
    apiKey: activeModel.apiKey,
    model: activeModel.model,
    providerBaseUrl: activeModel.baseUrl,
    modelTimeouts,
    projectDir: entry.projectDir,
    abortSignal: entry.abortController.signal,
    styleId,
    styleSkillPrompt: styleSkill.prompt,
    topic,
    deckTitle,
    appLocale,
    sessionRecord,
    previousSessionStatus,
    messageScope: 'page' as const,
    messagePageId: pageId,
    projectId,
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

  // Generate with retry
  let generationError: unknown
  const { failedPages } = await runDeepAgentDeckGeneration({
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
    onPageCompleted: async (page) => {
      if (!fs.existsSync(page.htmlPath)) {
        throw new Error(`${page.pageId}.html 缺失`)
      }
      const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
      const validation = validatePersistedPageHtml(html, page.pageId)
      if (!validation.valid) {
        throw new Error(`HTML 验证失败 (${page.pageId}): ${validation.errors.join('; ')}`)
      }
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent,
        htmlPath: page.htmlPath,
        status: 'completed'
      })
    },
    onPageFailed: async (page) => {
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent,
        htmlPath: page.htmlPath,
        status: 'failed',
        error: page.reason
      })
    },
    runId: context.runId,
    signal: context.abortSignal
  }).catch((err) => {
    generationError = err
    return { failedPages: [{ pageId: context.pageId, title: context.title, reason: String(err) }] }
  })

  // Retry once if failed
  if (failedPages.length > 0) {
    emitChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'retrying'),
        progress: 15,
        totalPages: 1
      }
    })

    // Write fresh scaffold for retry
    await fs.promises.writeFile(
      context.htmlPath,
      `<section data-page-scaffold="${context.pageId}" data-page-number="${context.pageNumber}">
<main data-role="content"><p>Retrying...</p></main>
</section>`,
      'utf-8'
    )

    const retryResult = await runDeepAgentDeckGeneration({
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
      userMessage: `重新生成第 ${context.pageNumber} 页「${context.title}」，确保使用 PPT.createChart 而不是 new Chart。`,
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
      onPageCompleted: async (page) => {
        if (!fs.existsSync(page.htmlPath)) {
          throw new Error(`${page.pageId}.html 缺失`)
        }
        const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
        const validation = validatePersistedPageHtml(html, page.pageId)
        if (!validation.valid) {
          throw new Error(`HTML 验证失败 (${page.pageId}): ${validation.errors.join('; ')}`)
        }
        await db.upsertGenerationPage({
          runId: context.runId,
          sessionId: context.sessionId,
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          contentOutline: page.contentOutline,
          layoutIntent: page.layoutIntent,
          htmlPath: page.htmlPath,
          status: 'completed'
        })
      },
      onPageFailed: async (page) => {
        await db.upsertGenerationPage({
          runId: context.runId,
          sessionId: context.sessionId,
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          contentOutline: page.contentOutline,
          layoutIntent: page.layoutIntent,
          htmlPath: page.htmlPath,
          status: 'failed',
          error: page.reason
        })
      },
      runId: context.runId,
      signal: context.abortSignal
    })
    if (retryResult.failedPages.length > 0) {
      generationError = new Error(
        retryResult.failedPages.map((p) => `${p.pageId}: ${p.reason}`).join('; ')
      )
    } else {
      generationError = null
    }
  }

  if (generationError) {
    throw generationError
  }

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
