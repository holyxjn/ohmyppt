import type { IpcContext } from '../context'
import type { DeckContext, EmitAssistantFn } from './types'
import { uiText } from './generation-utils'
import { finalizeGenerationSuccess } from './finalization'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { type LayoutIntent } from '@shared/layout-intent'
import { isPlaceholderPageHtml, validatePersistedPageHtml } from '../../tools/html-utils'
import { buildProjectIndexHtml, type DeckPageFile } from '../engine/template'
import { buildDesignContractWithLLM, planDeckWithLLM, runDeepAgentDeckGeneration } from '../engine/generate'
import type { GeneratedPagePayload } from '@shared/generation'
import { sleep } from '../utils'
import {
  buildOutlineTitles,
  buildTotalPages,
  normalizeGeneratePayload,
  resolveCommonContext,
  resolveSourceDocuments
} from './context'
import { derivePageNumber } from './metadata-parser'

export async function resolveDeckContext(
  ctx: IpcContext,
  _event: Electron.IpcMainInvokeEvent,
  payload: unknown
): Promise<DeckContext> {
  const input = normalizeGeneratePayload(payload)
  const { db, formatImagePathsForPrompt } = ctx
  if (!input.sessionId) throw new Error('sessionId 不能为空')

  const common = await resolveCommonContext(ctx, input.sessionId)
  const userMessage = `${input.rawUserMessage}${formatImagePathsForPrompt([])}`
  const userProvidedOutlineTitles = buildOutlineTitles(input.rawUserMessage)
  const totalPages = buildTotalPages(common.sessionRecord)
  const sourceDocumentPaths = await resolveSourceDocuments(ctx, {
    sessionId: input.sessionId,
    projectDir: common.projectDir,
    rawDocPaths: input.rawDocPaths,
    mode: 'generate',
    sessionRecord: common.sessionRecord
  })

  await db.addMessage(input.sessionId, {
    role: 'user',
    content: input.rawUserMessage,
    type: 'text',
    chat_scope: 'main',
    image_paths: []
  })
  await db.updateSessionStatus(input.sessionId, 'active')

  return {
    sessionId: input.sessionId,
    userMessage,
    requestedType: input.requestedType,
    effectiveMode: 'generate',
    selectedPageId: undefined,
    htmlPath: undefined,
    selector: undefined,
    elementTag: undefined,
    elementText: undefined,
    session: common.session,
    sessionRecord: common.sessionRecord,
    previousSessionStatus: common.previousSessionStatus,
    entry: common.entry,
    runId: common.runId,
    styleId: common.styleId,
    styleSkill: common.styleSkill,
    userProvidedOutlineTitles,
    totalPages,
    provider: common.provider,
    apiKey: common.apiKey,
    model: common.model,
    modelTimeouts: common.modelTimeouts,
    providerBaseUrl: common.providerBaseUrl,
    projectId: common.projectId,
    messageScope: 'main',
    messagePageId: undefined,
    imagePaths: [],
    videoPaths: [],
    sourceDocumentPaths,
    topic: common.topic,
    deckTitle: common.deckTitle,
    appLocale: common.appLocale
  }
}

