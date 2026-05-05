import type { IpcContext } from '../context'
import type { GenerationContext, EmitAssistantFn } from './types'
import { uiText } from './helpers'
import { finalizeGenerationSuccess } from './finalize'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { normalizeLayoutIntent, type LayoutIntent } from '@shared/layout-intent'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import type { DesignContract } from '../../tools/types'
import { parseSessionMetadata } from './session-metadata'
import { buildDesignContractWithLLM, runDeepAgentDeckGeneration } from '../generate'

export async function executeRetryFailedPages(
  ctx: IpcContext,
  emitAssistant: EmitAssistantFn,
  context: GenerationContext
): Promise<void> {
  const {
    db,
    agentManager,
    createDeckProgressEmitter,
    DESIGN_CONTRACT_TEMPERATURE,
    PAGE_GENERATION_TEMPERATURE
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }

  const indexPath = path.join(context.entry.projectDir, 'index.html')
  const emitRetryChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)
  let savedDesignContract: DesignContract | undefined
  const sessionRecord = (context.session || {}) as Record<string, unknown>
  const latestPageSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
  const incompleteSnapshotRecords = latestPageSnapshot.filter(
    (page) => page.status !== 'completed'
  )
  let metadataGeneratedPageCount = 0
  let metadataFailedPages: Array<Record<string, unknown>> = []
  if (typeof sessionRecord.metadata === 'string' && sessionRecord.metadata.trim().length > 0) {
    const metadata = parseSessionMetadata(sessionRecord.metadata)
    metadataGeneratedPageCount = Array.isArray(metadata.generatedPages)
      ? metadata.generatedPages.length
      : 0
    metadataFailedPages =
      incompleteSnapshotRecords.length === 0 && Array.isArray(metadata.failedPages)
        ? metadata.failedPages as Array<Record<string, unknown>>
        : []
  }
  if (incompleteSnapshotRecords.length === 0 && metadataFailedPages.length === 0) {
    throw new Error('当前会话没有可继续生成的页面。')
  }
  if (metadataGeneratedPageCount === 0) {
    const latestSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
    const completedSnapshotCount = latestSnapshot.filter(
      (page) => page.status === 'completed'
    ).length
    if (completedSnapshotCount === 0) {
      throw new Error('当前没有成功页面可保留，请使用完整重新生成。')
    }
  }
  if (
    typeof sessionRecord.designContract === 'string' &&
    sessionRecord.designContract.trim().length > 0
  ) {
    try {
      savedDesignContract = JSON.parse(sessionRecord.designContract) as DesignContract
    } catch {
      // ignore malformed design contract and rebuild below
    }
  }
  const designContract =
    savedDesignContract ||
    (await buildDesignContractWithLLM({
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      modelTimeoutMs: context.modelTimeouts.design,
      temperature: DESIGN_CONTRACT_TEMPERATURE,
      styleId: context.styleId,
      styleSkillPrompt: context.styleSkill.prompt,
      appLocale: context.appLocale,
      totalPages: context.totalPages,
      emit: (chunk) => emitRetryChunk(chunk),
      runId: context.runId,
      signal: context.entry.abortController.signal
    }))

  const retryPages =
    incompleteSnapshotRecords.length > 0
      ? incompleteSnapshotRecords.map((page) => ({
          pageNumber: page.page_number,
          pageId: page.page_id,
          title: page.title || page.page_id,
          contentOutline: page.content_outline || '',
          layoutIntent: page.layout_intent
            ? normalizeLayoutIntent(page.layout_intent)
            : undefined,
          htmlPath: page.html_path || path.join(context.entry.projectDir, `${page.page_id}.html`),
          retryCount: page.retry_count + 1
        }))
      : metadataFailedPages
          .map((page, index) => {
            const rawPageId = typeof page.pageId === 'string' ? page.pageId.trim() : ''
            const inferredNumber = Number(rawPageId.match(/^page-(\d+)$/i)?.[1] || 0)
            const rawPageNumber = Number(page.pageNumber)
            const pageNumber =
              Number.isFinite(rawPageNumber) && rawPageNumber > 0
                ? Math.floor(rawPageNumber)
                : inferredNumber > 0
                  ? inferredNumber
                  : index + 1
            const pageId = rawPageId || `page-${pageNumber}`
            const title =
              typeof page.title === 'string' && page.title.trim().length > 0
                ? page.title.trim()
                : `第 ${pageNumber} 页`
            const htmlPathRaw = typeof page.htmlPath === 'string' ? page.htmlPath.trim() : ''
            return {
              pageNumber,
              pageId,
              title,
              contentOutline:
                typeof page.contentOutline === 'string' ? page.contentOutline.trim() : '',
              layoutIntent:
                typeof page.layoutIntent === 'string'
                  ? normalizeLayoutIntent(page.layoutIntent)
                  : undefined,
              htmlPath: htmlPathRaw
                ? path.isAbsolute(htmlPathRaw)
                  ? htmlPathRaw
                  : path.join(context.entry.projectDir, htmlPathRaw)
                : path.join(context.entry.projectDir, `${pageId}.html`),
              retryCount: 1
            }
          })
          .filter(
            (page, index, pages) =>
              pages.findIndex((item) => item.pageId === page.pageId) === index
          )
  const pageFileMap = Object.fromEntries(retryPages.map((page) => [page.pageId, page.htmlPath]))

  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'retry',
    totalPages: retryPages.length,
    metadata: {
      retryOnly: true,
      source:
        incompleteSnapshotRecords.length > 0
          ? 'latest_incomplete_pages'
          : 'metadata_failed_pages',
      pageIds: retryPages.map((page) => page.pageId)
    }
  })
  for (const page of retryPages) {
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'pending',
      retryCount: page.retryCount
    })
  }

  emitRetryChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'rendering',
      label: progressText(context.appLocale, 'retrying'),
      progress: 8,
      totalPages: retryPages.length
    }
  })
  await emitAssistant(
    context,
    uiText(
      context.appLocale,
      `继续生成 ${retryPages.length} 个未完成页面：${retryPages.map((page) => page.pageId).join('、')}。`,
      `Continuing ${retryPages.length} unfinished pages: ${retryPages.map((page) => page.pageId).join(', ')}.`
    )
  )

  const persistedRetryCompletedPageIds = new Set<string>()
  const persistedRetryFailedPageIds = new Set<string>()

  const persistCompletedRetryPage = async (page: {
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string
    layoutIntent?: LayoutIntent
    htmlPath: string
  }): Promise<void> => {
    if (!fs.existsSync(page.htmlPath)) {
      throw new Error(`${page.pageId}.html 缺失`)
    }
    const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const validation = validatePersistedPageHtml(html, page.pageId)
    if (!validation.valid) {
      throw new Error(`HTML 验证失败 (${page.pageId}): ${validation.errors.join('; ')}`)
    }
    const retryPage = retryPages.find((item) => item.pageId === page.pageId)
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'completed',
      retryCount: retryPage?.retryCount || 0
    })
    persistedRetryFailedPageIds.delete(page.pageId)
    persistedRetryCompletedPageIds.add(page.pageId)
  }
  const persistFailedRetryPage = async (page: {
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string
    layoutIntent?: LayoutIntent
    htmlPath: string
    reason: string
  }): Promise<void> => {
    const retryPage = retryPages.find((item) => item.pageId === page.pageId)
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
      error: page.reason,
      retryCount: retryPage?.retryCount || 0
    })
    persistedRetryCompletedPageIds.delete(page.pageId)
    persistedRetryFailedPageIds.add(page.pageId)
  }

  const { failedPages } = await runDeepAgentDeckGeneration({
    sessionId: context.sessionId,
    provider: context.provider,
    apiKey: context.apiKey,
    model: context.model,
    baseUrl: context.providerBaseUrl,
    modelTimeoutMs: context.modelTimeouts.agent,
    temperature: PAGE_GENERATION_TEMPERATURE,
    styleId: context.styleId,
    styleSkillPrompt: context.styleSkill.prompt,
    appLocale: context.appLocale,
    topic: context.topic,
    deckTitle: context.deckTitle,
    userMessage:
      context.userMessage ||
      [
        '继续生成本会话中未完成的页面。页面正文、标题、图表标签必须保持与现有页面相同语言。',
        'Continue generating the unfinished slides in this session. Keep slide text, titles, and chart labels in the same language as existing slides.',
        'Determine the content language from the existing topic, outline, source materials, and existing slides; do not infer it from this instruction.'
      ].join('\n'),
    outlineTitles: retryPages.map((page) => page.title),
    outlineItems: retryPages.map((page) => ({
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent
    })),
    sourceDocumentPaths: context.sourceDocumentPaths,
    generationMode: 'retry',
    pageTasks: retryPages.map((page) => ({
      pageNumber: page.pageNumber,
      pageId: page.pageId,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent
    })),
    designContract,
    projectDir: context.entry.projectDir,
    indexPath,
    pageFileMap,
    agentManager,
    emit: (chunk) => emitRetryChunk(chunk),
    onPageCompleted: persistCompletedRetryPage,
    onPageFailed: persistFailedRetryPage,
    runId: context.runId,
    signal: context.entry.abortController.signal
  })

  const failedPageIdSet = new Set(failedPages.map((page) => page.pageId))
  const retrySuccessPages: Array<{
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }> = []
  const retryFailures = [...failedPages]
  for (const page of retryPages) {
    if (failedPageIdSet.has(page.pageId)) {
      const failure = failedPages.find((item) => item.pageId === page.pageId)
      if (!persistedRetryFailedPageIds.has(page.pageId)) {
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
          error: failure?.reason || '页面重试失败',
          retryCount: page.retryCount
        })
        persistedRetryFailedPageIds.add(page.pageId)
      }
      continue
    }
    if (!fs.existsSync(page.htmlPath)) {
      const reason = `${page.pageId}.html 缺失`
      retryFailures.push({ pageId: page.pageId, title: page.title, reason })
      if (!persistedRetryFailedPageIds.has(page.pageId)) {
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
          error: reason,
          retryCount: page.retryCount
        })
        persistedRetryFailedPageIds.add(page.pageId)
      }
      continue
    }
    const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const validation = validatePersistedPageHtml(html, page.pageId)
    if (!validation.valid) {
      const reason = validation.errors.join('; ')
      retryFailures.push({ pageId: page.pageId, title: page.title, reason })
      if (!persistedRetryFailedPageIds.has(page.pageId)) {
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
          error: reason,
          retryCount: page.retryCount
        })
        persistedRetryFailedPageIds.add(page.pageId)
      }
      continue
    }
    retrySuccessPages.push({
      pageNumber: page.pageNumber,
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath,
      html
    })
    if (!persistedRetryCompletedPageIds.has(page.pageId)) {
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent,
        htmlPath: page.htmlPath,
        status: 'completed',
        retryCount: page.retryCount
      })
      persistedRetryCompletedPageIds.add(page.pageId)
    }
  }

  const retryPageIdSet = new Set(retryPages.map((page) => page.pageId))
  let previousGeneratedPages: Array<{
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }> = []
  if (context.session?.metadata) {
    const metadata = parseSessionMetadata(context.session.metadata)
    const restoredPages = await Promise.all(
      (metadata.generatedPages || [])
        .filter((page) => !retryPageIdSet.has(page.pageId || `page-${page.pageNumber}`))
        .map(async (page) => {
          const pageId = page.pageId || `page-${page.pageNumber}`
          const htmlPath =
            page.htmlPath || path.join(context.entry.projectDir, `${pageId}.html`)
          const html = fs.existsSync(htmlPath)
            ? await fs.promises.readFile(htmlPath, 'utf-8')
            : ''
          if (!html.trim()) return null
          return {
            pageNumber: page.pageNumber,
            title: page.title,
            pageId,
            htmlPath,
            html
          }
        })
    )
    previousGeneratedPages = restoredPages.filter(
      (
        page
      ): page is {
        pageNumber: number
        title: string
        pageId: string
        htmlPath: string
        html: string
      } => Boolean(page)
    )
  }
  const mergedGeneratedPages = [...previousGeneratedPages, ...retrySuccessPages].sort(
    (a, b) => a.pageNumber - b.pageNumber
  )

  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    generatedPages: mergedGeneratedPages.map((page) => ({
      pageNumber: page.pageNumber,
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath
    })),
    failedPages: retryFailures.map((page) => ({
      pageId: page.pageId,
      title: page.title,
      reason: page.reason
    })),
    indexPath,
    projectId: context.projectId
  })
  await db.updateSessionDesignContract(context.sessionId, designContract)
  await db.updateProjectStatus(context.projectId, 'draft')

  if (retryFailures.length > 0) {
    const failedDetails = retryFailures
      .map((item) => `${item.pageId}（${item.title}）：${item.reason}`)
      .join('；')
    await db.updateGenerationRunStatus(
      context.runId,
      retrySuccessPages.length > 0 ? 'partial' : 'failed',
      failedDetails
    )
    emitRetryChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'failed'),
        progress: 90,
        totalPages: retryPages.length,
        detail: failedDetails
      }
    })
    throw new Error(
      `重试后仍有页面失败（${retryFailures.length}/${retryPages.length}）：${retryFailures
        .map((item) => `${item.pageId}(${item.title})`)
        .join(', ')}`
    )
  }

  if (mergedGeneratedPages.length < context.totalPages) {
    const message = uiText(
      context.appLocale,
      `重试页面已完成，但当前只恢复 ${mergedGeneratedPages.length}/${context.totalPages} 页，请继续重试或重新生成。`,
      `Retry completed, but only ${mergedGeneratedPages.length}/${context.totalPages} pages were restored. Retry again or regenerate.`
    )
    await db.updateGenerationRunStatus(context.runId, 'partial', message)
    emitRetryChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'failed'),
        progress: 90,
        totalPages: retryPages.length,
        detail: message
      }
    })
    throw new Error(message)
  }

  await emitAssistant(
    context,
    uiText(
      context.appLocale,
      `失败页面已经重试完成，本次修复 ${retrySuccessPages.length} 页。`,
      `Failed pages were retried. ${retrySuccessPages.length} pages were fixed.`
    )
  )
  await db.updateGenerationRunStatus(context.runId, 'completed', null)
  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: context.totalPages,
    generatedPages: mergedGeneratedPages,
    designContract
  })
}
