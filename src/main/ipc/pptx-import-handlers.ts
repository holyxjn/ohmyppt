import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { IpcContext } from './context'
import { importPptxToEditableHtml, type PptxImportProgressPayload } from '../utils/pptx-importer'

type PptxImportPayload = {
  filePath?: unknown
  title?: unknown
  styleId?: unknown
}

const MAX_PPTX_SIZE = 80 * 1024 * 1024

const parsePayload = (payload: unknown): { filePath: string; title: string; styleId: string | null } => {
  const record = payload && typeof payload === 'object' ? (payload as PptxImportPayload) : {}
  const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : ''
  if (!filePath) throw new Error('PPTX 文件路径不能为空')
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const styleId = typeof record.styleId === 'string' && record.styleId.trim() ? record.styleId.trim() : null
  return { filePath, title, styleId }
}

export function registerPptxImportHandlers(ctx: IpcContext): void {
  const { db, resolveStoragePath, ensureSessionAssets, resolveExistingFileRealPath } = ctx

  ipcMain.handle('pptx:import', async (event, payload: unknown) => {
    const parsedPayload = parsePayload(payload)
    const sourcePath = await resolveExistingFileRealPath(parsedPayload.filePath)
    const extension = path.extname(sourcePath).toLowerCase()
    if (extension !== '.pptx') {
      throw new Error('仅支持导入 .pptx 文件')
    }
    const stat = await fs.promises.stat(sourcePath)
    if (stat.size > MAX_PPTX_SIZE) {
      throw new Error('PPTX 文件不能超过 80MB')
    }

    const sessionId = crypto.randomUUID()
    const storagePath = await resolveStoragePath()
    const projectDir = path.join(storagePath, sessionId)
    const originalFileName = path.basename(sourcePath)
    const title =
      parsedPayload.title || path.basename(originalFileName, path.extname(originalFileName)) || '导入的 PPTX'

    const sendProgress = (progress: PptxImportProgressPayload): void => {
      event.sender.send('pptx:import:progress', {
        ...progress,
        sessionId
      })
    }

    log.info('[pptx:import] invoke', {
      sessionId,
      filePath: sourcePath,
      size: stat.size
    })

    try {
      await fs.promises.mkdir(projectDir, { recursive: true })
      await ensureSessionAssets(projectDir)
      const imported = await importPptxToEditableHtml({
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
        model: 'pptx-import'
      })
      const projectId = await db.createProject({
        session_id: sessionId,
        title: imported.title,
        output_path: projectDir
      })
      const runId = await db.createGenerationRun({
        sessionId,
        mode: 'import',
        totalPages: imported.pageCount,
        metadata: {
          source: 'pptx-import',
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
      }
      await db.updateGenerationRunStatus(runId, 'completed')
      await db.updateSessionStatus(sessionId, 'completed')
      await db.updateSessionMetadata(sessionId, {
        source: 'pptx-import',
        importedAt: Date.now(),
        originalFileName,
        indexPath: imported.indexPath,
        generatedPages: imported.pages.map((page) => ({
          pageNumber: page.pageNumber,
          title: page.title,
          pageId: page.pageId,
          htmlPath: page.htmlPath
        })),
        warnings: imported.warnings.slice(0, 30)
      })
      await db.updateProjectStatus(projectId, 'draft')

      sendProgress({
        stage: 'completed',
        progress: 100,
        label: 'PPTX 导入完成',
        totalPages: imported.pageCount
      })

      log.info('[pptx:import] completed', {
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
        log.warn('[pptx:import] cleanup db failed', {
          sessionId,
          message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        })
      })
      await fs.promises.rm(projectDir, { recursive: true, force: true }).catch((cleanupError) => {
        log.warn('[pptx:import] cleanup project dir failed', {
          sessionId,
          projectDir,
          message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        })
      })
      log.error('[pptx:import] failed', {
        sessionId,
        filePath: sourcePath,
        message
      })
      throw error
    }
  })
}
