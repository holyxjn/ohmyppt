import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { IpcContext } from '../context'
import { importHtmlToEditableDeck, type HtmlImportProgressPayload } from '../../utils/html-importer'
import { recordHistoryOperationStrict } from '../../history/git-history-service'

type HtmlImportPayload = {
  filePath?: unknown
  title?: unknown
  styleId?: unknown
}

const MAX_HTML_SIZE = 50 * 1024 * 1024

const parsePayload = (payload: unknown): { filePath: string; title: string; styleId: string | null } => {
  const record = payload && typeof payload === 'object' ? (payload as HtmlImportPayload) : {}
  const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : ''
  if (!filePath) throw new Error('HTML 文件路径不能为空')
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const styleId = typeof record.styleId === 'string' && record.styleId.trim() ? record.styleId.trim() : null
  return { filePath, title, styleId }
}

export function registerHtmlImportHandlers(ctx: IpcContext): void {
  const { db, resolveStoragePath, ensureSessionAssets, resolveExistingFileRealPath } = ctx

  ipcMain.handle('html:import', async (event, payload: unknown) => {
    const parsedPayload = parsePayload(payload)
    const sourcePath = await resolveExistingFileRealPath(parsedPayload.filePath)
    const extension = path.extname(sourcePath).toLowerCase()
    if (extension !== '.html' && extension !== '.htm') {
      throw new Error('仅支持导入 .html / .htm 文件')
    }
    const stat = await fs.promises.stat(sourcePath)
    if (stat.size > MAX_HTML_SIZE) {
      throw new Error('HTML 文件不能超过 50MB')
    }

    const sessionId = crypto.randomUUID()
    const storagePath = await resolveStoragePath()
    const projectDir = path.join(storagePath, sessionId)
    const originalFileName = path.basename(sourcePath)
    const title = parsedPayload.title || path.basename(originalFileName, path.extname(originalFileName)) || '导入的 HTML'

    const sendProgress = (progress: HtmlImportProgressPayload): void => {
      event.sender.send('html:import:progress', {
        ...progress,
        sessionId
      })
    }

    log.info('[html:import] invoke', {
      sessionId,
      filePath: sourcePath,
      size: stat.size
    })

    try {
      await fs.promises.mkdir(projectDir, { recursive: true })
      await ensureSessionAssets(projectDir)
      const imported = await importHtmlToEditableDeck({
        filePath: sourcePath,
        projectDir,
        title,
        onProgress: sendProgress
      })

      sendProgress({
        stage: 'database',
        progress: 94,
        label: '正在写入会话记录',
        totalPages: imported.pageCount
      })

      await db.createSession({
        id: sessionId,
        title: imported.title,
        topic: imported.title,
        styleId: parsedPayload.styleId || undefined,
        pageCount: imported.pageCount,
        provider: 'import',
        model: 'html-import'
      })
      const projectId = await db.createProject({
        session_id: sessionId,
        title: imported.title,
        output_path: projectDir,
        root_path: projectDir
      })
      const runId = await db.createGenerationRun({
        sessionId,
        mode: 'import',
        totalPages: imported.pageCount,
        metadata: {
          source: 'html-import',
          originalFileName
        }
      })
      for (const page of imported.pages) {
        await db.upsertGenerationPage({
          runId,
          sessionId,
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          contentOutline: page.contentOutline,
          htmlPath: page.htmlPath,
          status: 'completed'
        })
        await db.upsertSessionPage({
          id: crypto.randomUUID(),
          sessionId,
          legacyPageId: /^page-\d+$/i.test(page.pageId) ? page.pageId : null,
          fileSlug: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          htmlPath: page.htmlPath,
          status: 'completed',
          error: null
        })
      }
      await db.updateGenerationRunStatus(runId, 'completed')
      await db.updateSessionStatus(sessionId, 'completed')
      await db.updateSessionMetadata(sessionId, {
        source: 'html-import',
        importedAt: Date.now(),
        originalFileName,
        indexPath: imported.indexPath,
        warnings: imported.warnings.slice(0, 30)
      })
      await db.updateProjectStatus(projectId, 'draft')
      await recordHistoryOperationStrict(db, {
        sessionId,
        projectDir,
        type: 'import',
        scope: 'session',
        prompt: `导入 HTML：${originalFileName}`,
        metadata: {
          runId,
          source: 'html-import',
          originalFileName,
          pageCount: imported.pageCount
        }
      })

      sendProgress({
        stage: 'completed',
        progress: 100,
        label: 'HTML 导入完成',
        totalPages: imported.pageCount
      })

      log.info('[html:import] completed', {
        sessionId,
        pageCount: imported.pageCount,
        warningCount: imported.warnings.length,
        projectDir
      })

      return {
        sessionId,
        pageCount: imported.pageCount,
        warnings: imported.warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db.deleteSession(sessionId).catch((cleanupError) => {
        log.warn('[html:import] cleanup db failed', {
          sessionId,
          message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        })
      })
      await fs.promises.rm(projectDir, { recursive: true, force: true }).catch((cleanupError) => {
        log.warn('[html:import] cleanup project dir failed', {
          sessionId,
          projectDir,
          message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        })
      })
      log.error('[html:import] failed', {
        sessionId,
        filePath: sourcePath,
        message
      })
      throw error
    }
  })
}
