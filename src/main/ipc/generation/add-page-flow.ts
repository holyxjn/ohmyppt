import type { IpcContext } from '../context'
import type { GenerationContext, EmitAssistantFn } from './types'
import { uiText } from './helpers'
import { finalizeGenerationSuccess } from './finalize'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { type LayoutIntent } from '@shared/layout-intent'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import { buildProjectIndexHtml, buildPageScaffoldHtml, type DeckPageFile } from '../template'
import { planNewPage, runDeepAgentDeckGeneration } from '../generate'
import type { DesignContract } from '../../tools/types'
import { parseSessionMetadata } from './session-metadata'

export async function executeAddPageGeneration(
  ctx: IpcContext,
  emitAssistant: EmitAssistantFn,
  context: GenerationContext
): Promise<void> {
  const {
    db,
    agentManager,
    getPageSourceUrl,
    createDeckProgressEmitter,
    DESIGN_CONTRACT_TEMPERATURE,
    PAGE_GENERATION_TEMPERATURE
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }

  const emitChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)
  const sessionRecord = context.sessionRecord as Record<string, unknown>
  const indexPath = path.join(context.entry.projectDir, 'index.html')

  // ── Step 1: Read designContract from session independent field ──
  let designContract: DesignContract | undefined
  if (
    typeof sessionRecord.designContract === 'string' &&
    sessionRecord.designContract.trim().length > 0
  ) {
    try {
      designContract = JSON.parse(sessionRecord.designContract) as DesignContract
    } catch {
      // ignore malformed design contract
    }
  }
  if (!designContract) {
    throw new Error('当前会话缺少设计契约，无法新增页面。请先完成首次生成。')
  }

  // ── Step 2: Read existing pages from metadata ──
  const metadata = parseSessionMetadata(
    typeof sessionRecord.metadata === 'string' ? sessionRecord.metadata : undefined
  )
  const existingPages = Array.isArray(metadata.generatedPages)
    ? metadata.generatedPages.filter((p) => p.pageId || p.pageNumber)
    : []

  if (existingPages.length === 0) {
    throw new Error('当前会话没有已完成的页面，无法新增。请先完成首次生成。')
  }

  // Parse insertAfterPageNumber from the encoded prefix
  const prefixMatch = context.userMessage.match(/^\[addPage:insertAfter=(\d+)\]/)
  const insertAfterPageNumber = prefixMatch
    ? Number(prefixMatch[1]) || existingPages[existingPages.length - 1].pageNumber
    : existingPages[existingPages.length - 1].pageNumber

  // Extract the real user description (after the prefix)
  const userDescription = prefixMatch
    ? context.userMessage.slice(prefixMatch[0].length).trim()
    : context.userMessage.trim()

  // ── Step 3: Plan new page ──
  emitChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'planning',
      label: progressText(context.appLocale, 'understanding'),
      progress: 2,
      totalPages: 1
    }
  })

  const newPageNumber = Math.max(...existingPages.map((p) => p.pageNumber)) + 1
  const newPageId = `page-${newPageNumber}`
  const newHtmlPath = path.join(context.entry.projectDir, `${newPageId}.html`)

  let planResult: { title: string; contentOutline: string; layoutIntent: LayoutIntent }
  try {
    planResult = await planNewPage({
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      modelTimeoutMs: context.modelTimeouts.planning,
      temperature: DESIGN_CONTRACT_TEMPERATURE,
      appLocale: context.appLocale,
      userDescription,
      signal: context.entry.abortController.signal
    })
  } catch (planError) {
    // Retry plan once
    try {
      planResult = await planNewPage({
        provider: context.provider,
        apiKey: context.apiKey,
        model: context.model,
        baseUrl: context.providerBaseUrl,
        modelTimeoutMs: context.modelTimeouts.planning,
        temperature: DESIGN_CONTRACT_TEMPERATURE,
        appLocale: context.appLocale,
        userDescription,
        signal: context.entry.abortController.signal
      })
    } catch {
      throw new Error(
        `规划新页面失败：${planError instanceof Error ? planError.message : String(planError)}`
      )
    }
  }

  // ── Step 4: Create scaffold ──
  await fs.promises.writeFile(
    newHtmlPath,
    buildPageScaffoldHtml({
      pageNumber: newPageNumber,
      pageId: newPageId,
      title: planResult.title
    }),
    'utf-8'
  )

  // ── Step 5: Generate with agent ──
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

  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'addPage',
    totalPages: 1,
    metadata: {
      addPage: true,
      pageId: newPageId,
      insertAfterPageNumber
    }
  })
  await db.upsertGenerationPage({
    runId: context.runId,
    sessionId: context.sessionId,
    pageId: newPageId,
    pageNumber: newPageNumber,
    title: planResult.title,
    contentOutline: planResult.contentOutline,
    layoutIntent: planResult.layoutIntent,
    htmlPath: newHtmlPath,
    status: 'pending'
  })

  const pageFileMap: Record<string, string> = { [newPageId]: newHtmlPath }

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
    styleSkillPrompt: context.styleSkill.prompt,
    appLocale: context.appLocale,
    topic: context.topic,
    deckTitle: context.deckTitle,
    userMessage: userDescription,
    outlineTitles: [planResult.title],
    outlineItems: [planResult],
    sourceDocumentPaths: context.sourceDocumentPaths,
    generationMode: 'generate',
    pageTasks: [
      {
        pageNumber: newPageNumber,
        pageId: newPageId,
        title: planResult.title,
        contentOutline: planResult.contentOutline,
        layoutIntent: planResult.layoutIntent
      }
    ],
    designContract,
    projectDir: context.entry.projectDir,
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
    signal: context.entry.abortController.signal
  }).catch((err) => {
    generationError = err
    return { failedPages: [{ pageId: newPageId, title: planResult.title, reason: String(err) }] }
  })

  // Retry generation once if failed
  if (failedPages.length > 0 && !generationError) {
    emitChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'retrying'),
        progress: 15,
        totalPages: 1,
        detail: uiText(
          context.appLocale,
          `页面生成失败，正在重试...`,
          `Page generation failed, retrying...`
        )
      }
    })

    const retryResult = await runDeepAgentDeckGeneration({
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
      userMessage: userDescription,
      outlineTitles: [planResult.title],
      outlineItems: [planResult],
      sourceDocumentPaths: context.sourceDocumentPaths,
      generationMode: 'generate',
      pageTasks: [
        {
          pageNumber: newPageNumber,
          pageId: newPageId,
          title: planResult.title,
          contentOutline: planResult.contentOutline,
          layoutIntent: planResult.layoutIntent
        }
      ],
      designContract,
      projectDir: context.entry.projectDir,
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
      signal: context.entry.abortController.signal
    })
    if (retryResult.failedPages.length > 0) {
      generationError = new Error(
        retryResult.failedPages.map((p) => `${p.pageId}: ${p.reason}`).join('; ')
      )
    }
  }

  if (generationError) {
    throw generationError
  }

  // ── Step 6: Validate generated page ──
  if (!fs.existsSync(newHtmlPath)) {
    throw new Error(`${newPageId}.html 缺失`)
  }
  const newPageHtml = await fs.promises.readFile(newHtmlPath, 'utf-8')
  const newPageValidation = validatePersistedPageHtml(newPageHtml, newPageId)
  if (!newPageValidation.valid) {
    throw new Error(
      `新页面 HTML 验证失败: ${newPageValidation.errors.join('; ')}`
    )
  }

  // ── Step 7: Merge into existing pages and renumber ──
  const newPageEntry = {
    pageNumber: insertAfterPageNumber + 1,
    title: planResult.title,
    pageId: newPageId,
    htmlPath: newHtmlPath,
    html: newPageHtml
  }

  // Read existing page HTMLs for the merge
  const existingPageDescriptors = await Promise.all(
    existingPages.map(async (page) => {
      const pageId = page.pageId || `page-${page.pageNumber}`
      const htmlPath = page.htmlPath || path.join(context.entry.projectDir, `${pageId}.html`)
      const html = fs.existsSync(htmlPath)
        ? await fs.promises.readFile(htmlPath, 'utf-8')
        : ''
      return {
        pageNumber: page.pageNumber,
        title: page.title,
        pageId,
        htmlPath,
        html
      }
    })
  )

  // Insert new page after insertAfterPageNumber
  const beforePages = existingPageDescriptors.filter(
    (p) => p.pageNumber <= insertAfterPageNumber
  )
  const afterPages = existingPageDescriptors.filter(
    (p) => p.pageNumber > insertAfterPageNumber
  )
  const mergedPages = [...beforePages, newPageEntry, ...afterPages]

  // Renumber
  const renumberedPages = mergedPages.map((page, index) => ({
    ...page,
    pageNumber: index + 1
  }))

  // ── Step 8: Rebuild index.html ──
  await fs.promises.writeFile(
    indexPath,
    buildProjectIndexHtml(
      context.deckTitle,
      renumberedPages.map(
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

  // ── Step 9: Emit page_generated event ──
  const renumberedNewPage = renumberedPages.find((p) => p.pageId === newPageId)
  const generatedPayload = {
    pageNumber: renumberedNewPage?.pageNumber ?? newPageEntry.pageNumber,
    title: newPageEntry.title,
    pageId: newPageEntry.pageId,
    htmlPath: newPageEntry.htmlPath,
    html: newPageEntry.html,
    sourceUrl: getPageSourceUrl(newPageEntry.htmlPath)
  }

  emitChunk({
    type: 'page_generated',
    payload: {
      runId: context.runId,
      stage: 'rendering',
      label: progressText(context.appLocale, 'completed'),
      progress: 95,
      currentPage: generatedPayload.pageNumber,
      totalPages: renumberedPages.length,
      ...generatedPayload
    }
  })

  // ── Step 10: Finalize ──
  await emitAssistant(
    context,
    uiText(
      context.appLocale,
      `已新增页面「${planResult.title}」并插入到第 ${insertAfterPageNumber} 页之后。`,
      `Added page "${planResult.title}" after page ${insertAfterPageNumber}.`
    )
  )

  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: renumberedPages.length,
    generatedPages: renumberedPages
  })
}