export async function executeDeckGeneration(
  ctx: IpcContext,
  emitAssistant: EmitAssistantFn,
  context: DeckContext
): Promise<void> {
  const {
    db,
    agentManager,
    getPageSourceUrl,
    validateProjectIndexHtml,
    createDeckProgressEmitter,
    scaffoldProjectFiles,
    PLANNER_TEMPERATURE,
    DESIGN_CONTRACT_TEMPERATURE,
    PAGE_GENERATION_TEMPERATURE
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }

  const emitDeckChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)

  emitDeckChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'preflight',
      label: progressText(context.appLocale, 'understanding'),
      progress: 2,
      totalPages: context.totalPages
    }
  })
  await db.addMessage(context.sessionId, {
    role: 'system',
    content: uiText(
      context.appLocale,
      '正在梳理需求并准备生成画布。',
      'Organizing requirements and preparing the canvas.'
    ),
    type: 'stream_chunk',
    chat_scope: context.messageScope,
    page_id: context.messagePageId
  })
  await sleep(120, context.entry.abortController.signal)

  const pageRefs = Array.from({ length: context.totalPages }, (_unused, index) => {
    const pageNumber = index + 1
    const pageId = `page-${pageNumber}`
    const htmlPath = path.join(context.entry.projectDir, `${pageId}.html`)
    const fallbackTitle = context.userProvidedOutlineTitles[index] || `Slide ${pageNumber}`
    return { pageNumber, title: fallbackTitle, pageId, htmlPath }
  })
  const pageFileMap = Object.fromEntries(pageRefs.map((page) => [page.pageId, page.htmlPath]))
  const indexPath = path.join(context.entry.projectDir, 'index.html')
  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'generate',
    totalPages: pageRefs.length,
    metadata: {
      topic: context.topic,
      styleId: context.styleId,
      projectDir: context.entry.projectDir,
      indexPath
    }
  })

  emitDeckChunk({
    type: 'stage_progress',
    payload: {
      runId: context.runId,
      stage: 'planning',
      label: progressText(context.appLocale, 'planning'),
      progress: 6,
      totalPages: context.totalPages
    }
  })
  const scaffoldPromise = scaffoldProjectFiles({
    deckTitle: context.deckTitle,
    indexPath,
    pages: pageRefs
  }).then(() => {
    emitDeckChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'preflight',
        label: progressText(context.appLocale, 'preparing'),
        progress: 4,
        totalPages: pageRefs.length,
        detail: uiText(
          context.appLocale,
          `已创建 index.html 与 ${pageRefs.length} 个页面骨架`,
          `Created index.html and ${pageRefs.length} page shells`
        )
      }
    })
  })

  const plannerPromise = planDeckWithLLM({
    provider: context.provider,
    apiKey: context.apiKey,
    model: context.model,
    baseUrl: context.providerBaseUrl,
    modelTimeoutMs: context.modelTimeouts.planning,
    temperature: PLANNER_TEMPERATURE,
    styleId: context.styleId,
    totalPages: pageRefs.length,
    appLocale: context.appLocale,
    topic: context.topic,
    userMessage: context.userMessage,
    emit: (chunk) => emitDeckChunk(chunk),
    runId: context.runId,
    signal: context.entry.abortController.signal
  })
  const designContractPromise = sleep(500, context.entry.abortController.signal).then(() =>
    buildDesignContractWithLLM({
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
      emit: (chunk) => emitDeckChunk(chunk),
      runId: context.runId,
      signal: context.entry.abortController.signal
    })
  )
  const [plannedOutlineItems, designContract] = await Promise.all([
    plannerPromise,
    designContractPromise,
    scaffoldPromise
  ])
  await db.updateSessionDesignContract(context.sessionId, designContract)
  const outlineItems = pageRefs.map((page, index) => {
    const planned = plannedOutlineItems[index]
    return {
      title: planned?.title?.trim() || page.title,
      contentOutline: planned?.contentOutline?.trim() || '',
      layoutIntent: planned?.layoutIntent
    }
  })
  const outlineTitles = outlineItems.map((item) => item.title)
  for (const page of pageRefs) {
    page.title = outlineTitles[page.pageNumber - 1] || page.title
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: outlineItems[page.pageNumber - 1]?.contentOutline || '',
      layoutIntent: outlineItems[page.pageNumber - 1]?.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'pending'
    })
  }

  await fs.promises.writeFile(
    indexPath,
    buildProjectIndexHtml(
      context.deckTitle,
      pageRefs.map(
        (page): DeckPageFile => ({
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: page.title,
          htmlPath: path.basename(page.htmlPath)
        })
      )
    ),
    'utf-8'
  )
  emitDeckChunk({
    type: 'llm_status',
    payload: {
      runId: context.runId,
      stage: 'preflight',
      label: progressText(context.appLocale, 'generating'),
      progress: 10,
      totalPages: pageRefs.length,
      detail: uiText(
        context.appLocale,
        `已完成规划并更新目录标题，设计契约：${designContract.theme}`,
        `Planning completed and index titles updated. Design contract: ${designContract.theme}`
      )
    }
  })

  await emitAssistant(
    context,
    uiText(
      context.appLocale,
      `已为「${context.topic}」规划 ${outlineItems.length} 页内容，风格为「${context.styleSkill.preset.label}」。接下来我会逐页完善并实时同步进度。`,
      `Planned ${outlineItems.length} slides for "${context.topic}" in the "${context.styleSkill.preset.label}" style. I will refine each page and stream progress in real time.`
    )
  )
  await sleep(120, context.entry.abortController.signal)

  const beforePageMap = new Map<string, string>()
  const beforePageResults = await Promise.all(
    pageRefs.map(async (page) => ({
      pageId: page.pageId,
      html: await fs.promises.readFile(page.htmlPath, 'utf-8')
    }))
  )
  for (const item of beforePageResults) {
    beforePageMap.set(item.pageId, item.html)
  }

  const persistedGeneratedPagesById = new Map<
    string,
    {
      pageNumber: number
      title: string
      pageId: string
      htmlPath: string
    }
  >()
  const persistedFailedPagesById = new Map<
    string,
    {
      pageId: string
      title: string
      reason: string
    }
  >()
  const persistGenerationSnapshotMetadata = async (): Promise<void> => {
    await db.updateSessionMetadata(context.sessionId, {
      lastRunId: context.runId,
      entryMode: 'multi_page',
      generatedPages: Array.from(persistedGeneratedPagesById.values()).sort(
        (a, b) => a.pageNumber - b.pageNumber
      ),
      failedPages: Array.from(persistedFailedPagesById.values()).sort((a, b) => {
        const aNumber = Number(a.pageId.match(/^page-(\d+)$/i)?.[1] || 0)
        const bNumber = Number(b.pageId.match(/^page-(\d+)$/i)?.[1] || 0)
        return aNumber - bNumber
      }),
      indexPath,
      projectId: context.projectId
    })
  }
  const persistCompletedGeneratedPage = async (page: {
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
    persistedFailedPagesById.delete(page.pageId)
    persistedGeneratedPagesById.set(page.pageId, {
      pageNumber: derivePageNumber(page.pageId, page.pageNumber),
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath
    })
    await persistGenerationSnapshotMetadata()
  }
  const persistFailedGeneratedPage = async (page: {
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string
    layoutIntent?: LayoutIntent
    htmlPath: string
    reason: string
  }): Promise<void> => {
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
    persistedGeneratedPagesById.delete(page.pageId)
    persistedFailedPagesById.set(page.pageId, {
      pageId: page.pageId,
      title: page.title,
      reason: page.reason
    })
    await persistGenerationSnapshotMetadata()
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
    userMessage: context.userMessage,
    outlineTitles,
    outlineItems,
    sourceDocumentPaths: context.sourceDocumentPaths,
    generationMode: 'generate',
    designContract,
    projectDir: context.entry.projectDir,
    indexPath,
    pageFileMap,
    agentManager,
    emit: (chunk) => emitDeckChunk(chunk),
    onPageCompleted: persistCompletedGeneratedPage,
    onPageFailed: persistFailedGeneratedPage,
    runId: context.runId,
    signal: context.entry.abortController.signal
  })

  const failedPageIdSet = new Set(failedPages.map((item) => item.pageId))
  const postValidationErrors: string[] = []
  const postValidationFailures: Array<{ pageId: string; title: string; reason: string }> = []
  if (!fs.existsSync(indexPath)) {
    postValidationErrors.push('index.html 缺失')
  } else {
    const indexHtml = await fs.promises.readFile(indexPath, 'utf-8')
    postValidationErrors.push(...validateProjectIndexHtml(indexHtml))
  }
  const validationPages = await Promise.all(
    pageRefs.map(async (page) => {
      if (!fs.existsSync(page.htmlPath)) {
        return { pageId: page.pageId, missing: true, html: '' }
      }
      const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
      return { pageId: page.pageId, missing: false, html }
    })
  )
  for (const item of validationPages) {
    const pageRef = pageRefs.find((page) => page.pageId === item.pageId)
    if (item.missing) {
      const reason = `${item.pageId}.html 缺失`
      postValidationErrors.push(reason)
      if (!failedPageIdSet.has(item.pageId)) {
        postValidationFailures.push({
          pageId: item.pageId,
          title: pageRef?.title || item.pageId,
          reason
        })
      }
      continue
    }
    if (!/<html[\s>]/i.test(item.html)) {
      const reason = `${item.pageId}.html 缺少 <html>`
      postValidationErrors.push(reason)
      if (!failedPageIdSet.has(item.pageId)) {
        postValidationFailures.push({
          pageId: item.pageId,
          title: pageRef?.title || item.pageId,
          reason
        })
      }
      continue
    }
    if (!failedPageIdSet.has(item.pageId)) {
      const validation = validatePersistedPageHtml(item.html, item.pageId)
      if (!validation.valid) {
        const reason = validation.errors.join('; ')
        postValidationErrors.push(`${item.pageId}.html ${reason}`)
        postValidationFailures.push({
          pageId: item.pageId,
          title: pageRef?.title || item.pageId,
          reason
        })
      }
    }
  }
  for (const failure of postValidationFailures) {
    failedPageIdSet.add(failure.pageId)
    failedPages.push(failure)
  }
  emitDeckChunk({
    type: 'llm_status',
    payload: {
      runId: context.runId,
      stage: 'validation',
      label: progressText(
        context.appLocale,
        postValidationErrors.length > 0 ? 'failed' : 'checking'
      ),
      progress: 92,
      totalPages: outlineTitles.length,
      detail:
        postValidationErrors.length > 0
          ? postValidationErrors.join('; ')
          : uiText(
              context.appLocale,
              `全部 ${pageRefs.length} 个页面文件都已准备完成`,
              `All ${pageRefs.length} page files are ready`
            )
    }
  })

  const placeholderPages: string[] = []
  const pageDescriptors: Array<{
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }> = []
  const generatedPageReads = await Promise.all(
    pageRefs.map(async (pageRef) => {
      if (!fs.existsSync(pageRef.htmlPath)) return null
      const html = await fs.promises.readFile(pageRef.htmlPath, 'utf-8')
      return { pageRef, html }
    })
  )
  for (const item of generatedPageReads) {
    if (!item) continue
    const { pageRef, html } = item
    if (failedPageIdSet.has(pageRef.pageId)) {
      continue
    }
    if (isPlaceholderPageHtml(html)) {
      const reason = '页面仍为占位内容，模型没有成功写入真实页面'
      placeholderPages.push(pageRef.pageId)
      failedPageIdSet.add(pageRef.pageId)
      failedPages.push({
        pageId: pageRef.pageId,
        title: pageRef.title,
        reason
      })
      continue
    }
    const page: GeneratedPagePayload = {
      pageNumber: pageRef.pageNumber,
      title: pageRef.title,
      html,
      pageId: pageRef.pageId,
      htmlPath: pageRef.htmlPath,
      sourceUrl: getPageSourceUrl(pageRef.htmlPath)
    }
    pageDescriptors.push({
      pageNumber: pageRef.pageNumber,
      title: pageRef.title,
      pageId: pageRef.pageId,
      htmlPath: pageRef.htmlPath,
      html
    })
    if (!persistedGeneratedPagesById.has(pageRef.pageId)) {
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: pageRef.pageId,
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        contentOutline: outlineItems[pageRef.pageNumber - 1]?.contentOutline || '',
        layoutIntent: outlineItems[pageRef.pageNumber - 1]?.layoutIntent,
        htmlPath: pageRef.htmlPath,
        status: 'completed'
      })
    }
    emitDeckChunk({
      type: 'page_generated',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'completed'),
        progress: 10 + Math.round((page.pageNumber / Math.max(pageRefs.length, 1)) * 80),
        currentPage: page.pageNumber,
        totalPages: pageRefs.length,
        ...page
      }
    })
    const changed = beforePageMap.get(pageRef.pageId) !== html
    await db.addMessage(context.sessionId, {
      role: 'tool',
      content: `${changed ? '已更新' : '已确认'} ${page.pageId}: ${page.title}`,
      type: 'tool_result',
      tool_name: 'update_page_file',
      tool_call_id: context.runId,
      chat_scope: context.messageScope,
      page_id: context.messagePageId
    })
  }

  if (placeholderPages.length > 0) {
    emitDeckChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'checking'),
        progress: 90,
        totalPages: outlineTitles.length,
        detail: uiText(
          context.appLocale,
          `以下页面可能仍是占位内容：${placeholderPages.join(', ')}`,
          `These pages may still contain placeholders: ${placeholderPages.join(', ')}`
        )
      }
    })
  }

  if (failedPages.length > 0) {
    const failedDetails = failedPages
      .map((item) => `${item.pageId}（${item.title}）：${item.reason}`)
      .join('；')
    for (const failedPage of failedPages) {
      const pageRef = pageRefs.find((page) => page.pageId === failedPage.pageId)
      if (!pageRef) continue
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: pageRef.pageId,
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        contentOutline: outlineItems[pageRef.pageNumber - 1]?.contentOutline || '',
        layoutIntent: outlineItems[pageRef.pageNumber - 1]?.layoutIntent,
        htmlPath: pageRef.htmlPath,
        status: 'failed',
        error: failedPage.reason
      })
    }
    await db.updateGenerationRunStatus(
      context.runId,
      pageDescriptors.length > 0 ? 'partial' : 'failed',
      failedDetails
    )
    await db.updateSessionMetadata(context.sessionId, {
      lastRunId: context.runId,
      entryMode: 'multi_page',
      generatedPages: pageDescriptors.map((page) => ({
        pageNumber: derivePageNumber(page.pageId, page.pageNumber),
        title: page.title,
        pageId: page.pageId,
        htmlPath: page.htmlPath
      })),
      failedPages: failedPages.map((page) => ({
        pageId: page.pageId,
        title: page.title,
        reason: page.reason
      })),
      indexPath,
      projectId: context.projectId
    })
    await db.updateSessionDesignContract(context.sessionId, designContract)
    await db.updateProjectStatus(context.projectId, 'draft')
    emitDeckChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'failed'),
        progress: 90,
        totalPages: outlineTitles.length,
        detail: uiText(
          context.appLocale,
          `本次已完成 ${pageDescriptors.length}/${pageRefs.length} 页，失败页面：${failedDetails}`,
          `${pageDescriptors.length}/${pageRefs.length} pages completed. Failed pages: ${failedDetails}`
        )
      }
    })
    throw new Error(
      `部分页面生成失败（${failedPages.length}/${pageRefs.length}）：${failedPages
        .map((item) => `${item.pageId}(${item.title})`)
        .join(', ')}`
    )
  }

  const completionSummary =
    placeholderPages.length > 0
      ? uiText(
          context.appLocale,
          `演示已生成完成。当前共 ${pageDescriptors.length} 页，主题「${context.topic}」。其中 ${placeholderPages.length} 页可以继续优化。`,
          `The presentation has been generated. It has ${pageDescriptors.length} pages for "${context.topic}". ${placeholderPages.length} pages can still be improved.`
        )
      : uiText(
          context.appLocale,
          `演示已生成完成。共 ${pageDescriptors.length} 页，主题「${context.topic}」。`,
          `The presentation has been generated. It has ${pageDescriptors.length} pages for "${context.topic}".`
        )
  await emitAssistant(context, completionSummary)

  await db.updateGenerationRunStatus(context.runId, 'completed', null)
  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: outlineTitles.length,
    generatedPages: pageDescriptors,
    designContract
  })
}
