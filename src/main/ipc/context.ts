import { BrowserWindow, safeStorage } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main.js'
import type { PPTDatabase } from '../db/database'
import type { AgentManager } from '../agent'
import type { GenerateChunkEvent, UploadedAsset } from '@shared/generation'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { pathToFileURL } from 'url'
import { sleep } from './utils'
import {
  buildPageScaffoldHtml,
  buildProjectIndexHtml,
  SESSION_ASSET_FILE_NAMES,
  type DeckPageFile
} from './template'

export type SessionRunState = {
  sessionId: string
  runId: string
  mode: 'generate' | 'edit' | 'retry'
  status: 'running' | 'completed' | 'failed'
  progress: number
  totalPages: number
  events: GenerateChunkEvent[]
  error: string | null
  startedAt: number
  updatedAt: number
}

export type SessionPageFile = {
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
}

export type SessionGenerationSnapshot = {
  session: Record<string, unknown> | null | undefined
  pages: Array<{
    pageNumber: number
    title: string
    html: string
    htmlPath?: string
    pageId?: string
    sourceUrl?: string
    status?: string
    error?: string | null
  }>
}

export interface IpcContext {
  mainWindow: BrowserWindow
  db: PPTDatabase
  agentManager: AgentManager
  getPageSourceUrl: (htmlPath?: string) => string | undefined
  validateProjectIndexHtml: (html: string) => string[]
  parseSessionMetadataObject: (value: unknown) => Record<string, unknown>
  buildSessionGenerationSnapshot: (
    session: Record<string, unknown> | null | undefined,
    options?: { includeHtml?: boolean }
  ) => Promise<SessionGenerationSnapshot>
  sessionRunStates: Map<string, SessionRunState>
  pruneFinishedSessionRunStates: (now?: number) => void
  beginSessionRunState: (args: {
    sessionId: string
    runId: string
    mode: 'generate' | 'edit' | 'retry'
    totalPages: number
  }) => void
  trackSessionRunChunk: (sessionId: string, chunk: GenerateChunkEvent) => void
  emitGenerateChunk: (sessionId: string, chunk: GenerateChunkEvent) => void
  createDeckProgressEmitter: (sessionId: string) => (chunk: GenerateChunkEvent) => void
  resolveStoragePath: () => Promise<string>
  normalizeSessionId: (value: unknown) => string | undefined
  parsePathPayload: (
    payload: unknown,
    preferredKey?: 'path' | 'htmlPath'
  ) => { filePath: string; sessionId?: string; hash?: string }
  isPathInside: (targetPath: string, rootPath: string) => boolean
  toSafeAssetBaseName: (value: string) => string
  resolveSessionProjectDir: (sessionId: string) => Promise<string>
  formatImagePathsForPrompt: (imagePaths?: string[]) => string
  buildAssetTimestamp: () => string
  uploadSessionFiles: (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>,
    target: 'images' | 'docs'
  ) => Promise<UploadedAsset[]>
  uploadImageAssets: (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>
  ) => Promise<UploadedAsset[]>
  resolveExistingFileRealPath: (filePath: string) => Promise<string>
  resolveWritableFileRealPath: (filePath: string) => Promise<string>
  resolveAllowedRoots: (sessionId?: string) => Promise<string[]>
  assertPathInAllowedRoots: (args: {
    filePath: string
    mode: 'read' | 'write'
    sessionId?: string
    htmlOnly?: boolean
  }) => Promise<string>
  encryptApiKey: (apiKey: string) => string
  decryptApiKey: (rawValue: unknown) => string
  PLANNER_TEMPERATURE: number
  DESIGN_CONTRACT_TEMPERATURE: number
  PAGE_GENERATION_TEMPERATURE: number
  PAGE_EDIT_WITH_SELECTOR_TEMPERATURE: number
  PAGE_EDIT_DEFAULT_TEMPERATURE: number
  resolveSessionAssetSourcePath: (fileName: string) => string
  ensureSessionAssets: (projectDir: string) => Promise<void>
  scaffoldProjectFiles: (args: {
    deckTitle: string
    indexPath: string
    pages: Array<{ pageNumber: number; pageId: string; title: string; htmlPath: string }>
  }) => Promise<void>
  PRINT_READY_PREFIX: string
  EXPORT_PAGE_READY_TIMEOUT_MS: number
  EXPORT_CAPTURE_SETTLE_MS: number
  resolveSessionPageFiles: (sessionId: string) => Promise<{
    session: Record<string, unknown>
    pages: SessionPageFile[]
    projectDir: string
  }>
  waitForPrintReadySignal: (args: {
    win: BrowserWindow
    pageId: string
    timeoutMs: number
  }) => Promise<{ timedOut: boolean; reportedPageId?: string }>
  renderPageToPdfBuffer: (args: {
    page: SessionPageFile
    timeoutMs: number
  }) => Promise<{ pngBuffer: Buffer; warning?: string }>
}

