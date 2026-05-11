import type { IpcContext } from '../context'
import type { EditContext, EmitAssistantFn, GenerateChatType } from './types'
import {
  buildEditNoChangeRetryMessage,
  buildEditToolSchemaRetryMessage,
  buildEditValidationRetryMessage,
  type EditedPageDescriptor,
  isEditToolSchemaRetryableError,
  isEditValidationRetryableError,
  resolvePageHtmlPath,
  uiText,
  validateChangedPages
} from './generation-utils'
import log from 'electron-log/main.js'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import { normalizeLayoutIntent } from '@shared/layout-intent'
import type { DesignContract } from '../../tools/types'
import { runDeepAgentEdit } from '../engine/generate'
import type { GeneratedPagePayload } from '@shared/generation'
import {
  buildOutlineTitles,
  buildTotalPages,
  normalizeGeneratePayload,
  resolveCommonContext
} from './context'
import {
  ensureHistoryBaselineSafe,
  recordHistoryOperationStrict
} from '../../history/git-history-service'

export async function resolveEditContext(
  ctx: IpcContext,
  _event: Electron.IpcMainInvokeEvent,
  payload: unknown
): Promise<EditContext> {
  const input = normalizeGeneratePayload(payload)
  const { db, formatImagePathsForPrompt } = ctx
  if (!input.sessionId) throw new Error('sessionId 不能为空')

  const common = await resolveCommonContext(ctx, input.sessionId)
  const imagePaths = input.rawImagePaths
  const videoPaths = input.rawVideoPaths
  const userMessage = `${input.rawUserMessage}${formatImagePathsForPrompt(imagePaths, videoPaths)}`
  const chatType: GenerateChatType = input.chatType
  const chatPageId = chatType === 'page' ? input.chatPageId || input.selectedPageId : undefined
  if (chatType === 'page' && !chatPageId) {
    throw new Error('chatType=page requires chatPageId or selectedPageId')
  }

  await db.addMessage(input.sessionId, {
    role: 'user',
    content: input.rawUserMessage,
    type: 'text',
    chat_scope: chatType,
    page_id: chatType === 'page' ? chatPageId : undefined,
    selector: chatType === 'page' ? input.selector : undefined,
    image_paths: imagePaths,
    video_paths: videoPaths
  })
  await db.updateSessionStatus(input.sessionId, 'active')

  return {
    sessionId: input.sessionId,
    userMessage,
    requestedType: 'page',
    effectiveMode: 'edit',
    selectedPageId: input.selectedPageId,
    htmlPath: input.htmlPath,
    selector: input.selector,
    elementTag: input.elementTag,
    elementText: input.elementText,
    session: common.session,
    sessionRecord: common.sessionRecord,
    previousSessionStatus: common.previousSessionStatus,
    entry: common.entry,
    runId: common.runId,
    styleId: common.styleId,
    styleSkill: common.styleSkill,
    userProvidedOutlineTitles: buildOutlineTitles(input.rawUserMessage),
    totalPages: buildTotalPages(common.sessionRecord),
    provider: common.provider,
    apiKey: common.apiKey,
    model: common.model,
    modelTimeouts: common.modelTimeouts,
    providerBaseUrl: common.providerBaseUrl,
    projectId: common.projectId,
    messageScope: chatType,
    messagePageId: chatType === 'page' ? chatPageId : undefined,
    imagePaths,
    videoPaths,
    sourceDocumentPaths: [],
    topic: common.topic,
    deckTitle: common.deckTitle,
    appLocale: common.appLocale
  }
}

