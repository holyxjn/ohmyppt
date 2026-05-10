import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import { createGenerationPageCallbacks, generatePagesWithRetry, uiText } from './generation-utils'
import { resolveCommonContext } from './context'
import { finalizeGenerationSuccess } from './finalization'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { customAlphabet, nanoid } from 'nanoid'
import { type LayoutIntent } from '@shared/layout-intent'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import { buildProjectIndexHtml, buildPageScaffoldHtml, type DeckPageFile } from '../engine/template'
import { planNewPage } from '../engine/generate'
import type { DesignContract } from '../../tools/types'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import { ensureHistoryBaselineSafe } from '../../history/git-history-service'

const pageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

// ── Independent AddPage context (not shared with generation/retry/edit) ──

export type AddPageContext = {
  sessionId: string
  runId: string
  userDescription: string
  insertAfterPageNumber: number
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
  messagePageId?: string
  projectId: string
  effectiveMode: 'addPage'
}

export async function resolveAddPageContext(
  ctx: IpcContext,
  sessionId: string,
  userDescription: string,
  insertAfterPageNumber: number
): Promise<AddPageContext> {
  log.info('[generate:addPage] resolving context', { sessionId, insertAfterPageNumber })
  const common = await resolveCommonContext(ctx, sessionId)
  const { sessionRecord } = common

  log.info('[generate:addPage] context resolved', {
    sessionId,
    projectDir: common.projectDir,
    styleId: common.styleId,
    provider: common.provider,
    model: common.model,
    insertAfterPageNumber
  })

  return {
    ...common,
    sessionId,
    userDescription,
    insertAfterPageNumber,
    sessionRecord,
    messageScope: 'main' as const,
    messagePageId: undefined,
    effectiveMode: 'addPage' as const
  }
}

// ── Execute the full add-page generation ──

export async function executeAddPageGeneration(
  ctx: IpcContext,
  context: AddPageContext
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
  const sessionRecord = context.sessionRecord
  const indexPath = path.join(context.projectDir, 'index.html')
  await ensureHistoryBaselineSafe(db, context.sessionId, context.projectDir)

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

  // ── Step 2: Read existing pages from session_pages ──
  const existingPages = await db.listSessionPages(context.sessionId)

  if (existingPages.length === 0) {
    throw new Error('当前会话没有已完成的页面，无法新增。请先完成首次生成。')
  }

  const insertAfterPageNumber = context.insertAfterPageNumber
  const userDescription = context.userDescription

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

  const newPageNumber = Math.max(...existingPages.map((p) => p.page_number)) + 1
  const newPageEntityId = nanoid()
  const newPageId = `page-${pageSlugId()}`
  const newHtmlPath = path.join(context.projectDir, `${newPageId}.html`)

  const existingTitles = existingPages.map((p) => p.title).filter(Boolean)

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
      topic: context.topic,
      existingTitles,
      signal: context.abortSignal
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
        topic: context.topic,
        existingTitles,
        signal: context.abortSignal
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
  await db.upsertSessionPage({
    id: newPageEntityId,
    sessionId: context.sessionId,
    legacyPageId: null,
    fileSlug: newPageId,
    pageNumber: newPageNumber,
    title: planResult.title,
    htmlPath: newHtmlPath,
    status: 'pending',
    error: null
  })

  const pageFileMap: Record<string, string> = { [newPageId]: newHtmlPath }
  const pageCallbacks = createGenerationPageCallbacks({
    db,
    runId: context.runId,
    sessionId: context.sessionId
  })
  try {
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
        userMessage: userDescription,
        outlineTitles: [planResult.title],
        outlineItems: [planResult],
        sourceDocumentPaths: [],
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
      retryDetail: uiText(
        context.appLocale,
        `页面生成失败，正在重试...`,
        `Page generation failed, retrying...`
      )
    })

    // ── Step 6: Validate generated page ──
    if (!fs.existsSync(newHtmlPath)) {
      throw new Error(`${newPageId}.html 缺失`)
    }
    const newPageValidation = validatePersistedPageHtml(
      await fs.promises.readFile(newHtmlPath, 'utf-8'),
      newPageId
    )
    if (!newPageValidation.valid) {
      throw new Error(
        `新页面 HTML 验证失败: ${newPageValidation.errors.join('; ')}`
      )
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Page generation failed'
    await db.upsertSessionPage({
      id: newPageEntityId,
      sessionId: context.sessionId,
      legacyPageId: null,
      fileSlug: newPageId,
      pageNumber: newPageNumber,
      title: planResult.title,
      htmlPath: newHtmlPath,
      status: 'failed',
      error: errorMessage
    })
    throw error
  }

  // ── Step 7: Merge into existing pages and renumber ──
  const newPageHtml = await fs.promises.readFile(newHtmlPath, 'utf-8')
  const newPageEntry = {
    id: newPageEntityId,
    pageNumber: insertAfterPageNumber + 1,
    title: planResult.title,
    pageId: newPageId,
    htmlPath: newHtmlPath,
    html: newPageHtml
  }

  // Read existing page HTMLs for the merge
  const existingPageDescriptors = await Promise.all(
    existingPages.map(async (page) => {
      const pageId = page.file_slug
      const htmlPath = page.html_path || path.join(context.projectDir, `${pageId}.html`)
      const html = fs.existsSync(htmlPath)
        ? await fs.promises.readFile(htmlPath, 'utf-8')
        : ''
      return {
        id: page.id,
        pageNumber: page.page_number,
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
          id: page.id,
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
  // Persist assistant message
  const assistantContent = uiText(
    context.appLocale,
    `已新增页面「${planResult.title}」并插入到第 ${insertAfterPageNumber} 页之后。`,
    `Added page "${planResult.title}" after page ${insertAfterPageNumber}.`
  )
  await db.addMessage(context.sessionId, {
    role: 'assistant',
    content: assistantContent,
    type: 'text',
    chat_scope: 'main' as const
  })
  emitChunk({
    type: 'assistant_message',
    payload: {
      runId: context.runId,
      content: assistantContent,
      chatType: 'main',
      pageId: undefined
    }
  })

  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: renumberedPages.length,
    generatedPages: renumberedPages
  })
}
