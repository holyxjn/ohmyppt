import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import type { IpcContext } from '../context'
import { resolveActiveModelConfig, resolveGlobalModelTimeouts } from '../config/model-config-utils'
import { hasStyleSkill, listStyleCatalog, loadStyleSkill } from '../../utils/style-skills'

export type CommonGenerationContext = {
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
  styleSkillPrompt: string
  topic: string
  deckTitle: string
  appLocale: 'zh' | 'en'
  projectId: string
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
    styleId,
    styleSkillPrompt: styleSkill.prompt,
    topic: String(sessionRecord.topic || '当前主题'),
    deckTitle: String(sessionRecord.title || 'OpenPPT Preview'),
    appLocale,
    projectId
  }
}
