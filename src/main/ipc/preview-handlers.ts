import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { extractPagesDataFromIndex } from './template'
import type { IpcContext } from './context'

export function registerPreviewHandlers(ctx: IpcContext): void {
  const { parsePathPayload, normalizeSessionId, assertPathInAllowedRoots } = ctx

  ipcMain.handle('preview:load', async (_event, payload, legacySessionId?: string) => {
    const parsed = parsePathPayload(payload, 'htmlPath')
    const sessionId = parsed.sessionId ?? normalizeSessionId(legacySessionId)
    const safeHtmlPath = await assertPathInAllowedRoots({
      filePath: parsed.filePath,
      mode: 'read',
      sessionId,
      htmlOnly: true
    })
    return fs.promises.readFile(safeHtmlPath, 'utf-8')
  })

  ipcMain.handle(
    'preview:loadPage',
    async (_event, payloadOrHtmlPath: unknown, legacyPageId?: string, legacySessionId?: string) => {
      let htmlPath = ''
      let pageId = ''
      let sessionId: string | undefined
      if (payloadOrHtmlPath && typeof payloadOrHtmlPath === 'object') {
        const payload = payloadOrHtmlPath as {
          htmlPath?: unknown
          path?: unknown
          pageId?: unknown
          sessionId?: unknown
        }
        htmlPath =
          typeof payload.htmlPath === 'string'
            ? payload.htmlPath
            : typeof payload.path === 'string'
              ? payload.path
              : ''
        pageId = typeof payload.pageId === 'string' ? payload.pageId : ''
        sessionId = normalizeSessionId(payload.sessionId)
      } else {
        htmlPath = typeof payloadOrHtmlPath === 'string' ? payloadOrHtmlPath : ''
        pageId = typeof legacyPageId === 'string' ? legacyPageId : ''
        sessionId = normalizeSessionId(legacySessionId)
      }
      const normalizedPageId = pageId.trim()
      if (!normalizedPageId) {
        throw new Error('pageId 不能为空')
      }
      const safeHtmlPath = await assertPathInAllowedRoots({
        filePath: htmlPath,
        mode: 'read',
        sessionId,
        htmlOnly: true
      })
      const isPageFile = /\/page-\d+\.html?$/i.test(safeHtmlPath)
      if (isPageFile) {
        const html = await fs.promises.readFile(safeHtmlPath, 'utf-8')
        const numberMatch = safeHtmlPath.match(/page-(\d+)\.html?$/i)
        const pageNumber = numberMatch ? Number(numberMatch[1]) : 1
        return {
          pageNumber,
          pageId: normalizedPageId || `page-${pageNumber}`,
          title: `Page ${pageNumber}`,
          html
        }
      }

      const indexHtml = await fs.promises.readFile(safeHtmlPath, 'utf-8')
      const pages = extractPagesDataFromIndex(indexHtml)
      const page = pages.find((p) => p.pageId === normalizedPageId)
      if (!page) throw new Error(`Page ${normalizedPageId} not found in ${safeHtmlPath}`)
      if (page.htmlPath) {
        const resolvedPagePath = path.resolve(path.dirname(safeHtmlPath), page.htmlPath)
        const safeResolvedPagePath = await assertPathInAllowedRoots({
          filePath: resolvedPagePath,
          mode: 'read',
          sessionId,
          htmlOnly: true
        })
        const html = await fs.promises.readFile(safeResolvedPagePath, 'utf-8')
        return {
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: page.title,
          html
        }
      }
      return page
    }
  )
}
