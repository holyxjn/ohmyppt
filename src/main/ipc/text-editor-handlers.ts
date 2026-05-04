import { ipcMain } from 'electron'
import * as cheerio from 'cheerio'
import fs from 'fs'
import type { IpcContext } from './context'

const EDITABLE_TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'label',
  'button',
  'td',
  'th'
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

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function patchHtmlFile(
  safeHtmlPath: string,
  selector: string,
  patch: {
    text?: string
    style?: {
      color?: string
      fontSize?: string
      fontWeight?: string
    }
  }
): Promise<void> {
  await withHtmlFileLock(safeHtmlPath, async () => {
    const html = await fs.promises.readFile(safeHtmlPath, 'utf-8')
    const nextHtml = patchElementProperties(html, selector, patch)
    await fs.promises.writeFile(safeHtmlPath, nextHtml, 'utf-8')
  })
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

function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(text)) return text
  if (/^rgba?\([\d\s.,%]+\)$/i.test(text)) return text
  return null
}

function normalizeFontSize(value: unknown): string | null {
  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const numberValue = Number(raw.replace(/px$/i, ''))
  if (!Number.isFinite(numberValue)) return null
  const clamped = Math.max(8, Math.min(160, Math.round(numberValue * 10) / 10))
  return `${clamped}px`
}

function normalizeFontWeight(value: unknown): string | null {
  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  if (['normal', 'bold', 'lighter', 'bolder'].includes(raw)) return raw
  const numberValue = Number(raw)
  if (!Number.isFinite(numberValue)) return null
  const clamped = Math.max(100, Math.min(900, Math.round(numberValue / 100) * 100))
  return String(clamped)
}

function patchElementProperties(
  html: string,
  selector: string,
  patch: {
    text?: string
    style?: {
      color?: string
      fontSize?: string
      fontWeight?: string
    }
  }
): string {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  let target
  try {
    target = $(selector).first()
  } catch {
    throw new Error('无法定位文字元素：selector 无效')
  }
  if (!target || target.length === 0) {
    throw new Error('无法定位文字元素：页面内容可能已经变化')
  }

  const node = target.get(0)
  const tagName = String(node?.tagName || '').toLowerCase()
  const hasRole = Boolean(target.attr('data-role'))
  if (!EDITABLE_TEXT_TAGS.has(tagName) && !hasRole) {
    throw new Error(`当前元素暂不支持直接编辑文字：<${tagName || 'unknown'}>`)
  }
  if (target.children().length > 0) {
    throw new Error('当前元素包含子元素，暂不支持直接编辑；可以选择更内层的文字。')
  }

  if (typeof patch.text === 'string') {
    const text = normalizeText(patch.text)
    if (!text) throw new Error('文字不能为空')
    if (text.length > 500) throw new Error('文字不能超过 500 个字符')
    target.text(text)
  }

  const stylePatch = patch.style || {}
  const styleMap = parseStyle(target.attr('style') || '')
  const color = normalizeColor(stylePatch.color)
  const fontSize = normalizeFontSize(stylePatch.fontSize)
  const fontWeight = normalizeFontWeight(stylePatch.fontWeight)
  if (color) styleMap.set('color', color)
  if (fontSize) styleMap.set('font-size', fontSize)
  if (fontWeight) styleMap.set('font-weight', fontWeight)
  if (color || fontSize || fontWeight) {
    target.attr('style', serializeStyle(styleMap))
  }

  return $.html()
}

export function registerTextEditorHandlers(ctx: IpcContext): void {
  const { normalizeSessionId, assertPathInAllowedRoots } = ctx

  ipcMain.handle('text-editor:update-element-text', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('文字更新参数无效')
    }
    const record = payload as {
      sessionId?: unknown
      htmlPath?: unknown
      pageId?: unknown
      selector?: unknown
      text?: unknown
    }
    const sessionId = normalizeSessionId(record.sessionId)
    const htmlPath = typeof record.htmlPath === 'string' ? record.htmlPath : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    const selector = typeof record.selector === 'string' ? record.selector.trim() : ''
    const text = normalizeText(record.text)
    if (!htmlPath) throw new Error('页面路径不能为空')
    if (!pageId) throw new Error('pageId 不能为空')
    if (!selector) throw new Error('文字元素 selector 不能为空')
    if (!text) throw new Error('文字不能为空')
    if (text.length > 500) throw new Error('文字不能超过 500 个字符')

    const safeHtmlPath = await assertPathInAllowedRoots({
      filePath: htmlPath,
      mode: 'write',
      sessionId,
      htmlOnly: true
    })
    await patchHtmlFile(safeHtmlPath, selector, { text })
    return { success: true }
  })

  ipcMain.handle('text-editor:update-element-properties', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('文字属性更新参数无效')
    }
    const record = payload as {
      sessionId?: unknown
      htmlPath?: unknown
      pageId?: unknown
      selector?: unknown
      patch?: unknown
    }
    const sessionId = normalizeSessionId(record.sessionId)
    const htmlPath = typeof record.htmlPath === 'string' ? record.htmlPath : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    const selector = typeof record.selector === 'string' ? record.selector.trim() : ''
    const rawPatch =
      record.patch && typeof record.patch === 'object'
        ? (record.patch as {
            text?: unknown
            style?: unknown
          })
        : {}
    const rawStyle =
      rawPatch.style && typeof rawPatch.style === 'object'
        ? (rawPatch.style as Record<string, unknown>)
        : {}
    if (!htmlPath) throw new Error('页面路径不能为空')
    if (!pageId) throw new Error('pageId 不能为空')
    if (!selector) throw new Error('文字元素 selector 不能为空')

    const safeHtmlPath = await assertPathInAllowedRoots({
      filePath: htmlPath,
      mode: 'write',
      sessionId,
      htmlOnly: true
    })
    await patchHtmlFile(safeHtmlPath, selector, {
      text: typeof rawPatch.text === 'string' ? rawPatch.text : undefined,
      style: {
        color: typeof rawStyle.color === 'string' ? rawStyle.color : undefined,
        fontSize: typeof rawStyle.fontSize === 'string' ? rawStyle.fontSize : undefined,
        fontWeight: typeof rawStyle.fontWeight === 'string' ? rawStyle.fontWeight : undefined
      }
    })
    return { success: true }
  })
}