export function createIpcContext(
  mainWindow: BrowserWindow,
  db: PPTDatabase,
  agentManager: AgentManager
): IpcContext {
  const ENCRYPTED_API_KEY_PREFIX = 'enc:v1:'
  const MAX_SESSION_RUN_EVENTS = 500
  const FINISHED_SESSION_RUN_STATE_TTL_MS = 30 * 60 * 1000
  const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
  const ALLOWED_DOC_EXTENSIONS = new Set(['.md', '.txt', '.text'])
  const IMAGE_MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  }
  const DOC_MIME_BY_EXT: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.text': 'text/plain'
  }
  const getPageSourceUrl = (htmlPath?: string): string | undefined => {
    if (!htmlPath || !fs.existsSync(htmlPath)) return undefined
    return pathToFileURL(htmlPath).toString()
  }
  const validateProjectIndexHtml = (html: string): string[] => {
    const errors: string[] = []
    if (!/<html[\s>]/i.test(html)) errors.push('index.html 缺少 <html> 标签')
    if (!/<body[\s>]/i.test(html)) errors.push('index.html 缺少 <body> 标签')
    if (!/<iframe\b[^>]*class=["'][^"']*\bppt-preview-frame\b/i.test(html)) {
      errors.push('index.html 缺少页面预览 iframe')
    }
    if (!/id=["']pages-data["']/i.test(html)) {
      errors.push('index.html 缺少 pages-data 页面数据')
    }
    if (!/const\s+pages\s*=\s*JSON\.parse/i.test(html)) {
      errors.push('index.html 缺少页面数据解析逻辑')
    }
    if (!/function\s+applyPage\s*\(/i.test(html)) {
      errors.push('index.html 缺少页面切换逻辑')
    }
    return errors
  }
  const parseSessionMetadataObject = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'string' || value.trim().length === 0) return {}
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }

  const buildSessionGenerationSnapshot = async (
    session: Record<string, unknown> | null | undefined,
    options?: { includeHtml?: boolean }
  ): Promise<{
    session: Record<string, unknown> | null | undefined
    pages: Array<{
      pageNumber: number
      title: string
      html: string
      htmlPath?: string
      pageId?: string
      sourceUrl?: string
      status?: string
      error?: string | null
    }>
  }> => {
    if (!session) return { session, pages: [] }
    const sessionId = String(session.id || '').trim()
    if (!sessionId) return { session, pages: [] }

    const metadata = parseSessionMetadataObject(session.metadata)
    const generationSnapshot = await db.listLatestGenerationPageSnapshot(sessionId)
    if (generationSnapshot.length === 0) {
      return { session, pages: [] }
    }

    const project = await db.getProject(sessionId)
    const metadataIndexPath =
      typeof metadata.indexPath === 'string' && metadata.indexPath.trim().length > 0
        ? metadata.indexPath.trim()
        : ''
    const projectDir =
      typeof project?.output_path === 'string' && project.output_path.trim().length > 0
        ? project.output_path.trim()
        : metadataIndexPath
          ? path.dirname(metadataIndexPath)
          : path.join(await resolveStoragePath(), sessionId)
    const indexPath = metadataIndexPath || path.join(projectDir, 'index.html')
    const completedPagesForMetadata: Array<{
      pageNumber: number
      title: string
      pageId: string
      htmlPath: string
    }> = []
    const failedPagesForMetadata: Array<{
      pageId: string
      title: string
      reason: string
    }> = []
    const pages: Array<{
      pageNumber: number
      title: string
      html: string
      htmlPath?: string
      pageId?: string
      sourceUrl?: string
      status?: string
      error?: string | null
    }> = []

    for (const page of generationSnapshot) {
      const pageId = page.page_id || `page-${page.page_number}`
      const title = page.title || `第 ${page.page_number} 页`
      const htmlPath = page.html_path || path.join(projectDir, `${pageId}.html`)
      const html =
        options?.includeHtml && fs.existsSync(htmlPath)
          ? await fs.promises.readFile(htmlPath, 'utf-8')
          : ''
      if (page.status === 'completed') {
        completedPagesForMetadata.push({
          pageNumber: page.page_number,
          title,
          pageId,
          htmlPath
        })
      } else if (page.status === 'failed') {
        failedPagesForMetadata.push({
          pageId,
          title,
          reason: page.error || '页面仍需修复'
        })
      }

      pages.push({
        pageNumber: page.page_number,
        title,
        html: options?.includeHtml ? html : '',
        htmlPath,
        pageId,
        sourceUrl: getPageSourceUrl(htmlPath),
        status: page.status,
        error: page.error
      })
    }

    const synthesizedMetadata = {
      ...metadata,
      lastRunId: generationSnapshot[0]?.run_id || metadata.lastRunId,
      entryMode: 'multi_page',
      generatedPages: completedPagesForMetadata.sort((a, b) => a.pageNumber - b.pageNumber),
      failedPages: failedPagesForMetadata.sort((a, b) => {
        const aNumber = Number(a.pageId.match(/^page-(\d+)$/i)?.[1] || 0)
        const bNumber = Number(b.pageId.match(/^page-(\d+)$/i)?.[1] || 0)
        return aNumber - bNumber
      }),
      indexPath,
      projectId: project?.id || metadata.projectId
    }

    return {
      session: {
        ...session,
        metadata: JSON.stringify(synthesizedMetadata)
      },
      pages: pages.sort((a, b) => a.pageNumber - b.pageNumber)
    }
  }

  const sessionRunStates = new Map<string, SessionRunState>()

  const pruneFinishedSessionRunStates = (now = Date.now()): void => {
    for (const [sessionId, state] of sessionRunStates) {
      if (state.status === 'running') continue
      if (now - state.updatedAt > FINISHED_SESSION_RUN_STATE_TTL_MS) {
        sessionRunStates.delete(sessionId)
      }
    }
  }

  const summarizeGenerateChunk = (chunk: GenerateChunkEvent): Record<string, unknown> => {
    switch (chunk.type) {
      case 'stage_started':
      case 'stage_progress':
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          label: chunk.payload.label,
          progress: chunk.payload.progress ?? null,
          totalPages: chunk.payload.totalPages ?? null
        }
      case 'llm_status':
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          label: chunk.payload.label,
          detail: chunk.payload.detail ?? null,
          progress: chunk.payload.progress ?? null,
          totalPages: chunk.payload.totalPages ?? null,
          provider: chunk.payload.provider ?? null,
          model: chunk.payload.model ?? null
        }
      case 'page_generated':
      case 'page_updated':
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          pageNumber: chunk.payload.pageNumber,
          pageId: chunk.payload.pageId,
          title: chunk.payload.title,
          progress: chunk.payload.progress ?? null,
          htmlPath: chunk.payload.htmlPath ?? null
        }
      case 'run_completed':
        return {
          type: chunk.type,
          totalPages: chunk.payload.totalPages
        }
      case 'run_error':
        return {
          type: chunk.type,
          message: chunk.payload.message
        }
      default:
        return { type: chunk.type }
    }
  }

  const beginSessionRunState = (args: {
    sessionId: string
    runId: string
    mode: 'generate' | 'edit' | 'retry'
    totalPages: number
  }): void => {
    const now = Date.now()
    pruneFinishedSessionRunStates(now)
    sessionRunStates.set(args.sessionId, {
      sessionId: args.sessionId,
      runId: args.runId,
      mode: args.mode,
      status: 'running',
      progress: 0,
      totalPages: Math.max(1, Math.floor(args.totalPages || 1)),
      events: [],
      error: null,
      startedAt: now,
      updatedAt: now
    })
  }

  const trackSessionRunChunk = (sessionId: string, chunk: GenerateChunkEvent): void => {
    const state = sessionRunStates.get(sessionId)
    if (!state) return
    if (state.runId !== chunk.payload.runId) return

    const compactChunk =
      chunk.type === 'page_generated' || chunk.type === 'page_updated'
        ? ({
            ...chunk,
            payload: {
              ...chunk.payload,
              html: ''
            }
          } as GenerateChunkEvent)
        : chunk

    state.updatedAt = Date.now()
    state.events.push(compactChunk)
    if (state.events.length > MAX_SESSION_RUN_EVENTS) {
      state.events.splice(0, state.events.length - MAX_SESSION_RUN_EVENTS)
    }

    if (chunk.type === 'run_completed') {
      state.status = 'completed'
      state.progress = 100
      state.totalPages = Math.max(
        state.totalPages,
        Math.floor(chunk.payload.totalPages || state.totalPages)
      )
      state.error = null
      return
    }

    if (chunk.type === 'run_error') {
      state.status = 'failed'
      state.error = chunk.payload.message || 'Generation failed'
      return
    }

    if (
      'totalPages' in chunk.payload &&
      typeof chunk.payload.totalPages === 'number' &&
      Number.isFinite(chunk.payload.totalPages)
    ) {
      state.totalPages = Math.max(1, Math.floor(chunk.payload.totalPages))
    }
    if (
      'progress' in chunk.payload &&
      typeof chunk.payload.progress === 'number' &&
      Number.isFinite(chunk.payload.progress)
    ) {
      const boundedProgress = Math.max(0, Math.min(100, Math.round(chunk.payload.progress)))
      state.progress = Math.max(state.progress, boundedProgress)
    }
  }

  const emitGenerateChunk = (sessionId: string, chunk: GenerateChunkEvent): void => {
    const enrichedChunk = {
      ...chunk,
      payload: {
        ...chunk.payload,
        sessionId,
        timestamp: new Date().toISOString()
      }
    } as GenerateChunkEvent

    if (
      enrichedChunk.type === 'stage_started' ||
      enrichedChunk.type === 'stage_progress' ||
      enrichedChunk.type === 'llm_status' ||
      enrichedChunk.type === 'page_generated' ||
      enrichedChunk.type === 'page_updated' ||
      enrichedChunk.type === 'run_completed' ||
      enrichedChunk.type === 'run_error'
    ) {
      log.info('[generate:chunk] emit', summarizeGenerateChunk(enrichedChunk))
    }
    trackSessionRunChunk(sessionId, enrichedChunk)

    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      try {
        win.webContents.send('generate:chunk', enrichedChunk)
      } catch (sendError) {
        log.warn('[generate:chunk] send failed', {
          sessionId,
          windowId: win.id,
          message: sendError instanceof Error ? sendError.message : String(sendError)
        })
      }
    }
  }

  const createDeckProgressEmitter = (sessionId: string): ((chunk: GenerateChunkEvent) => void) => {
    let normalizedProgress = 0

    const clamp = (value: number, min: number, max: number): number =>
      Math.max(min, Math.min(max, Math.round(value)))

    const getStageBounds = (stage: string): { min: number; max: number } => {
      if (stage === 'preflight' || stage === 'planning') {
        return { min: 0, max: 10 }
      }
      if (stage === 'rendering') {
        return { min: 10, max: 90 }
      }
      return { min: 0, max: 90 }
    }

    return (chunk: GenerateChunkEvent) => {
      if (chunk.type === 'run_completed') {
        normalizedProgress = 100
        emitGenerateChunk(sessionId, chunk)
        return
      }

      if (
        chunk.type !== 'stage_started' &&
        chunk.type !== 'stage_progress' &&
        chunk.type !== 'llm_status' &&
        chunk.type !== 'page_generated' &&
        chunk.type !== 'page_updated'
      ) {
        emitGenerateChunk(sessionId, chunk)
        return
      }

      const { min, max } = getStageBounds(chunk.payload.stage)
      const rawProgress =
        typeof chunk.payload.progress === 'number' && Number.isFinite(chunk.payload.progress)
          ? chunk.payload.progress
          : normalizedProgress
      const bounded = clamp(rawProgress, min, max)
      normalizedProgress = Math.max(normalizedProgress, bounded)

      emitGenerateChunk(sessionId, {
        ...chunk,
        payload: {
          ...chunk.payload,
          progress: normalizedProgress
        }
      } as GenerateChunkEvent)
    }
  }

  const resolveStoragePath = async (): Promise<string> => {
    const saved = await db.getSetting<string>('storage_path')
    if (typeof saved === 'string' && saved.trim().length > 0) {
      const normalized = saved.trim()
      await db.setStoragePath(normalized)
      return normalized
    }
    throw new Error('请先前往系统设置选择存储目录。')
  }

  const normalizeSessionId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const parsePathPayload = (
    payload: unknown,
    preferredKey: 'path' | 'htmlPath' = 'path'
  ): { filePath: string; sessionId?: string; hash?: string } => {
    if (typeof payload === 'string') {
      return { filePath: payload.trim() }
    }
    if (!payload || typeof payload !== 'object') {
      return { filePath: '' }
    }
    const record = payload as Record<string, unknown>
    const candidate =
      typeof record[preferredKey] === 'string'
        ? String(record[preferredKey])
        : typeof record.path === 'string'
          ? String(record.path)
          : typeof record.htmlPath === 'string'
            ? String(record.htmlPath)
            : ''
    return {
      filePath: candidate.trim(),
      sessionId: normalizeSessionId(record.sessionId),
      hash: typeof record.hash === 'string' ? record.hash : undefined
    }
  }

  const isPathInside = (targetPath: string, rootPath: string): boolean => {
    const relative = path.relative(rootPath, targetPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  const toSafeAssetBaseName = (value: string): string => {
    const parsed = path.parse(value)
    const fallback = parsed.name || 'image'
    const safe = fallback
      .normalize('NFKD')
      .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72)
    return safe || 'image'
  }

  const resolveSessionProjectDir = async (sessionId: string): Promise<string> => {
    const session = await db.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const project = await db.getProject(sessionId)
    const outputPath = typeof project?.output_path === 'string' ? project.output_path.trim() : ''
    if (outputPath) return path.resolve(outputPath)
    return path.resolve(await resolveStoragePath(), sessionId)
  }

  const formatImagePathsForPrompt = (imagePaths?: string[]): string => {
    const validPaths = Array.isArray(imagePaths)
      ? imagePaths
          .map((item) => String(item || '').trim())
          .filter((item) => item.startsWith('./images/'))
          .slice(0, 10)
      : []
    if (validPaths.length === 0) return ''
    return [
      '',
      '本次消息可用图片路径：',
      ...validPaths.map((imagePath, index) => `- ${index + 1}. ${imagePath}`),
      '',
      '图片使用规则：',
      '- 如需使用图片，请引用上面的相对路径。',
      '- 禁止使用 file://、绝对路径或 base64。',
      '- 不要重新引入远程图片资源，优先使用这些本地图片。'
    ].join('\n')
  }

  const buildAssetTimestamp = (): string => {
    const now = new Date()
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('')
  }

  const uploadSessionFiles = async (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>,
    target: 'images' | 'docs'
  ): Promise<UploadedAsset[]> => {
    if (!sessionId) throw new Error('sessionId 不能为空')
    if (files.length === 0) return []
    if (files.length > 10) throw new Error('一次最多上传 10 个素材')

    const projectDir = await resolveSessionProjectDir(sessionId)
    const targetDir = path.join(projectDir, target)
    await fs.promises.mkdir(targetDir, { recursive: true })
    const targetRoot = await fs.promises.realpath(targetDir)

    const uploadedAssets: UploadedAsset[] = []
    for (const file of files) {
      const sourcePathRaw = typeof file.path === 'string' ? file.path.trim() : ''
      if (!sourcePathRaw) throw new Error('无法读取拖入文件路径')
      const sourcePath = path.resolve(sourcePathRaw)
      if (!fs.existsSync(sourcePath)) throw new Error(`素材文件不存在: ${sourcePath}`)
      const stat = await fs.promises.stat(sourcePath)
      if (!stat.isFile()) throw new Error(`素材不是文件: ${sourcePath}`)
      if (stat.size > 20 * 1024 * 1024) throw new Error('单个素材不能超过 20MB')

      const ext = path.extname(sourcePath).toLowerCase()
      if (target === 'images' && !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        throw new Error('暂只支持 png、jpg、jpeg、webp、gif、svg 图片素材')
      }
      if (target === 'docs' && !ALLOWED_DOC_EXTENSIONS.has(ext)) {
        throw new Error('暂只支持 md、txt 文档素材')
      }

      const originalName =
        typeof file.name === 'string' && file.name.trim().length > 0
          ? file.name.trim()
          : path.basename(sourcePath)
      const id = crypto.randomUUID()
      const fileName = `${buildAssetTimestamp()}-${id.slice(0, 8)}-${toSafeAssetBaseName(originalName)}${ext}`
      const targetPath = path.join(targetDir, fileName)
      if (!isPathInside(path.resolve(targetPath), targetRoot)) {
        throw new Error('素材目标路径不合法')
      }
      await fs.promises.copyFile(sourcePath, targetPath)

      uploadedAssets.push({
        id,
        fileName,
        originalName,
        relativePath: `./${target}/${fileName}`,
        absolutePath: targetPath,
        mimeType:
          target === 'images'
            ? IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream'
            : DOC_MIME_BY_EXT[ext] || 'text/plain',
        size: stat.size,
        createdAt: Math.floor(Date.now() / 1000)
      })
    }

    log.info('[assets] uploaded', {
      sessionId,
      projectDir,
      target,
      count: uploadedAssets.length,
      files: uploadedAssets.map((asset) => asset.fileName)
    })
    return uploadedAssets
  }

  const uploadImageAssets = async (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>
  ): Promise<UploadedAsset[]> => uploadSessionFiles(sessionId, files, 'images')

  const resolveExistingFileRealPath = async (filePath: string): Promise<string> => {
    const absolutePath = path.resolve(filePath)
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`文件不存在: ${absolutePath}`)
    }
    const stat = await fs.promises.stat(absolutePath)
    if (!stat.isFile()) {
      throw new Error(`目标不是文件: ${absolutePath}`)
    }
    return fs.promises.realpath(absolutePath)
  }

  const resolveWritableFileRealPath = async (filePath: string): Promise<string> => {
    const absolutePath = path.resolve(filePath)
    if (fs.existsSync(absolutePath)) {
      const stat = await fs.promises.stat(absolutePath)
      if (!stat.isFile()) {
        throw new Error(`目标不是文件: ${absolutePath}`)
      }
      return fs.promises.realpath(absolutePath)
    }
    const parentDir = path.dirname(absolutePath)
    if (!fs.existsSync(parentDir)) {
      throw new Error(`目标目录不存在: ${parentDir}`)
    }
    const parentRealPath = await fs.promises.realpath(parentDir)
    return path.join(parentRealPath, path.basename(absolutePath))
  }

  const resolveAllowedRoots = async (sessionId?: string): Promise<string[]> => {
    const roots = new Set<string>()
    const storagePath = await resolveStoragePath()
    const storageRoot = fs.existsSync(storagePath)
      ? await fs.promises.realpath(storagePath)
      : path.resolve(storagePath)
    roots.add(storageRoot)

    if (sessionId) {
      const project = await db.getProject(sessionId)
      const outputPath = typeof project?.output_path === 'string' ? project.output_path : ''
      if (outputPath) {
        const resolvedOutputPath = fs.existsSync(outputPath)
          ? await fs.promises.realpath(outputPath)
          : path.resolve(outputPath)
        roots.add(resolvedOutputPath)
      }
    }
    return [...roots]
  }

  const assertPathInAllowedRoots = async (args: {
    filePath: string
    mode: 'read' | 'write'
    sessionId?: string
    htmlOnly?: boolean
  }): Promise<string> => {
    const { filePath, mode, sessionId, htmlOnly } = args
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new Error('文件路径不能为空')
    }
    const extension = path.extname(filePath).toLowerCase()
    if (htmlOnly && extension !== '.html' && extension !== '.htm') {
      throw new Error(`仅允许访问 HTML 文件，当前扩展名: ${extension || '(none)'}`)
    }
    const targetPath =
      mode === 'read'
        ? await resolveExistingFileRealPath(filePath)
        : await resolveWritableFileRealPath(filePath)
    const allowedRoots = await resolveAllowedRoots(sessionId)
    const allowed = allowedRoots.some((root) => isPathInside(targetPath, root))
    if (!allowed) {
      throw new Error(`文件路径不在允许目录内: ${targetPath}`)
    }
    return targetPath
  }

  const encryptApiKey = (apiKey: string): string => {
    const trimmed = apiKey.trim()
    if (trimmed.length === 0) return ''
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('[settings] safeStorage unavailable, fallback to plaintext api key storage')
      return trimmed
    }
    try {
      const encrypted = safeStorage.encryptString(trimmed).toString('base64')
      return `${ENCRYPTED_API_KEY_PREFIX}${encrypted}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[settings] api key encrypt failed', { message })
      throw new Error('API Key 加密失败，请检查系统钥匙串状态后重试。')
    }
  }

  const decryptApiKey = (rawValue: unknown): string => {
    if (typeof rawValue !== 'string') return ''
    const raw = rawValue.trim()
    if (!raw) return ''
    if (!raw.startsWith(ENCRYPTED_API_KEY_PREFIX)) {
      return raw
    }
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('[settings] safeStorage unavailable, cannot decrypt encrypted api key')
      return ''
    }
    try {
      const encrypted = raw.slice(ENCRYPTED_API_KEY_PREFIX.length)
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[settings] api key decrypt failed', { message })
      return ''
    }
  }

  const PLANNER_TEMPERATURE = 0.1
  const DESIGN_CONTRACT_TEMPERATURE = 0.35
  const PAGE_GENERATION_TEMPERATURE = 0.7
  const PAGE_EDIT_WITH_SELECTOR_TEMPERATURE = 0.3
  const PAGE_EDIT_DEFAULT_TEMPERATURE = 0.55

  const resolveSessionAssetSourcePath = (fileName: string): string => {
    const baseDir = is.dev
      ? path.join(process.cwd(), 'resources')
      : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    const sourcePath = path.join(baseDir, fileName)
    if (fs.existsSync(sourcePath)) return sourcePath
    throw new Error(`缺少资源文件 ${fileName}。期望路径: ${sourcePath}`)
  }

  const ensureSessionAssets = async (projectDir: string): Promise<void> => {
    const assetsDir = path.join(projectDir, 'assets')
    const imagesDir = path.join(projectDir, 'images')
    const docsDir = path.join(projectDir, 'docs')
    await fs.promises.mkdir(assetsDir, { recursive: true })
    await fs.promises.mkdir(imagesDir, { recursive: true })
    await fs.promises.mkdir(docsDir, { recursive: true })
    await Promise.all(
      SESSION_ASSET_FILE_NAMES.map(async (fileName) => {
        const sourcePath = resolveSessionAssetSourcePath(fileName)
        const targetPath = path.join(assetsDir, fileName)
        await fs.promises.copyFile(sourcePath, targetPath)
      })
    )
    log.info('[assets] session assets ready', {
      projectDir,
      assetsDir,
      imagesDir,
      docsDir,
      count: SESSION_ASSET_FILE_NAMES.length,
      env: is.dev ? 'dev' : 'prod'
    })
  }

  const scaffoldProjectFiles = async (args: {
    deckTitle: string
    indexPath: string
    pages: Array<{ pageNumber: number; pageId: string; title: string; htmlPath: string }>
  }): Promise<void> => {
    const { deckTitle, indexPath, pages } = args
    await Promise.all(
      pages.map((page) =>
        fs.promises.writeFile(
          page.htmlPath,
          buildPageScaffoldHtml({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            title: page.title
          }),
          'utf-8'
        )
      )
    )
    await fs.promises.writeFile(
      indexPath,
      buildProjectIndexHtml(
        deckTitle,
        pages.map(
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
  }

  const PRINT_READY_PREFIX = '__PPT_PRINT_READY__'
  const EXPORT_PAGE_READY_TIMEOUT_MS = 4000
  const EXPORT_CAPTURE_SETTLE_MS = 120

  const resolveSessionPageFiles = async (
    sessionId: string
  ): Promise<{
    session: Record<string, unknown>
    pages: SessionPageFile[]
    projectDir: string
  }> => {
    const session = await db.getSession(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }
    const sessionRecord = session as unknown as Record<string, unknown>
    const rawMetadata =
      typeof sessionRecord.metadata === 'string' ? String(sessionRecord.metadata).trim() : ''
    const metadata = (() => {
      if (!rawMetadata) return {} as Record<string, unknown>
      try {
        return JSON.parse(rawMetadata) as Record<string, unknown>
      } catch {
        return {} as Record<string, unknown>
      }
    })()

    const project = await db.getProject(sessionId)
    const projectDirCandidate =
      typeof project?.output_path === 'string' && project.output_path.trim().length > 0
        ? project.output_path.trim()
        : typeof metadata.indexPath === 'string' && metadata.indexPath.trim().length > 0
          ? path.dirname(metadata.indexPath.trim())
          : ''
    const projectDir = projectDirCandidate
      ? path.resolve(projectDirCandidate)
      : path.resolve(await resolveStoragePath(), sessionId)

    const generatedPagesRaw = Array.isArray(metadata.generatedPages)
      ? (metadata.generatedPages as Array<Record<string, unknown>>)
      : []

    const pagesFromMetadata: SessionPageFile[] = []
    for (let index = 0; index < generatedPagesRaw.length; index += 1) {
      const row = generatedPagesRaw[index]
      const pageNumberValue = Number(row.pageNumber)
      const pageIdValue = typeof row.pageId === 'string' ? row.pageId.trim() : ''
      const inferredFromId = Number(pageIdValue.match(/^page-(\d+)$/i)?.[1] || 0)
      const pageNumber =
        Number.isFinite(pageNumberValue) && pageNumberValue > 0
          ? Math.floor(pageNumberValue)
          : inferredFromId > 0
            ? inferredFromId
            : index + 1
      const pageId = pageIdValue || `page-${pageNumber}`
      const titleRaw = typeof row.title === 'string' ? row.title.trim() : ''
      const title = titleRaw || `第 ${pageNumber} 页`
      const htmlPathRaw = typeof row.htmlPath === 'string' ? row.htmlPath.trim() : ''
      const htmlPath = htmlPathRaw
        ? path.isAbsolute(htmlPathRaw)
          ? htmlPathRaw
          : path.resolve(projectDir, htmlPathRaw)
        : path.resolve(projectDir, `${pageId}.html`)
      pagesFromMetadata.push({
        pageNumber,
        pageId,
        title,
        htmlPath
      })
    }

    const fallbackPages: SessionPageFile[] = []
    if (pagesFromMetadata.length === 0 && fs.existsSync(projectDir)) {
      const files = await fs.promises.readdir(projectDir)
      for (const fileName of files) {
        const match = fileName.match(/^(page-(\d+))\.html$/i)
        if (!match) continue
        const pageId = match[1]
        const pageNumber = Number(match[2]) || fallbackPages.length + 1
        fallbackPages.push({
          pageNumber,
          pageId,
          title: `第 ${pageNumber} 页`,
          htmlPath: path.join(projectDir, fileName)
        })
      }
    }

    const dedupedPages = (pagesFromMetadata.length > 0 ? pagesFromMetadata : fallbackPages)
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .filter((page, index, arr) => arr.findIndex((item) => item.pageId === page.pageId) === index)

    if (dedupedPages.length === 0) {
      throw new Error('暂无可导出的页面，请先完成生成。')
    }

    const missingPages: string[] = []
    const safePages: SessionPageFile[] = []
    for (const page of dedupedPages) {
      try {
        const safePath = await assertPathInAllowedRoots({
          filePath: page.htmlPath,
          mode: 'read',
          sessionId,
          htmlOnly: true
        })
        safePages.push({
          ...page,
          htmlPath: safePath
        })
      } catch {
        missingPages.push(page.pageId)
      }
    }
    if (missingPages.length > 0) {
      throw new Error(`页面文件缺失：${missingPages.join(', ')}`)
    }

    return { session: sessionRecord, pages: safePages, projectDir }
  }

  const waitForPrintReadySignal = async (args: {
    win: BrowserWindow
    pageId: string
    timeoutMs: number
  }): Promise<{ timedOut: boolean; reportedPageId?: string }> => {
    const { win, pageId, timeoutMs } = args
    return new Promise((resolve) => {
      let done = false
      let timeoutRef: NodeJS.Timeout | null = null
      let closedListenerBound = false

      const finalize = (timedOut: boolean, reportedPageId?: string): void => {
        if (done) return
        done = true
        if (timeoutRef) clearTimeout(timeoutRef)
        win.webContents.removeListener('console-message', onConsoleMessage)
        if (closedListenerBound) {
          win.removeListener('closed', onClosed)
        }
        resolve({ timedOut, reportedPageId })
      }

      const resolveConsoleMessageText = (...rawArgs: unknown[]): string => {
        if (rawArgs.length >= 3 && typeof rawArgs[2] === 'string') {
          return rawArgs[2]
        }
        const firstArg = rawArgs[0] as
          | { message?: unknown; params?: { message?: unknown } }
          | undefined
        if (firstArg && typeof firstArg === 'object') {
          if (typeof firstArg.message === 'string') return firstArg.message
          if (firstArg.params && typeof firstArg.params.message === 'string') {
            return firstArg.params.message
          }
        }
        return ''
      }

      const extractReportedPageId = (message: string): string | null => {
        if (typeof message !== 'string') return null
        const prefixIndex = message.indexOf(PRINT_READY_PREFIX)
        if (prefixIndex < 0) return null
        const suffix = message.slice(prefixIndex + PRINT_READY_PREFIX.length)
        const colonIndex = suffix.indexOf(':')
        if (colonIndex < 0) return null
        return suffix.slice(colonIndex + 1).trim() || null
      }

      const onConsoleMessage = (...rawArgs: unknown[]): void => {
        const message = resolveConsoleMessageText(...rawArgs)
        const reported = extractReportedPageId(message)
        if (!reported) return
        if (reported === pageId || reported === 'page-unknown') {
          finalize(false, reported)
        }
      }

      const onClosed = (): void => {
        finalize(true)
      }

      timeoutRef = setTimeout(() => finalize(true), Math.max(500, timeoutMs))
      win.webContents.on('console-message', onConsoleMessage as (...args: unknown[]) => void)
      win.on('closed', onClosed)
      closedListenerBound = true
    })
  }

  const renderPageToPdfBuffer = async (args: {
    page: SessionPageFile
    timeoutMs: number
  }): Promise<{ pngBuffer: Buffer; warning?: string }> => {
    const { page, timeoutMs } = args
    const CAPTURE_WIDTH = 1600
    const CAPTURE_HEIGHT = 900
    const win = new BrowserWindow({
      show: false,
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      backgroundColor: '#ffffff',
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: false
      }
    })

    try {
      // Ensure no zoom and exact content size for consistent capture
      win.webContents.setZoomFactor(1)
      win.setContentSize(CAPTURE_WIDTH, CAPTURE_HEIGHT)
      const pageUrl = new URL(pathToFileURL(page.htmlPath).toString())
      pageUrl.searchParams.set('fit', 'off')
      pageUrl.searchParams.set('print', '1')
      pageUrl.searchParams.set('pageId', page.pageId)
      pageUrl.searchParams.set('printTimeoutMs', String(timeoutMs))
      pageUrl.searchParams.set('_ts', String(Date.now()))

      const readyWaitPromise = waitForPrintReadySignal({
        win,
        pageId: page.pageId,
        timeoutMs
      })
      await win.loadURL(pageUrl.toString())
      const readyResult = await readyWaitPromise
      if (readyResult.timedOut) {
        log.warn('[export:pdf] print ready timeout', {
          pageId: page.pageId,
          htmlPath: page.htmlPath,
          timeoutMs
        })
      }
      await sleep(EXPORT_CAPTURE_SETTLE_MS)
      // Capture with explicit rect to ensure exact 1600x900 coverage
      const image = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT
      })
      const pngBuffer = image.toPNG()

      return {
        pngBuffer,
        warning: readyResult.timedOut
          ? `页面 ${page.pageId} 未收到打印就绪信号，已按当前状态导出`
          : undefined
      }
    } finally {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
  }

  return {
    mainWindow,
    db,
    agentManager,
    getPageSourceUrl,
    validateProjectIndexHtml,
    parseSessionMetadataObject,
    buildSessionGenerationSnapshot,
    sessionRunStates,
    pruneFinishedSessionRunStates,
    beginSessionRunState,
    trackSessionRunChunk,
    emitGenerateChunk,
    createDeckProgressEmitter,
    resolveStoragePath,
    normalizeSessionId,
    parsePathPayload,
    isPathInside,
    toSafeAssetBaseName,
    resolveSessionProjectDir,
    formatImagePathsForPrompt,
    buildAssetTimestamp,
    uploadSessionFiles,
    uploadImageAssets,
    resolveExistingFileRealPath,
    resolveWritableFileRealPath,
    resolveAllowedRoots,
    assertPathInAllowedRoots,
    encryptApiKey,
    decryptApiKey,
    PLANNER_TEMPERATURE,
    DESIGN_CONTRACT_TEMPERATURE,
    PAGE_GENERATION_TEMPERATURE,
    PAGE_EDIT_WITH_SELECTOR_TEMPERATURE,
    PAGE_EDIT_DEFAULT_TEMPERATURE,
    resolveSessionAssetSourcePath,
    ensureSessionAssets,
    scaffoldProjectFiles,
    PRINT_READY_PREFIX,
    EXPORT_PAGE_READY_TIMEOUT_MS,
    EXPORT_CAPTURE_SETTLE_MS,
    resolveSessionPageFiles,
    waitForPrintReadySignal,
    renderPageToPdfBuffer
  }
}
