import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { GenerateStartPayload } from '@shared/generation'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import type { IpcContext } from '../context'
import type { GenerateChatType, GenerateMode } from './types'
import { resolveActiveModelConfig, resolveGlobalModelTimeouts } from '../config/model-config-utils'
import { hasStyleSkill, listStyleCatalog, loadStyleSkill } from '../../utils/style-skills'
import { extractOutlineTitles } from '../utils'

export type CommonGenerationContext = {
  session: Awaited<ReturnType<IpcContext['db']['getSession']>>
  sessionRecord: Record<string, unknown>
  previousSessionStatus: string
  runId: string
  provider: string
  apiKey: string
  model: string
  providerBaseUrl: string
  modelTimeouts: Record<ModelTimeoutProfile, number>
  projectDir: string
  abortSignal: AbortSignal
  styleId: string
  styleSkill: ReturnType<typeof loadStyleSkill>
  styleSkillPrompt: string
  topic: string
  deckTitle: string
  appLocale: 'zh' | 'en'
  projectId: string
  entry: NonNullable<ReturnType<IpcContext['agentManager']['beginRun']>>
}

export type NormalizedGenerateInput = {
  sessionId: string
  rawUserMessage: string
  rawImagePaths: string[]
  rawVideoPaths: string[]
  rawDocPaths: string[]
  requestedType?: 'deck' | 'page'
  selectedPageId?: string
  htmlPath?: string
  selector?: string
  elementTag?: string
  elementText?: string
  chatType: GenerateChatType
  chatPageId?: string
}

export function normalizeGeneratePayload(payload: unknown): NormalizedGenerateInput {
  const input = payload as GenerateStartPayload
  const sessionId = String(input?.sessionId || '').trim()
  const rawUserMessage = typeof input?.userMessage === 'string' ? input.userMessage : ''
  const rawImagePaths = Array.isArray(input?.imagePaths)
    ? input.imagePaths
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith('./images/'))
        .slice(0, 10)
    : []
  const rawVideoPaths = Array.isArray(input?.videoPaths)
    ? input.videoPaths
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith('./videos/'))
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
  const chatType: GenerateChatType = input?.chatType === 'page' ? 'page' : 'main'
  const chatPageId =
    chatType === 'page' && typeof input?.chatPageId === 'string' && input.chatPageId.trim().length > 0
      ? input.chatPageId.trim()
      : undefined

  return {
    sessionId,
    rawUserMessage,
    rawImagePaths,
    rawVideoPaths,
    rawDocPaths,
    requestedType,
    selectedPageId,
    htmlPath,
    selector,
    elementTag,
    elementText,
    chatType,
    chatPageId
  }
}

export async function resolveSourceDocuments(
  ctx: IpcContext,
  args: {
    sessionId: string
    projectDir: string
    rawDocPaths: string[]
    mode: GenerateMode
    sessionRecord: Record<string, unknown>
  }
): Promise<string[]> {
  const { sessionId, projectDir, rawDocPaths, mode, sessionRecord } = args
  const { db, assertPathInAllowedRoots } = ctx
  const latestGenerationRun = await db.getLatestGenerationRun(sessionId)
  const isFirstDeckGeneration = mode === 'generate' && !latestGenerationRun
  const rawReferenceDocumentPath =
    sessionRecord.referenceDocumentPath ?? sessionRecord.reference_document_path
  const referenceDocumentPath =
    typeof rawReferenceDocumentPath === 'string' ? rawReferenceDocumentPath.trim() : ''

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

  if (mode === 'edit') return []
  const shouldUseReferenceDocument =
    (mode === 'generate' && isFirstDeckGeneration) || mode === 'retry'
  if (!shouldUseReferenceDocument || !referenceDocumentPath) return []

  await fs.promises.mkdir(sessionDocsDir, { recursive: true })
  const normalizedReferenceDocumentPath = referenceDocumentPath.startsWith('/')
    ? referenceDocumentPath
    : `/docs/${referenceDocumentPath}`
  if (!normalizedReferenceDocumentPath.startsWith('/docs/')) return []
  const filePath = path.resolve(projectDir, normalizedReferenceDocumentPath.replace(/^\/+/, ''))
  const relativeToProject = path.relative(projectDir, filePath)
  if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) return []
  if (fs.existsSync(filePath)) {
    return [normalizedReferenceDocumentPath]
  }
  return []
}

