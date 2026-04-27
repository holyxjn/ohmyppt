import { ipcMain } from 'electron'
import * as cheerio from 'cheerio'
import fs from 'fs'
import type { IpcContext } from './context'

function clampDragValue(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(-1600, Math.min(1600, Math.round(parsed * 10) / 10))
}

function parseStyle(style: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const rawDeclaration of style.split(';')) {
    const declaration = rawDeclaration.trim()
    if (!declaration) continue
    const separatorIndex = declaration.indexOf(':')
    if (separatorIndex < 0) continue
    const key = declaration.slice(0, separatorIndex).trim()
    const value = declaration.slice(separatorIndex + 1).trim()
    if (!key || !value) continue
    map.set(key, value)
  }
  return map
}

function serializeStyle(styleMap: Map<string, string>): string {
  return Array.from(styleMap.entries())
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ')
}

function patchDraggedElementStyle(html: string, selector: string, x: number, y: number): string {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  let target
  try {
    target = $(selector).first()
  } catch {
    throw new Error('无法定位拖拽元素：selector 无效')
  }
  if (!target || target.length === 0) {
    throw new Error('无法定位拖拽元素：页面内容可能已经变化')
  }

  const styleMap = parseStyle(target.attr('style') || '')
  styleMap.set('--ppt-drag-x', `${x}px`)
  styleMap.set('--ppt-drag-y', `${y}px`)
  styleMap.set('translate', 'var(--ppt-drag-x, 0px) var(--ppt-drag-y, 0px)')
  styleMap.delete('will-change')
  target.attr('style', serializeStyle(styleMap))
  return $.html()
}

export function registerDragEditorHandlers(ctx: IpcContext): void {
  const { normalizeSessionId, assertPathInAllowedRoots } = ctx

  ipcMain.handle('drag-editor:update-element-layout', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('拖拽更新参数无效')
    }
    const record = payload as {
      sessionId?: unknown
      htmlPath?: unknown
      pageId?: unknown
      selector?: unknown
      x?: unknown
      y?: unknown
    }
    const sessionId = normalizeSessionId(record.sessionId)
    const htmlPath = typeof record.htmlPath === 'string' ? record.htmlPath : ''
    const selector = typeof record.selector === 'string' ? record.selector.trim() : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    if (!htmlPath) throw new Error('页面路径不能为空')
    if (!pageId) throw new Error('pageId 不能为空')
    if (!selector) throw new Error('拖拽元素 selector 不能为空')

    const safeHtmlPath = await assertPathInAllowedRoots({
      filePath: htmlPath,
      mode: 'write',
      sessionId,
      htmlOnly: true
    })
    const html = await fs.promises.readFile(safeHtmlPath, 'utf-8')
    const nextHtml = patchDraggedElementStyle(
      html,
      selector,
      clampDragValue(record.x),
      clampDragValue(record.y)
    )
    await fs.promises.writeFile(safeHtmlPath, nextHtml, 'utf-8')
    return { success: true }
  })
}
