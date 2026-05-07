import { ipcMain } from 'electron'
import * as cheerio from 'cheerio'
import fs from 'fs'
import type { IpcContext } from '../context'

function clampDragValue(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(-1600, Math.min(1600, Math.round(parsed * 10) / 10))
}

function clampSizeValue(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(1, Math.min(3200, Math.round(parsed * 10) / 10))
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

const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'code',
  'em',
  'i',
  'label',
  'small',
  'span',
  'strong',
  'sub',
  'sup'
])

const htmlWriteLocks = new Map<string, Promise<void>>()

async function withHtmlFileLock<T>(htmlPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = htmlWriteLocks.get(htmlPath) || Promise.resolve()
  const run = previous.then(fn, fn)
  const next = run.then(
    () => undefined,
    () => undefined
  )
  htmlWriteLocks.set(htmlPath, next)
  return run.finally(() => {
    if (htmlWriteLocks.get(htmlPath) === next) {
      htmlWriteLocks.delete(htmlPath)
    }
  })
}

interface ChildStyleUpdate {
  path: number[]
  width: number | null
  height: number | null
}

function normalizeChildStyleUpdates(value: unknown): ChildStyleUpdate[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): ChildStyleUpdate | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as { path?: unknown; width?: unknown; height?: unknown }
      if (!Array.isArray(record.path) || record.path.length === 0 || record.path.length > 12) return null
      const path = record.path
        .map((part) => Number(part))
        .filter((part) => Number.isInteger(part) && part >= 0 && part <= 200)
      if (path.length !== record.path.length) return null
      const width = clampSizeValue(record.width)
      const height = clampSizeValue(record.height)
      if (width === null && height === null) return null
      return { path, width, height }
    })
    .filter((item): item is ChildStyleUpdate => item !== null)
    .slice(0, 20)
}

function patchDraggedElementStyle(
  html: string,
  selector: string,
  x: number,
  y: number,
  width: number | null,
  height: number | null,
  childUpdates: ChildStyleUpdate[]
): string {
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
  const tagName = String(target.get(0)?.tagName || '').toLowerCase()
  if (INLINE_TAGS.has(tagName) && !styleMap.has('display')) {
    styleMap.set('display', 'inline-block')
  }
  const position = String(styleMap.get('position') || '').trim().toLowerCase()
  if (!position || position === 'static') {
    styleMap.set('position', 'relative')
  }
  if (!styleMap.has('z-index')) {
    styleMap.set('z-index', '10')
  }
  styleMap.set('--ppt-drag-x', `${x}px`)
  styleMap.set('--ppt-drag-y', `${y}px`)
  styleMap.set('translate', 'var(--ppt-drag-x, 0px) var(--ppt-drag-y, 0px)')
  if (width !== null) styleMap.set('width', `${width}px`)
  if (height !== null) styleMap.set('height', `${height}px`)
  styleMap.delete('will-change')
  target.attr('style', serializeStyle(styleMap))

  for (const childUpdate of childUpdates) {
    let child = target
    for (const index of childUpdate.path) {
      child = child.children().eq(index)
      if (!child || child.length === 0) break
    }
    if (!child || child.length === 0) continue
    const childStyleMap = parseStyle(child.attr('style') || '')
    if (childUpdate.width !== null) childStyleMap.set('width', `${childUpdate.width}px`)
    if (childUpdate.height !== null) childStyleMap.set('height', `${childUpdate.height}px`)
    child.attr('style', serializeStyle(childStyleMap))
  }

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
      width?: unknown
      height?: unknown
      childUpdates?: unknown
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
    await withHtmlFileLock(safeHtmlPath, async () => {
      const html = await fs.promises.readFile(safeHtmlPath, 'utf-8')
      const nextHtml = patchDraggedElementStyle(
        html,
        selector,
        clampDragValue(record.x),
        clampDragValue(record.y),
        clampSizeValue(record.width),
        clampSizeValue(record.height),
        normalizeChildStyleUpdates(record.childUpdates)
      )
      await fs.promises.writeFile(safeHtmlPath, nextHtml, 'utf-8')
    })
    return { success: true }
  })
}