export async function executeEditGeneration(
  ctx: IpcContext,
  emitAssistant: EmitAssistantFn,
  context: EditContext
): Promise<void> {
  const {
    db,
    agentManager,
    getPageSourceUrl,
    validateProjectIndexHtml,
    createDeckProgressEmitter,
    PAGE_EDIT_WITH_SELECTOR_TEMPERATURE,
    PAGE_EDIT_DEFAULT_TEMPERATURE
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }
  if (context.messageScope === 'main') {
    throw new Error('主会话编辑需要走 deck 全页编辑流程，不能进入单页编辑流程。')
  }

  const indexPath = path.join(context.entry.projectDir, 'index.html')
  const pageIdFromPath =
    typeof context.htmlPath === 'string'
      ? path.basename(context.htmlPath).match(/^([a-z0-9_-]+)\.html$/i)?.[1]
      : undefined
  let resolvedSelectedPageId = context.selectedPageId || pageIdFromPath
  const selectedSelector = context.selector

  let outlineTitles: string[] = context.userProvidedOutlineTitles
  let pageRefs: Array<{ id: string; pageNumber: number; title: string; pageId: string; htmlPath: string }> = []
  let savedDesignContract: DesignContract | undefined
  const sessionPages = await db.listSessionPages(context.sessionId)
  if (sessionPages.length === 0) {
    throw new Error('session_pages is empty after migration; cannot edit this session')
  }
  const selectedSessionPage = resolvedSelectedPageId
    ? sessionPages.find(
        (page) => page.id === resolvedSelectedPageId || page.file_slug === resolvedSelectedPageId
      )
    : undefined
  if (selectedSessionPage) {
    resolvedSelectedPageId = selectedSessionPage.file_slug
  }
  pageRefs = sessionPages.map((page) => ({
    id: page.id,
    pageNumber: page.page_number,
    title: page.title || `第${page.page_number}页`,
    pageId: page.file_slug,
    htmlPath: resolvePageHtmlPath({
      projectDir: context.entry.projectDir,
      fileSlug: page.file_slug,
      candidates: [page.html_path]
    })
  }))
  if (outlineTitles.length === 0) {
    outlineTitles = pageRefs.map((page) => page.title)
  }
  const latestPageSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
  const failedPageInfoById = new Map<string, { title: string; reason: string }>()
  for (const page of sessionPages) {
    if (page.status !== 'failed') continue
    failedPageInfoById.set(page.file_slug, {
      title: page.title || page.file_slug,
      reason: page.error || '页面仍需修复'
    })
  }
  // Read designContract from the dedicated column
  const sessionRecord = (context.session || {}) as Record<string, unknown>
  if (
    typeof sessionRecord.designContract === 'string' &&
    sessionRecord.designContract.trim().length > 0
  ) {
    try {
      savedDesignContract = JSON.parse(sessionRecord.designContract) as DesignContract
    } catch {
      /* ignore */
    }
  }
  if (resolvedSelectedPageId && !pageRefs.some((ref) => ref.pageId === resolvedSelectedPageId)) {
    throw new Error(`Selected page not found in session_pages: ${resolvedSelectedPageId}`)
  }
  pageRefs.sort((a, b) => a.pageNumber - b.pageNumber)
  if (!resolvedSelectedPageId && pageRefs.length > 0) {
    resolvedSelectedPageId = pageRefs[0].pageId
  }
  const resolvedSelectedPageNumber =
    pageRefs.find((ref) => ref.pageId === resolvedSelectedPageId)?.pageNumber ||
    undefined
  if (outlineTitles.length !== pageRefs.length) {
    outlineTitles = pageRefs.map((ref) => ref.title)
  }

  const outlineByPageId = new Map(
    latestPageSnapshot.map((page) => [page.page_id, page.content_outline || ''])
  )
  const layoutIntentByPageId = new Map(
    latestPageSnapshot.map((page) => [
      page.page_id,
      page.layout_intent ? normalizeLayoutIntent(page.layout_intent) : undefined
    ])
  )
  const outlineItems = pageRefs.map((ref) => ({
    title: ref.title,
    contentOutline: outlineByPageId.get(ref.pageId) || '',
    layoutIntent: layoutIntentByPageId.get(ref.pageId)
  }))
  const pageFileMap = Object.fromEntries(pageRefs.map((p) => [p.pageId, p.htmlPath]))
  const beforeMap = new Map<string, string>()
  const existingPageIdsBeforeRun: string[] = []
  const beforeReads = await Promise.all(
    pageRefs.map(async (ref) => {
      if (!fs.existsSync(ref.htmlPath)) return null
      const html = await fs.promises.readFile(ref.htmlPath, 'utf-8')
      return { pageId: ref.pageId, html }
    })
  )
  for (const item of beforeReads) {
    if (!item) continue
    existingPageIdsBeforeRun.push(item.pageId)
    beforeMap.set(item.pageId, item.html)
  }

  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'edit',
    totalPages: pageRefs.length,
    metadata: {
      editScope: 'page',
      selectedPageId: resolvedSelectedPageId || null,
      selector: selectedSelector || null
    }
  })
  const emitEditChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)

  emitEditChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'editing',
      label: progressText(context.appLocale, 'understanding'),
      progress: 10,
      totalPages: outlineTitles.length
    }
  })

  await emitAssistant(
    context,
    uiText(
      context.appLocale,
      `我准备开始调整「${context.topic}」了。目标：${resolvedSelectedPageId ? `第 ${resolvedSelectedPageNumber ?? '?'} 页` : '按你的指令智能定位'}${selectedSelector ? `（选择器：${selectedSelector}）` : ''}。`,
      `I am ready to adjust "${context.topic}". Target: ${resolvedSelectedPageId ? `page ${resolvedSelectedPageNumber ?? '?'}` : 'infer from your instruction'}${selectedSelector ? ` (selector: ${selectedSelector})` : ''}.`
    )
  )
  const editTemperature = selectedSelector
    ? PAGE_EDIT_WITH_SELECTOR_TEMPERATURE
    : PAGE_EDIT_DEFAULT_TEMPERATURE

  const beforeIndexHtml = fs.existsSync(indexPath)
    ? await fs.promises.readFile(indexPath, 'utf-8')
    : ''
  await ensureHistoryBaselineSafe(db, context.sessionId, context.entry.projectDir)

  const editRunArgs = {
    sessionId: context.sessionId,
    provider: context.provider,
    apiKey: context.apiKey,
    model: context.model,
    baseUrl: context.providerBaseUrl,
    modelTimeoutMs: context.modelTimeouts.agent,
    temperature: editTemperature,
    styleId: context.styleId,
    styleSkillPrompt: context.styleSkill.prompt,
    appLocale: context.appLocale,
    topic: context.topic,
    deckTitle: context.deckTitle,
    userMessage: context.userMessage,
    outlineTitles,
    outlineItems,
    projectDir: context.entry.projectDir,
    indexPath,
    pageFileMap,
    designContract: savedDesignContract,
    editScope: 'page',
    selectedPageId: resolvedSelectedPageId,
    selectedPageNumber: resolvedSelectedPageNumber,
    selectedSelector,
    elementTag: context.elementTag,
    elementText: context.elementText,
    existingPageIds: existingPageIdsBeforeRun,
    agentManager,
    emit: (chunk) => emitEditChunk(chunk),
    runId: context.runId,
    signal: context.entry.abortController.signal
  } satisfies Parameters<typeof runDeepAgentEdit>[0]
  const runEditAttempt = async (userMessage: string, retryDetail?: string): Promise<string> => {
    if (retryDetail) {
      emitEditChunk({
        type: 'llm_status',
        payload: {
          runId: context.runId,
          stage: 'editing',
          label: progressText(context.appLocale, 'retrying'),
          progress: 55,
          totalPages: pageRefs.length,
          detail: retryDetail
        }
      })
    }
    return runDeepAgentEdit({ ...editRunArgs, userMessage })
  }
  let editSummaryFromEngine = ''
  let editToolSchemaRetryUsed = false
  let editValidationRetryUsed = false
  const failWithUserMessage = async (userMessage: string): Promise<never> => {
    await db.updateGenerationRunStatus(context.runId, 'failed', userMessage)
    throw new Error(userMessage)
  }
  const runRetryAttempt = async (
    userMessage: string,
    retryDetail: string,
    failureMessage: string,
    logLabel: string
  ): Promise<string> => {
    try {
      return await runEditAttempt(userMessage, retryDetail)
    } catch (retryError) {
      log.error(logLabel, {
        sessionId: context.sessionId,
        runId: context.runId,
        detail: retryError instanceof Error ? retryError.message : String(retryError)
      })
      return failWithUserMessage(failureMessage)
    }
  }
  try {
    editSummaryFromEngine = await runEditAttempt(context.userMessage)
  } catch (error) {
    const canRetryByValidation = isEditValidationRetryableError(error)
    const canRetryBySchema = isEditToolSchemaRetryableError(error)
    if (!canRetryByValidation && !canRetryBySchema) throw error
    if (canRetryBySchema) {
      editToolSchemaRetryUsed = true
    } else {
      editValidationRetryUsed = true
    }
    const detail = error instanceof Error ? error.message : String(error)
    log.warn('[generate:start] edit validation/tool retry scheduled', {
      sessionId: context.sessionId,
      runId: context.runId,
      detail,
      kind: canRetryBySchema ? 'tool_schema' : 'validation'
    })
    const retryMessage = canRetryBySchema
      ? buildEditToolSchemaRetryMessage({
          originalMessage: context.userMessage,
          detail,
          allowedTool: selectedSelector ? 'edit_file' : 'update_single_page_file',
          selectedPageId: resolvedSelectedPageId || null
        })
      : buildEditValidationRetryMessage(context.userMessage, detail)
    editSummaryFromEngine = await runRetryAttempt(
      retryMessage,
      uiText(
        context.appLocale,
        canRetryBySchema
          ? '工具调用参数不完整，正在自动重试一次。'
          : '页面校验失败，正在自动重试一次。',
        canRetryBySchema
          ? 'Tool call schema invalid; retrying once.'
          : 'Page validation failed; retrying once.'
      ),
      uiText(
        context.appLocale,
        '页面编辑重试失败，请重新描述要修改的内容。',
        'Page edit retry failed. Please describe the desired change again.'
      ),
      '[generate:start] edit retry failed'
    )
  }
  const afterIndexHtml = fs.existsSync(indexPath)
    ? await fs.promises.readFile(indexPath, 'utf-8')
    : ''
  const indexChanged = beforeIndexHtml !== afterIndexHtml
  if (indexChanged) {
    const indexValidationErrors = validateProjectIndexHtml(afterIndexHtml)
    if (indexValidationErrors.length > 0) {
      const details = indexValidationErrors.join('; ')
      log.error('[generate:start] edit index validation failed', {
        sessionId: context.sessionId,
        runId: context.runId,
        details
      })
      await failWithUserMessage(
        uiText(
          context.appLocale,
          '页面壳层校验失败，请重新描述要修改的内容。',
          'Page shell validation failed. Please describe the desired change again.'
        )
      )
    }
  }

  let pageDescriptors: EditedPageDescriptor[] = []
  let changedPageDescriptors: EditedPageDescriptor[] = []
  const readEditedPages = async (): Promise<{
    pageDescriptors: typeof pageDescriptors
    changedPageDescriptors: typeof changedPageDescriptors
  }> => {
    const nextPageDescriptors: typeof pageDescriptors = []
    const nextChangedPageDescriptors: typeof changedPageDescriptors = []
    const editedPageReads = await Promise.all(
      pageRefs.map(async (ref) => {
        if (!fs.existsSync(ref.htmlPath)) return null
        const html = await fs.promises.readFile(ref.htmlPath, 'utf-8')
        return { ref, html }
      })
    )
    for (const item of editedPageReads) {
      if (!item) continue
      const { ref, html } = item
      nextPageDescriptors.push({
        id: ref.id,
        pageNumber: ref.pageNumber,
        title: ref.title,
        pageId: ref.pageId,
        html,
        htmlPath: ref.htmlPath
      })
      const isExisting = existingPageIdsBeforeRun.includes(ref.pageId)
      const changed = beforeMap.get(ref.pageId) !== html
      if (!changed && isExisting) continue
      nextChangedPageDescriptors.push({
        id: ref.id,
        pageNumber: ref.pageNumber,
        title: ref.title,
        pageId: ref.pageId,
        html,
        htmlPath: ref.htmlPath
      })
    }
    return {
      pageDescriptors: nextPageDescriptors,
      changedPageDescriptors: nextChangedPageDescriptors
    }
  }
  ;({ pageDescriptors, changedPageDescriptors } = await readEditedPages())

  if (!selectedSelector && changedPageDescriptors.length === 0) {
    const detail = uiText(
      context.appLocale,
      '本次编辑没有检测到任何页面落盘变化。',
      'The edit completed without any detected page changes.'
    )
    log.warn('[generate:start] edit no-change retry scheduled', {
      sessionId: context.sessionId,
      runId: context.runId,
      selectedPageId: resolvedSelectedPageId || null,
      detail,
      schemaRetryUsed: editToolSchemaRetryUsed
    })
    editSummaryFromEngine = await runRetryAttempt(
      buildEditNoChangeRetryMessage({
        originalMessage: context.userMessage,
        allowedTool: 'update_single_page_file',
        selectedPageId: resolvedSelectedPageId || null
      }),
      uiText(
        context.appLocale,
        '没有检测到页面变化，正在自动重试一次。',
        'No page changes detected; retrying once.'
      ),
      uiText(
        context.appLocale,
        '页面编辑重试后仍未产生变化，请重新描述要修改的内容。',
        'The page edit still did not produce changes after retry. Please describe the desired change again.'
      ),
      '[generate:start] edit no-change retry failed'
    )
    ;({ pageDescriptors, changedPageDescriptors } = await readEditedPages())
    if (changedPageDescriptors.length === 0) {
      const message = uiText(
        context.appLocale,
        '页面编辑没有产生任何落盘变化，请重新描述要修改的页面内容。',
        'The page edit did not produce any persisted page changes. Please describe the desired page content change again.'
      )
      await db.updateGenerationRunStatus(context.runId, 'failed', message)
      throw new Error(message)
    }
  }

  const invalidChangedPages = validateChangedPages(changedPageDescriptors)
  if (invalidChangedPages.length > 0) {
    const details = invalidChangedPages
      .map((item) => `${item.page.pageId}（${item.page.title}）：${item.reason}`)
      .join('；')
    if (editValidationRetryUsed) {
      log.error('[generate:start] edit result validation failed after retry', {
        sessionId: context.sessionId,
        runId: context.runId,
        details
      })
      await failWithUserMessage(
        uiText(
          context.appLocale,
          '页面编辑结果校验失败，请重新描述要修改的内容。',
          'Page edit validation failed. Please describe the desired change again.'
        )
      )
    }
    editValidationRetryUsed = true
    log.warn('[generate:start] edit result validation retry scheduled', {
      sessionId: context.sessionId,
      runId: context.runId,
      details
    })
    editSummaryFromEngine = await runRetryAttempt(
      buildEditValidationRetryMessage(context.userMessage, `页面编辑结果验证失败：${details}`),
      uiText(
        context.appLocale,
        '页面校验失败，正在自动重试一次。',
        'Page validation failed; retrying once.'
      ),
      uiText(
        context.appLocale,
        '页面编辑重试失败，请重新描述要修改的内容。',
        'Page edit retry failed. Please describe the desired change again.'
      ),
      '[generate:start] edit validation retry failed'
    )
    ;({ pageDescriptors, changedPageDescriptors } = await readEditedPages())
    const retryInvalidChangedPages = validateChangedPages(changedPageDescriptors)
    if (retryInvalidChangedPages.length > 0) {
      const retryDetails = retryInvalidChangedPages
        .map((item) => `${item.page.pageId}（${item.page.title}）：${item.reason}`)
        .join('；')
      log.error('[generate:start] edit result validation failed after retry', {
        sessionId: context.sessionId,
        runId: context.runId,
        details: retryDetails
      })
      await failWithUserMessage(
        uiText(
          context.appLocale,
          '页面编辑结果校验失败，请重新描述要修改的内容。',
          'Page edit validation failed. Please describe the desired change again.'
        )
      )
    }
  }

  for (const page of changedPageDescriptors) {
    const isExisting = existingPageIdsBeforeRun.includes(page.pageId)
    const payload: GeneratedPagePayload = {
      id: page.id,
      pageNumber: page.pageNumber,
      title: page.title,
      html: page.html,
      pageId: page.pageId,
      htmlPath: page.htmlPath,
      sourceUrl: getPageSourceUrl(page.htmlPath)
    }
    emitEditChunk({
      type: isExisting ? 'page_updated' : 'page_generated',
      payload: {
        runId: context.runId,
        stage: 'editing',
        label: progressText(context.appLocale, 'completed'),
        progress: 90,
        currentPage: page.pageNumber,
        totalPages: pageRefs.length,
        ...payload
      }
    })
  }

  const changedPageIdSet = new Set(changedPageDescriptors.map((page) => page.pageId))
  for (const page of changedPageDescriptors) {
    const outlineItem = outlineItems.find((_item, index) => pageRefs[index]?.pageId === page.pageId)
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: outlineItem?.contentOutline || '',
      layoutIntent: outlineItem?.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'completed'
    })
  }

  const remainingFailedPageInfoById = new Map(failedPageInfoById)
  for (const pageId of changedPageIdSet) {
    remainingFailedPageInfoById.delete(pageId)
  }
  const generatedPagesForMetadata = pageDescriptors.filter(
    (page) => !remainingFailedPageInfoById.has(page.pageId)
  )
  const remainingFailedPages = Array.from(remainingFailedPageInfoById.entries()).map(
    ([pageId, info]) => ({
      pageId,
      title: info.title || pageRefs.find((ref) => ref.pageId === pageId)?.title || pageId,
      reason: info.reason || '页面仍需修复'
    })
  )

  const changedPages = changedPageDescriptors
    .map((p) => uiText(context.appLocale, `第${p.pageNumber}页`, `page ${p.pageNumber}`))
    .join(uiText(context.appLocale, '、', ', '))
  const editSummary =
    changedPageDescriptors.length > 0
      ? uiText(
          context.appLocale,
          `修改完成：${changedPages}${selectedSelector ? `（目标选择器：${selectedSelector}）` : ''}。`,
          `Edit completed: ${changedPages}${selectedSelector ? ` (target selector: ${selectedSelector})` : ''}.`
        )
      : editSummaryFromEngine.trim() ||
        uiText(
          context.appLocale,
          '我已经检查过了，这次没有检测到需要落盘的页面变化。',
          'I checked the session and did not detect page changes that needed to be written this time.'
        )
  await emitAssistant(context, editSummary)

  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    indexPath,
    projectId: context.projectId
  })
  const existingSessionPages = await db.listSessionPages(context.sessionId, { includeDeleted: true })
  const existingBySlug = new Map(existingSessionPages.map((sp) => [sp.file_slug, sp]))
  for (const page of generatedPagesForMetadata) {
    const existing = existingBySlug.get(page.pageId)
    await db.upsertSessionPage({
      id: existing?.id || nanoid(),
      sessionId: context.sessionId,
      legacyPageId: existing?.legacy_page_id || (page.pageId.match(/^page-\d+$/) ? page.pageId : null),
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      status: 'completed',
      error: null
    })
  }
  await db.updateProjectStatus(context.projectId, 'draft')
  await db.updateSessionStatus(
    context.sessionId,
    remainingFailedPages.length > 0 ? 'failed' : 'completed'
  )
  await db.updateGenerationRunStatus(
    context.runId,
    remainingFailedPages.length > 0 ? 'partial' : 'completed',
    remainingFailedPages.length > 0
      ? remainingFailedPages
          .map((page) => `${page.pageId}（${page.title}）：${page.reason}`)
          .join('；')
      : null
  )
  if (remainingFailedPages.length === 0) {
    await recordHistoryOperationStrict(db, {
      sessionId: context.sessionId,
      projectDir: context.entry.projectDir,
      type: 'edit',
      scope: selectedSelector ? 'selector' : 'page',
      prompt: context.userMessage,
      metadata: {
        runId: context.runId,
        selectedPageId: resolvedSelectedPageId || null,
        selector: selectedSelector || null
      }
    })
  }
  log.info('[generate:start] edit completed', {
    sessionId: context.sessionId,
    styleId: context.styleId,
    changedPages: Array.from(changedPageIdSet),
    remainingFailedPages: remainingFailedPages.map((page) => page.pageId)
  })
  emitEditChunk({
    type: 'run_completed',
    payload: {
      runId: context.runId,
      totalPages: pageRefs.length
    }
  })
}
