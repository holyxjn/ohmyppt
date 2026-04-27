import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import log from 'electron-log/main.js'
import path from 'path'
import fs from 'fs'
import { PDFDocument } from 'pdf-lib'
import type { IpcContext } from './context'
import { writeHtmlToPptx, type HtmlToPptxSlide } from '../utils/html-to-pptx'
import { extractHtmlPageToPptxSlide } from '../utils/html-to-pptx-renderer'

type ExportPayload = {
  sessionId?: unknown
}

const parseSessionId = (payload: unknown): string => {
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as ExportPayload).sessionId === 'string'
  ) {
    return String((payload as { sessionId?: string }).sessionId).trim()
  }
  return typeof payload === 'string' ? payload.trim() : ''
}

const sanitizeExportBaseName = (value: string, fallback: string): string =>
  value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || fallback

const buildPngFileName = (pageNumber: number, title: string | undefined): string => {
  const paddedNumber = String(pageNumber).padStart(2, '0')
  const sanitizedTitle = sanitizeExportBaseName(String(title || '').trim(), `page-${paddedNumber}`)
  return `${paddedNumber}-${sanitizedTitle}.png`
}

export function registerExportHandlers(ctx: IpcContext): void {
  const {
    mainWindow,
    db,
    resolveSessionPageFiles,
    renderPageToPdfBuffer,
    waitForPrintReadySignal,
    EXPORT_PAGE_READY_TIMEOUT_MS,
    EXPORT_CAPTURE_SETTLE_MS
  } = ctx

  ipcMain.handle('export:pdf', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const { session, pages, projectDir } = await resolveSessionPageFiles(sessionId)
    const sessionTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const sanitizedBaseName = sanitizeExportBaseName(sessionTitle, `ohmyppt-${sessionId}`)

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: '导出 PDF',
      defaultPath: path.join(projectDir, `${sanitizedBaseName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    const warnings: string[] = []
    try {
      const mergedPdf = await PDFDocument.create()
      const pdfPageWidth = 16 * 72
      const pdfPageHeight = 9 * 72

      for (const page of pages) {
        log.info('[export:pdf] render page', {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath
        })
        const rendered = await renderPageToPdfBuffer({
          page,
          timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS
        })
        if (rendered.warning) warnings.push(rendered.warning)
        const embeddedImage = await mergedPdf.embedPng(rendered.pngBuffer)
        const pageDoc = mergedPdf.addPage([pdfPageWidth, pdfPageHeight])
        pageDoc.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: pdfPageWidth,
          height: pdfPageHeight
        })
      }

      const outputBytes = await mergedPdf.save()
      await fs.promises.writeFile(saveResult.filePath, outputBytes)
      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:pdf] completed', {
        sessionId,
        pageCount: pages.length,
        filePath: saveResult.filePath,
        warningCount: warnings.length
      })
      shell.showItemInFolder(saveResult.filePath)
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: pages.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:pdf] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  ipcMain.handle('export:png', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const { session, pages, projectDir } = await resolveSessionPageFiles(sessionId)
    const sessionTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const sanitizedBaseName = sanitizeExportBaseName(sessionTitle, `ohmyppt-${sessionId}`)

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const directoryResult = await dialog.showOpenDialog(ownerWindow, {
      title: '导出 PNG 图片',
      defaultPath: path.join(projectDir, `${sanitizedBaseName}-png`),
      buttonLabel: '导出到此文件夹',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    })

    if (directoryResult.canceled || directoryResult.filePaths.length === 0) {
      return { success: false, cancelled: true }
    }

    const outputDir = directoryResult.filePaths[0]
    const warnings: string[] = []

    try {
      await fs.promises.mkdir(outputDir, { recursive: true })
      for (const page of pages) {
        log.info('[export:png] render page', {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath
        })
        const rendered = await renderPageToPdfBuffer({
          page,
          timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS
        })
        if (rendered.warning) warnings.push(rendered.warning)
        await fs.promises.writeFile(
          path.join(outputDir, buildPngFileName(page.pageNumber, page.title)),
          rendered.pngBuffer
        )
      }

      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:png] completed', {
        sessionId,
        pageCount: pages.length,
        directoryPath: outputDir,
        warningCount: warnings.length
      })
      shell.openPath(outputDir).catch(() => {
        shell.showItemInFolder(outputDir)
      })
      return {
        success: true,
        cancelled: false,
        path: outputDir,
        pageCount: pages.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:png] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  ipcMain.handle('export:pptx', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const { session, pages, projectDir } = await resolveSessionPageFiles(sessionId)
    const sessionTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const sanitizedBaseName = sanitizeExportBaseName(sessionTitle, `ohmyppt-${sessionId}`)

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: '导出 PPTX',
      defaultPath: path.join(projectDir, `${sanitizedBaseName}.pptx`),
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    const warnings: string[] = []

    try {
      const slides: HtmlToPptxSlide[] = []
      for (const page of pages) {
        log.info('[export:pptx] extract page', {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath
        })
        const extracted = await extractHtmlPageToPptxSlide({
          page,
          timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS,
          settleMs: EXPORT_CAPTURE_SETTLE_MS,
          waitForPrintReadySignal
        })
        slides.push(extracted.slide)
        if (extracted.warning) warnings.push(extracted.warning)
        if (extracted.slide.texts.length === 0) {
          warnings.push(`页面 ${page.pageId} 未提取到可编辑文本。`)
        }
      }

      await writeHtmlToPptx(saveResult.filePath, {
        title: sessionTitle,
        author: 'OhMyPPT',
        slides
      })
      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:pptx] completed', {
        sessionId,
        pageCount: slides.length,
        filePath: saveResult.filePath,
        warningCount: warnings.length
      })
      shell.showItemInFolder(saveResult.filePath)
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: slides.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:pptx] failed', {
        sessionId,
        message
      })
      throw error
    }
  })
}
