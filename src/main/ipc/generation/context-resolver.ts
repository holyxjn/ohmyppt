import log from 'electron-log/main.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { GenerateStartPayload } from '@shared/generation'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import {
  loadStyleSkill,
  listStyleCatalog,
  getStyleDetail,
  hasStyleSkill
} from '../../utils/style-skills'
import { extractOutlineTitles } from '../utils'
import type { IpcContext } from '../context'
import { resolveActiveModelConfig, resolveGlobalModelTimeouts } from '../model-config-utils'
import type { GenerateMode, GenerateChatType, GenerationContext } from './types'

export async function resolveGenerationContext(
  ctx: IpcContext,
  _event: Electron.IpcMainInvokeEvent,
  payload: unknown,
  options?: { persistUserMessage?: boolean; mode?: GenerateMode }
): Promise<GenerationContext> {
  const {
    db,
    agentManager,
    resolveStoragePath,
    formatImagePathsForPrompt,
    assertPathInAllowedRoots,
    ensureSessionAssets
  } = ctx

  const input = payload as GenerateStartPayload
  const sessionId = String(input?.sessionId || '').trim()
  const rawUserMessage = typeof input?.userMessage === 'string' ? input.userMessage : ''
  const rawImagePaths = Array.isArray(input?.imagePaths)
    ? input.imagePaths
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith('./images/'))
        .slice(0, 10)
    : []
  const rawDocPaths = Array.isArray(input?.docPaths)
    ? input.docPaths
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 1)
    : []
  const requestedType =
    input?.type === 'page' ? 'page' : input?.type === 'deck' ? 'deck' : undefined
  const effectiveMode: GenerateMode =
    options?.mode ?? (requestedType === 'page' ? 'edit' : 'generate')
  const imagePaths = effectiveMode === 'edit' ? rawImagePaths : []
  const userMessage = `${rawUserMessage}${formatImagePathsForPrompt(imagePaths)}`
  const selectedPageId =
    typeof input?.selectedPageId === 'string' && input.selectedPageId.trim().length > 0
      ? input.selectedPageId.trim()
      : undefined
  const htmlPath = typeof input?.htmlPath === 'string' ? input.htmlPath : undefined
  const selector =
    typeof input?.selector === 'string' && input.selector.trim().length > 0
      ? input.selector.trim()
      : undefined
  const elementTag =
    typeof input?.elementTag === 'string' && input.elementTag.trim().length > 0
      ? input.elementTag.trim()
      : undefined
  const elementText =
    typeof input?.elementText === 'string' && input.elementText.trim().length > 0
      ? input.elementText.trim()
      : undefined

  if (!sessionId) {
    throw new Error('sessionId 不能为空')
  }

  log.info('[generate:start] received', {
    sessionId,
    type: requestedType || 'legacy',
    mode: effectiveMode,
    chatType: input?.chatType === 'page' ? 'page' : 'main',
    chatPageId: input?.chatPageId || null,
    hasUserMessage: rawUserMessage.trim().length > 0,
    imagePaths,
    selectedPageId: selectedPageId || null,
    selector: selector || null,
    elementTag: elementTag || null,
    elementText: elementText || null
  })

  const session = await db.getSession(sessionId)
  if (!session) throw new Error('Session not found')
  const sessionRecord = session as unknown as Record<string, unknown>
  const previousSessionStatus = String(sessionRecord.status || 'active')
  const styleCatalog = listStyleCatalog()
  const defaultStyleId =
    styleCatalog.find((item) => item.styleKey === 'minimal-white')?.id ??
    styleCatalog[0]?.id ??
    ''
  const styleIdRaw =
    typeof sessionRecord.styleId === 'string' ? String(sessionRecord.styleId).trim() : ''
  const styleId = styleIdRaw || defaultStyleId
  if (!styleId) {
    throw new Error('未找到可用风格，请先在风格管理中创建或导入风格。')
  }
  if (!hasStyleSkill(styleId)) {
    throw new Error(`styleId 不存在或不可用：${styleId}`)
  }
  const styleDetail = getStyleDetail(styleId)

  const existingProject = await db.getProject(sessionId)
  const storagePath = await resolveStoragePath()
  const projectDir = existingProject?.output_path || path.join(storagePath, sessionId)
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
  }
  await ensureSessionAssets(projectDir)
  const latestGenerationRun = await db.getLatestGenerationRun(sessionId)
  const isFirstDeckGeneration = effectiveMode === 'generate' && !latestGenerationRun
  const rawReferenceDocumentPath =
    sessionRecord.referenceDocumentPath ?? sessionRecord.reference_document_path
  const referenceDocumentPath =
    typeof rawReferenceDocumentPath === 'string' ? rawReferenceDocumentPath.trim() : ''
  const sourceDocumentPaths = await (async (): Promise<string[]> => {
    const sessionDocsDir = path.join(projectDir, 'docs')
    if (rawDocPaths.length > 0) {
      await fs.promises.mkdir(sessionDocsDir, { recursive: true })
      const copiedPaths: string[] = []
      for (const candidate of rawDocPaths) {
        const sourcePath = await assertPathInAllowedRoots({
          filePath: candidate,
          mode: 'read',
          sessionId
        })
        const safeName = path.basename(sourcePath).replace(/[\\/:"*?<>|]+/g, '-')
        const targetPath = path.join(sessionDocsDir, safeName)
        if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
          await fs.promises.copyFile(sourcePath, targetPath)
        }
        copiedPaths.push(`/docs/${safeName}`)
      }
      return copiedPaths
    }

    if (effectiveMode === 'edit') return []
    const shouldUseReferenceDocument =
      (effectiveMode === 'generate' && isFirstDeckGeneration) || effectiveMode === 'retry'
    if (!shouldUseReferenceDocument || !referenceDocumentPath) {
      return []
    }

    await fs.promises.mkdir(sessionDocsDir, { recursive: true })
    if (referenceDocumentPath) {
      const normalizedReferenceDocumentPath = referenceDocumentPath.startsWith('/')
        ? referenceDocumentPath
        : `/docs/${referenceDocumentPath}`
      if (!normalizedReferenceDocumentPath.startsWith('/docs/')) return []
      const filePath = path.resolve(
        projectDir,
        normalizedReferenceDocumentPath.replace(/^\/+/, '')
      )
      const relativeToProject = path.relative(projectDir, filePath)
      if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) return []
      if (fs.existsSync(filePath)) {
        return [normalizedReferenceDocumentPath]
      }
      return []
    }
    return []
  })()

  const settings = await db.getAllSettings()
  const appLocale = settings.locale === 'en' ? 'en' : 'zh'
  const activeModel = await resolveActiveModelConfig(ctx)
  const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
  const { provider, model, apiKey } = activeModel
  const providerBaseUrl = activeModel.baseUrl

  agentManager.ensureSession({
    sessionId,
    provider,
    model,
    baseUrl: providerBaseUrl,
    projectDir
  })

  const entry = agentManager.beginRun(sessionId)
  if (!entry) throw new Error('Session not found')

  const runId = crypto.randomUUID()
  const styleSkill = loadStyleSkill(styleId)
  const userProvidedOutlineTitles = extractOutlineTitles(rawUserMessage)
  const totalPages = Number(sessionRecord.page_count ?? sessionRecord.pageCount)

  const projectId =
    existingProject?.id ??
    (await db.createProject({
      session_id: sessionId,
      title: String(sessionRecord.title || 'Untitled'),
      output_path: entry.projectDir
    }))

  const normalizedChatType: GenerateChatType = input?.chatType === 'page' ? 'page' : 'main'
  const normalizedChatPageId =
    normalizedChatType === 'page'
      ? typeof input?.chatPageId === 'string' && input.chatPageId.trim().length > 0
        ? input.chatPageId.trim()
        : selectedPageId
      : undefined
  if (normalizedChatType === 'page' && !normalizedChatPageId) {
    throw new Error('chatType=page requires chatPageId or selectedPageId')
  }

  if (options?.persistUserMessage !== false) {
    await db.addMessage(sessionId, {
      role: 'user',
      content: rawUserMessage,
      type: 'text',
      chat_scope: normalizedChatType,
      page_id: normalizedChatType === 'page' ? normalizedChatPageId : undefined,
      selector: normalizedChatType === 'page' ? selector : undefined,
      image_paths: imagePaths
    })
  }
  await db.updateSessionStatus(sessionId, 'active')

  const topic = String(sessionRecord.topic || '当前主题')
  const deckTitle = String(sessionRecord.title || 'OpenPPT Preview')

  log.info('[generate:start] run initialized', {
    sessionId,
    projectDir: entry.projectDir,
    mode: effectiveMode,
    styleId,
    styleKey: styleDetail.styleKey,
    styleLabel: styleDetail.label,
    provider,
    model
  })

  return {
    sessionId,
    userMessage,
    requestedType,
    effectiveMode,
    selectedPageId,
    htmlPath,
    selector,
    elementTag,
    elementText,
    session,
    sessionRecord,
    previousSessionStatus,
    entry,
    runId,
    styleId,
    styleSkill,
    userProvidedOutlineTitles,
    totalPages,
    provider,
    apiKey,
    model,
    modelTimeouts,
    providerBaseUrl,
    projectId,
    messageScope: normalizedChatType,
    messagePageId: normalizedChatType === 'page' ? normalizedChatPageId : undefined,
    imagePaths,
    sourceDocumentPaths,
    topic,
    deckTitle,
    appLocale
  }
}
