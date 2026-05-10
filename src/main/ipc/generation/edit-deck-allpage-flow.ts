import fs from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { nanoid } from 'nanoid'
import { progressText } from '@shared/progress'
import { normalizeLayoutIntent } from '@shared/layout-intent'
import type { GeneratedPagePayload } from '@shared/generation'
import type { IpcContext } from '../context'
import type { EditContext, EmitAssistantFn } from './types'
import {
  buildEditValidationRetryMessage,
  type EditedPageDescriptor,
  isEditValidationRetryableError,
  uiText,
  validateChangedPages
} from './generation-utils'
import type { DesignContract } from '../../tools/types'
import { runDeepAgentDeckAllPageEdit } from '../engine/generate'
import {
  ensureHistoryBaselineSafe,
  recordHistoryOperationSafe
} from '../../history/git-history-service'

export async function executeDeckAllPageEditGeneration(
  ctx: IpcContext,
  emitAssistant: EmitAssistantFn,
  context: EditContext
): Promise<void> {
  const {
    db,
    agentManager,
    getPageSourceUrl,
    createDeckProgressEmitter,
    PAGE_EDIT_DEFAULT_TEMPERATURE
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }
  if (context.messageScope !== 'main') {
    throw new Error('deck 全页编辑只接受主会话消息。')
  }

  const projectDir = context.entry.projectDir
  const indexPath = path.join(projectDir, 'index.html')
  let outlineTitles: string[] = context.userProvidedOutlineTitles
  let pageRefs: Array<{ id: string; pageNumber: number; title: string; pageId: string; htmlPath: string }> = []
  let savedDesignContract: DesignContract | undefined

  const sessionPages = await db.listSessionPages(context.sessionId)
  if (sessionPages.length === 0) {
    throw new Error('session_pages is empty after migration; cannot edit this session')
  }
  pageRefs = sessionPages.map((page) => ({
    id: page.id,
    pageNumber: page.page_number,
    title: page.title || `第${page.page_number}页`,
    pageId: page.file_slug,
    htmlPath: page.html_path || path.join(projectDir, `${page.file_slug}.html`)
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

  const sessionRecord = (context.session || {}) as Record<string, unknown>
  if (
    typeof sessionRecord.designContract === 'string' &&
    sessionRecord.designContract.trim().length > 0
  ) {
    try {
      savedDesignContract = JSON.parse(sessionRecord.designContract) as DesignContract
    } catch {
      /* ignore invalid persisted design contract */
    }
  }

  pageRefs.sort((a, b) => a.pageNumber - b.pageNumber)
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
  const allowedPageIds = pageRefs.map((p) => p.pageId)
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
      editScope: 'deck',
      selectedPageId: null,
      selector: null
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
      `我准备按主会话指令调整「${context.topic}」的页面内容；本次只会写入 /<pageId>.html，不会修改 index.html。`,
      `I am ready to update page content for "${context.topic}" from the main-session instruction; this run only writes /<pageId>.html and will not modify index.html.`
    )
  )

  const beforeIndexExists = fs.existsSync(indexPath)
  const beforeIndexHtml = beforeIndexExists ? await fs.promises.readFile(indexPath, 'utf-8') : ''
  await ensureHistoryBaselineSafe(db, context.sessionId, projectDir)

  const editRunArgs = {
    sessionId: context.sessionId,
    provider: context.provider,
    apiKey: context.apiKey,
    model: context.model,
    baseUrl: context.providerBaseUrl,
    modelTimeoutMs: context.modelTimeouts.agent,
    temperature: PAGE_EDIT_DEFAULT_TEMPERATURE,
    styleId: context.styleId,
    styleSkillPrompt: context.styleSkill.prompt,
    appLocale: context.appLocale,
    topic: context.topic,
    deckTitle: context.deckTitle,
    userMessage: context.userMessage,
    outlineTitles,
    outlineItems,
    projectDir,
    indexPath,
    pageFileMap,
    designContract: savedDesignContract,
    existingPageIds: existingPageIdsBeforeRun,
    agentManager,
    emit: (chunk) => emitEditChunk(chunk),
    runId: context.runId,
    signal: context.entry.abortController.signal
  } satisfies Parameters<typeof runDeepAgentDeckAllPageEdit>[0]
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
    return runDeepAgentDeckAllPageEdit({ ...editRunArgs, userMessage })
  }
  let editSummaryFromEngine = ''
  let editValidationRetryUsed = false
  try {
    editSummaryFromEngine = await runEditAttempt(context.userMessage)
  } catch (error) {
    if (!isEditValidationRetryableError(error)) throw error
    editValidationRetryUsed = true
    const detail = error instanceof Error ? error.message : String(error)
    log.warn('[generate:start] deck all-page edit validation/tool retry scheduled', {
      sessionId: context.sessionId,
      runId: context.runId,
      detail
    })
    editSummaryFromEngine = await runEditAttempt(
      buildEditValidationRetryMessage(context.userMessage, detail),
      uiText(
        context.appLocale,
        `校验失败，正在带错误信息自动重试一次：${detail}`,
        `Validation failed; retrying once with the error: ${detail}`
      )
    )
  }

  const afterIndexHtml = fs.existsSync(indexPath)
    ? await fs.promises.readFile(indexPath, 'utf-8')
    : ''
  if (beforeIndexHtml !== afterIndexHtml) {
    let restored = false
    try {
      if (beforeIndexExists) {
        await fs.promises.writeFile(indexPath, beforeIndexHtml, 'utf-8')
      }
      restored = true
    } catch (error) {
      log.error('[generate:start] failed to restore index.html after deck edit', {
        sessionId: context.sessionId,
        indexPath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    const message = restored
      ? '主会话 deck 编辑不允许修改 index.html，本次检测到壳层变更并已恢复。请重新描述只针对页面内容的修改。'
      : '主会话 deck 编辑不允许修改 index.html，本次检测到壳层变更且自动恢复失败，请手动检查项目文件。'
    await db.updateGenerationRunStatus(context.runId, 'failed', message)
    throw new Error(message)
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

  const invalidChangedPages = validateChangedPages(changedPageDescriptors)
  if (invalidChangedPages.length > 0) {
    const details = invalidChangedPages
      .map((item) => `${item.page.pageId}（${item.page.title}）：${item.reason}`)
      .join('；')
    if (editValidationRetryUsed) {
      await db.updateGenerationRunStatus(context.runId, 'failed', details)
      throw new Error(`页面编辑结果验证失败：${details}`)
    }
    editValidationRetryUsed = true
    log.warn('[generate:start] deck all-page edit result validation retry scheduled', {
      sessionId: context.sessionId,
      runId: context.runId,
      details
    })
    editSummaryFromEngine = await runEditAttempt(
      buildEditValidationRetryMessage(context.userMessage, `页面编辑结果验证失败：${details}`),
      uiText(
        context.appLocale,
        `页面校验失败，正在自动重试一次：${details}`,
        `Page validation failed; retrying once: ${details}`
      )
    )
    ;({ pageDescriptors, changedPageDescriptors } = await readEditedPages())
    const retryInvalidChangedPages = validateChangedPages(changedPageDescriptors)
    if (retryInvalidChangedPages.length > 0) {
      const retryDetails = retryInvalidChangedPages
        .map((item) => `${item.page.pageId}（${item.page.title}）：${item.reason}`)
        .join('；')
      await db.updateGenerationRunStatus(context.runId, 'failed', retryDetails)
      throw new Error(`页面编辑结果验证失败：${retryDetails}`)
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
      ? uiText(context.appLocale, `修改完成：${changedPages}。`, `Edit completed: ${changedPages}.`)
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
      legacyPageId:
        existing?.legacy_page_id || (page.pageId.match(/^page-\d+$/) ? page.pageId : null),
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
    await recordHistoryOperationSafe(db, {
      sessionId: context.sessionId,
      projectDir,
      type: 'edit',
      scope: 'deck',
      prompt: context.userMessage,
      metadata: {
        runId: context.runId,
        changedPageIds: Array.from(changedPageIdSet),
        allowedPageIds
      }
    })
  }
  log.info('[generate:start] deck all-page edit completed', {
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