export function buildRetryUserMessage(retrySupplementRaw: string): string {
  const retrySupplement = retrySupplementRaw.trim()
  return retrySupplement
    ? [
        '继续生成本会话中未完成的页面。页面正文、标题、图表标签必须保持与现有页面相同语言。',
        'Continue generating the unfinished slides in this session. Keep slide text, titles, and chart labels in the same language as existing slides.',
        'Determine the content language from the existing topic, outline, source materials, existing slides, and the user supplement; do not infer it from this instruction language.',
        `User supplement:\n${retrySupplement}`
      ].join('\n')
    : [
        '继续生成本会话中未完成的页面。页面正文、标题、图表标签必须保持与现有页面相同语言。',
        'Continue generating the unfinished slides in this session. Keep slide text, titles, and chart labels in the same language as existing slides.',
        'Determine the content language from the existing topic, outline, source materials, and existing slides; do not infer it from this instruction language.'
      ].join('\n')
}

export function buildTotalPages(sessionRecord: Record<string, unknown>): number {
  const total = Number(sessionRecord.page_count ?? sessionRecord.pageCount)
  return Math.max(1, Number.isFinite(total) ? Math.floor(total) : 1)
}

export function buildOutlineTitles(rawUserMessage: string): string[] {
  return extractOutlineTitles(rawUserMessage)
}

export async function resolveCommonContext(
  ctx: IpcContext,
  sessionId: string
): Promise<CommonGenerationContext> {
  const { db, agentManager, resolveStoragePath, ensureSessionAssets } = ctx

  const session = await db.getSession(sessionId)
  if (!session) throw new Error('Session not found')
  const sessionRecord = session as unknown as Record<string, unknown>
  const previousSessionStatus = String(sessionRecord.status || 'active')

  const activeModel = await resolveActiveModelConfig(ctx)
  const modelTimeouts = await resolveGlobalModelTimeouts(ctx)

  const styleCatalog = listStyleCatalog()
  const defaultStyleId =
    styleCatalog.find((item) => item.styleKey === 'minimal-white')?.id ?? styleCatalog[0]?.id ?? ''
  const styleIdRaw =
    typeof sessionRecord.styleId === 'string' ? String(sessionRecord.styleId).trim() : ''
  const styleId = styleIdRaw || defaultStyleId
  if (!styleId || !hasStyleSkill(styleId)) {
    throw new Error(`styleId 不存在或不可用：${styleId}`)
  }
  const styleSkill = loadStyleSkill(styleId)

  const existingProject = await db.getProject(sessionId)
  const storagePath = await resolveStoragePath()
  const projectDir = existingProject?.output_path || path.join(storagePath, sessionId)
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
  }
  await ensureSessionAssets(projectDir)

  agentManager.ensureSession({
    sessionId,
    provider: activeModel.provider,
    model: activeModel.model,
    baseUrl: activeModel.baseUrl,
    projectDir
  })
  // Intentional side effect: current consumers always proceed to generation and need abort/run state.
  const entry = agentManager.beginRun(sessionId)
  if (!entry) throw new Error('Session not found')

  const settings = await db.getAllSettings()
  const appLocale: 'zh' | 'en' = settings.locale === 'en' ? 'en' : 'zh'

  const projectId =
    existingProject?.id ??
    await db.createProject({
      session_id: sessionId,
      title: String(sessionRecord.title || 'Untitled'),
      output_path: entry.projectDir
    })

  return {
    session,
    sessionRecord,
    previousSessionStatus,
    runId: crypto.randomUUID(),
    provider: activeModel.provider,
    apiKey: activeModel.apiKey,
    model: activeModel.model,
    providerBaseUrl: activeModel.baseUrl,
    modelTimeouts,
    projectDir: entry.projectDir,
    abortSignal: entry.abortController.signal,
    entry,
    styleId,
    styleSkill,
    styleSkillPrompt: styleSkill.prompt,
    topic: String(sessionRecord.topic || '当前主题'),
    deckTitle: String(sessionRecord.title || 'OpenPPT Preview'),
    appLocale,
    projectId
  }
}
