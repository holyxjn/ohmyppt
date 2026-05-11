import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { normalizeSession, normalizeMessage } from '../utils'
import { getStyleDetail, hasStyleSkill } from '../../utils/style-skills'
import type { IpcContext } from '../context'
import { resolveActiveModelConfig } from '../config/model-config-utils'
import { readAppLocale, uiText } from '../config/locale-utils'

export function registerSessionHandlers(ctx: IpcContext): void {
  const {
    db,
    agentManager,
    resolveStoragePath,
    ensureSessionAssets,
    buildSessionGenerationSnapshot,
    getPageSourceUrl,
    resolveSessionProjectDir
  } = ctx

  const resolvePageHtmlPath = (
    projectDir: string,
    fileSlug: string,
    candidatePath?: string | null
  ): string => {
    const projectRoot = path.resolve(projectDir)
    const fallbackPath = path.resolve(projectRoot, `${fileSlug}.html`)
    const rawCandidate = typeof candidatePath === 'string' ? candidatePath.trim() : ''
    if (!rawCandidate) return fallbackPath
    const resolvedCandidate = path.isAbsolute(rawCandidate)
      ? path.resolve(rawCandidate)
      : path.resolve(projectRoot, rawCandidate)
    const relative = path.relative(projectRoot, resolvedCandidate)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return fallbackPath
    return fs.existsSync(resolvedCandidate) ? resolvedCandidate : fallbackPath
  }

  ipcMain.handle('session:create', async (_event, payload) => {
    const { topic, styleId, pageCount } = payload
    const referenceDocumentPath =
      typeof payload?.referenceDocumentPath === 'string' ? payload.referenceDocumentPath.trim() : ''
    const locale = await readAppLocale(ctx)
    const storagePath = await resolveStoragePath()
    const activeModel = await resolveActiveModelConfig(ctx)
    const { provider, model } = activeModel
    const baseUrl = activeModel.baseUrl
    const normalizedStyleId = typeof styleId === 'string' ? styleId.trim() : ''
    if (!normalizedStyleId) {
      throw new Error(
        uiText(
          locale,
          '创建会话失败：styleId 不能为空。',
          'Failed to create session: styleId is required.'
        )
      )
    }
    if (!hasStyleSkill(normalizedStyleId)) {
      throw new Error(
        uiText(
          locale,
          `创建会话失败：styleId 不存在 ${normalizedStyleId}`,
          `Failed to create session: styleId does not exist: ${normalizedStyleId}`
        )
      )
    }
    let validatedReferenceSourcePath: string | null = null
    if (referenceDocumentPath) {
      const storageRoot = fs.existsSync(storagePath)
        ? await fs.promises.realpath(storagePath)
        : path.resolve(storagePath)
      const sourcePath = path.resolve(referenceDocumentPath)
      if (!fs.existsSync(sourcePath)) {
        throw new Error(
          uiText(
            locale,
            '解析后的文档不存在，请重新解析文档',
            'The parsed document no longer exists. Parse the document again.'
          )
        )
      }
      const sourceRealPath = await fs.promises.realpath(sourcePath)
      const relativeToStorage = path.relative(storageRoot, sourceRealPath)
      if (relativeToStorage.startsWith('..') || path.isAbsolute(relativeToStorage)) {
        throw new Error(
          uiText(
            locale,
            '文档路径不在用户配置目录内，请重新解析文档',
            'The document path is outside the configured storage folder. Parse the document again.'
          )
        )
      }
      validatedReferenceSourcePath = sourceRealPath
    }
    const sessionId = crypto.randomUUID()
    const projectDir = path.join(storagePath, sessionId)

    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true })
    }
    await ensureSessionAssets(projectDir)
    const copyReferenceDocumentToSession = async (): Promise<string | null> => {
      if (!validatedReferenceSourcePath) return null
      const docsDir = path.join(projectDir, 'docs')
      await fs.promises.mkdir(docsDir, { recursive: true })
      const ext = path.extname(validatedReferenceSourcePath).toLowerCase() || '.md'
      const fileName = `${Date.now()}${ext}`
      const targetPath = path.join(docsDir, fileName)
      await fs.promises.copyFile(validatedReferenceSourcePath, targetPath)
      return `/docs/${fileName}`
    }
    const sessionReferenceDocumentPath = await copyReferenceDocumentToSession()

    const styleDetail = getStyleDetail(normalizedStyleId)
    log.info('[session:create] style selected', {
      sessionId,
      styleId: normalizedStyleId,
      styleKey: styleDetail.styleKey,
      styleLabel: styleDetail.label
    })

    await agentManager.createSession({
      sessionId,
      provider,
      model,
      baseUrl,
      projectDir,
      topic,
      styleId: normalizedStyleId,
      pageCount,
      referenceDocumentPath: sessionReferenceDocumentPath
    })

    await db.createProject({
      session_id: sessionId,
      title: String(topic || 'Untitled'),
      output_path: projectDir,
      root_path: projectDir
    })

    return { sessionId }
  })

  ipcMain.handle('session:list', async () => {
    const sessions = await db.listSessions()
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        const snapshot = await buildSessionGenerationSnapshot(
          session as unknown as Record<string, unknown>,
          {
            includeHtml: false
          }
        )
        const enriched = snapshot.session || (session as unknown as Record<string, unknown>)
        const run = await db.getLatestGenerationRun(session.id)
        if (run && run.updated_at > run.created_at) {
          enriched.generation_duration_sec = run.updated_at - run.created_at
        }
        return enriched
      })
    )
    return enrichedSessions.map((session) =>
      normalizeSession(session as unknown as Record<string, unknown>)
    )
  })

  ipcMain.handle('session:updateTitle', async (_event, payload: unknown) => {
    const locale = await readAppLocale(ctx)
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (!sessionId) throw new Error(uiText(locale, '会话 ID 不能为空', 'Session ID is required.'))
    if (!title) throw new Error(uiText(locale, '会话名称不能为空', 'Session title is required.'))
    if (title.length > 120) {
      throw new Error(
        uiText(locale, '会话名称不能超过 120 个字符', 'Session title cannot exceed 120 characters.')
      )
    }
    const existingSession = await db.getSession(sessionId)
    if (!existingSession) {
      throw new Error(
        uiText(locale, '会话不存在或已被删除', 'The session does not exist or has been deleted.')
      )
    }
    await db.updateSessionTitle(sessionId, title)
    return { ok: true }
  })

  ipcMain.handle('session:get', async (_event, sessionId) => {
    const session = await db.getSession(sessionId)
    if (!session) {
      return {
        session: normalizeSession(undefined),
        messages: [],
        generatedPages: []
      }
    }
    const messages = await db.getSessionMessages(sessionId, { chatScope: 'main' })
    const generatedPages: Array<{
      id: string
      pageNumber: number
      title: string
      html: string
      htmlPath?: string
      pageId?: string
      sourceUrl?: string
      status?: string
      error?: string | null
    }> = []
    const sessionPages = await db.listSessionPages(sessionId)
    if (sessionPages.length === 0) {
      throw new Error('session_pages is empty after migration; please re-run migration patch')
    }
    const projectDir = await resolveSessionProjectDir(sessionId)
    for (const sp of sessionPages) {
      const htmlPath = resolvePageHtmlPath(projectDir, sp.file_slug, sp.html_path)
      let html = ''
      try {
        if (htmlPath && fs.existsSync(htmlPath)) {
          html = fs.readFileSync(htmlPath, 'utf-8')
        }
      } catch {
        html = ''
      }
      generatedPages.push({
        id: sp.id,
        pageNumber: sp.page_number,
        title: sp.title,
        html,
        htmlPath,
        pageId: sp.file_slug,
        sourceUrl: getPageSourceUrl(htmlPath),
        status: sp.status,
        error: sp.error
      })
    }
    const completedCount = generatedPages.filter((page) => page.status === 'completed').length
    const failedCount = generatedPages.filter((page) => page.status === 'failed').length

    return {
      session: normalizeSession({
        ...(session as unknown as Record<string, unknown>),
        page_count: generatedPages.length,
        generated_count: completedCount,
        failed_count: failedCount
      }),
      messages: messages.map((message) =>
        normalizeMessage(message as unknown as Record<string, unknown>)
      ),
      generatedPages
    }
  })

  ipcMain.handle(
    'session:getMessages',
    async (_event, payload: { sessionId: string; chatType?: 'main' | 'page'; pageId?: string }) => {
      const chatType = payload?.chatType === 'page' ? 'page' : 'main'
      const pageId =
        chatType === 'page' &&
        typeof payload?.pageId === 'string' &&
        payload.pageId.trim().length > 0
          ? payload.pageId.trim()
          : undefined
      const messages = await db.getSessionMessages(payload.sessionId, {
        chatScope: chatType,
        pageId
      })
      return messages.map((message) =>
        normalizeMessage(message as unknown as Record<string, unknown>)
      )
    }
  )

  ipcMain.handle('session:delete', async (_event, sessionId) => {
    await db.deleteSession(sessionId)
    return { success: true }
  })
}
