import type { IpcContext } from '../context'
import type { EditContext, EmitAssistantFn, GenerateChatType } from './types'
import { uiText } from './generation-utils'
import log from 'electron-log/main.js'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { normalizeLayoutIntent } from '@shared/layout-intent'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import type { DesignContract } from '../../tools/types'
import { parseSessionMetadata, derivePageNumber } from './metadata-parser'
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
  recordHistoryOperationSafe
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
  const userMessage = `${input.rawUserMessage}${formatImagePathsForPrompt(imagePaths)}`
  const chatType: GenerateChatType = input.chatType
  const chatPageId =
    chatType === 'page'
      ? input.chatPageId || input.selectedPageId
      : undefined
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
    image_paths: imagePaths
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

  const indexPath = context.htmlPath
    ? path.join(path.dirname(context.htmlPath), 'index.html')
    : path.join(context.entry.projectDir, 'index.html')
  const isMainScopeEdit = context.messageScope === 'main'
  const pageIdFromPath =
    typeof context.htmlPath === 'string'
      ? path.basename(context.htmlPath).match(/^(page-\d+)\.html$/i)?.[1]
      : undefined
  let resolvedSelectedPageId = isMainScopeEdit
    ? undefined
    : context.selectedPageId || pageIdFromPath
  const selectedSelector = isMainScopeEdit ? undefined : context.selector

  let outlineTitles: string[] = context.userProvidedOutlineTitles
  let pageRefs: Array<{ pageNumber: number; title: string; pageId: string; htmlPath: string }> =
    []
  let savedDesignContract: DesignContract | undefined
  let metadataFailedPages: Array<{ pageId: string; title: string; reason: string }> = []
  if (context.session?.metadata) {
    const metadata = parseSessionMetadata(context.session.metadata)
    if (outlineTitles.length === 0) {
      outlineTitles = (metadata.generatedPages || []).map((p) => p.title)
    }
    metadataFailedPages = (metadata.failedPages || [])
      .map((page) => ({
        pageId: typeof page.pageId === 'string' ? page.pageId.trim() : '',
        title: typeof page.title === 'string' ? page.title.trim() : '',
        reason: typeof page.reason === 'string' ? page.reason.trim() : ''
      }))
      .filter((page) => page.pageId.length > 0)
    pageRefs = (metadata.generatedPages || []).map((p, index) => {
      const pageId = p.pageId || `page-${p.pageNumber || index + 1}`
      return {
        pageNumber: Number(pageId.match(/^page-(\d+)$/i)?.[1]) || index + 1,
        title: p.title || `第${index + 1}页`,
        pageId,
        htmlPath: p.htmlPath || path.join(context.entry.projectDir, `${pageId}.html`)
      }
    })
  }
  const latestPageSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
  const pageRefById = new Map(pageRefs.map((ref) => [ref.pageId, ref]))
  for (const page of latestPageSnapshot) {
    const pageId = page.page_id || `page-${page.page_number}`
    if (pageRefById.has(pageId)) continue
    const pageNumber = Number(pageId.match(/^page-(\d+)$/i)?.[1]) || page.page_number
    const ref = {
      pageNumber,
      title: page.title || `第${pageNumber}页`,
      pageId,
      htmlPath: page.html_path || path.join(context.entry.projectDir, `${pageId}.html`)
    }
    pageRefs.push(ref)
    pageRefById.set(pageId, ref)
  }
  const failedPageInfoById = new Map<string, { title: string; reason: string }>()
  for (const page of latestPageSnapshot) {
    if (page.status !== 'failed') continue
    const pageId = page.page_id || `page-${page.page_number}`
    failedPageInfoById.set(pageId, {
      title: page.title || `第${page.page_number}页`,
      reason: page.error || '页面仍需修复'
    })
  }
  for (const page of metadataFailedPages) {
    if (!failedPageInfoById.has(page.pageId)) {
      failedPageInfoById.set(page.pageId, {
        title: page.title || page.pageId,
        reason: page.reason || '页面仍需修复'
      })
    }
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
  if (outlineTitles.length === 0) {
    outlineTitles = Array.from({ length: context.totalPages }, (_unused, i) => `第${i + 1}页`)
  }
  if (pageRefs.length === 0) {
    const diskPageIds = fs.existsSync(context.entry.projectDir)
      ? fs
          .readdirSync(context.entry.projectDir)
          .map((name) => name.match(/^(page-(\d+))\.html$/i))
          .filter((m): m is RegExpMatchArray => Boolean(m))
          .sort((a, b) => Number(a[2]) - Number(b[2]))
          .map((m) => m[1])
      : []
    const ids =
      diskPageIds.length > 0 ? diskPageIds : outlineTitles.map((_title, i) => `page-${i + 1}`)
    pageRefs = ids.map((pid, index) => ({
      pageNumber: Number(pid.match(/^page-(\d+)$/i)?.[1] || index + 1),
      title: outlineTitles[index] || `第${index + 1}页`,
      pageId: pid,
      htmlPath: path.join(context.entry.projectDir, `${pid}.html`)
    }))
  }
  if (
    !isMainScopeEdit &&
    resolvedSelectedPageId &&
    !pageRefs.some((ref) => ref.pageId === resolvedSelectedPageId)
  ) {
    const inferredNumber = Number(
      resolvedSelectedPageId.match(/^page-(\d+)$/i)?.[1] || pageRefs.length + 1
    )
    pageRefs.push({
      pageNumber: inferredNumber,
      title: outlineTitles[inferredNumber - 1] || `第${inferredNumber}页`,
      pageId: resolvedSelectedPageId,
      htmlPath: path.join(context.entry.projectDir, `${resolvedSelectedPageId}.html`)
    })
  }
  pageRefs.sort((a, b) => a.pageNumber - b.pageNumber)
  if (!isMainScopeEdit && !resolvedSelectedPageId && pageRefs.length > 0) {
    resolvedSelectedPageId = pageRefs[0].pageId
  }
  const resolvedSelectedPageNumber = !isMainScopeEdit
    ? Number(resolvedSelectedPageId?.match(/^page-(\d+)$/i)?.[1] || 0) ||
      pageRefs.find((ref) => ref.pageId === resolvedSelectedPageId)?.pageNumber ||
      undefined
    : undefined
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
      editScope: isMainScopeEdit ? 'main' : 'page',
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
    isMainScopeEdit
      ? uiText(
          context.appLocale,
          `我准备开始调整「${context.topic}」了。目标：主会话总览壳（index.html），我只会修改切换演示动画与交互层动画。`,
          `I am ready to adjust "${context.topic}". Target: the main overview shell (index.html). I will only modify transition and interaction-layer animations.`
        )
      : uiText(
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

  const editSummaryFromEngine = await runDeepAgentEdit({
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
    editScope: isMainScopeEdit ? 'main' : 'page',
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
  })
  const afterIndexHtml = fs.existsSync(indexPath)
    ? await fs.promises.readFile(indexPath, 'utf-8')
    : ''
  const indexChanged = beforeIndexHtml !== afterIndexHtml
  if (indexChanged) {
    const indexValidationErrors = validateProjectIndexHtml(afterIndexHtml)
    if (indexValidationErrors.length > 0) {
      const details = indexValidationErrors.join('; ')
      await db.updateGenerationRunStatus(context.runId, 'failed', details)
      throw new Error(`index.html 验证失败: ${details}`)
    }
  }

  const pageDescriptors: Array<{
    pageNumber: number
    title: string
    pageId: string
    html: string
    htmlPath: string
  }> = []
  const changedPageDescriptors: Array<{
    pageNumber: number
    title: string
    pageId: string
    html: string
    htmlPath: string
  }> = []
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
    const page: GeneratedPagePayload = {
      pageNumber: ref.pageNumber,
      title: ref.title,
      html,
      pageId: ref.pageId,
      htmlPath: ref.htmlPath,
      sourceUrl: getPageSourceUrl(ref.htmlPath)
    }
    pageDescriptors.push({
      pageNumber: ref.pageNumber,
      title: ref.title,
      pageId: ref.pageId,
      html,
      htmlPath: ref.htmlPath
    })
    const isExisting = existingPageIdsBeforeRun.includes(ref.pageId)
    const changed = beforeMap.get(ref.pageId) !== html
    if (!changed && isExisting) continue
    changedPageDescriptors.push({
      pageNumber: ref.pageNumber,
      title: ref.title,
      pageId: ref.pageId,
      html,
      htmlPath: ref.htmlPath
    })
    emitEditChunk({
      type: isExisting ? 'page_updated' : 'page_generated',
      payload: {
        runId: context.runId,
        stage: 'editing',
        label: progressText(context.appLocale, 'completed'),
        progress: 90,
        currentPage: page.pageNumber,
        totalPages: pageRefs.length,
        ...page
      }
    })
  }

  const invalidChangedPages = changedPageDescriptors
    .map((page) => {
      const validation = validatePersistedPageHtml(page.html, page.pageId)
      return validation.valid
        ? null
        : {
            page,
            reason: validation.errors.join('; ')
          }
    })
    .filter(
      (
        item
      ): item is {
        page: {
          pageNumber: number
          title: string
          pageId: string
          html: string
          htmlPath: string
        }
        reason: string
      } => Boolean(item)
    )
  if (invalidChangedPages.length > 0) {
    const details = invalidChangedPages
      .map((item) => `${item.page.pageId}（${item.page.title}）：${item.reason}`)
      .join('；')
    await db.updateGenerationRunStatus(context.runId, 'failed', details)
    throw new Error(`页面编辑结果验证失败：${details}`)
  }

  const changedPageIdSet = new Set(changedPageDescriptors.map((page) => page.pageId))
  for (const page of changedPageDescriptors) {
    const outlineItem = outlineItems.find(
      (_item, index) => pageRefs[index]?.pageId === page.pageId
    )
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: derivePageNumber(page.pageId, page.pageNumber),
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
      : indexChanged
        ? uiText(
            context.appLocale,
            '修改完成：已更新 index.html 总览壳交互。',
            'Edit completed: updated index.html overview-shell interactions.'
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
    generatedPages: generatedPagesForMetadata.map((page) => ({
      pageNumber: derivePageNumber(page.pageId, page.pageNumber),
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath
    })),
    failedPages: remainingFailedPages,
    indexPath,
    projectId: context.projectId
  })
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
    await recordHistoryOperationSafe(db, {
      sessionId: context.sessionId,
      projectDir: context.entry.projectDir,
      type: 'edit',
      scope: selectedSelector ? 'selector' : isMainScopeEdit ? 'shell' : 'page',
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
