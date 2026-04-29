import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import * as cheerio from 'cheerio'
import { parse, type Chart, type Element, type Fill, type Slide } from 'pptxtojson/dist/index.js'
import { buildPageScaffoldHtml, buildProjectIndexHtml, type DeckPageFile } from '../ipc/template'
import { escapeHtml } from '../ipc/utils'
import { validatePersistedPageHtml } from '../tools/html-utils'

const PAGE_WIDTH = 1600
const PAGE_HEIGHT = 900

type ImportWarning = {
  pageNumber?: number
  message: string
}

export type PptxImportProgressPayload = {
  sessionId?: string
  stage: 'reading' | 'parsing' | 'media' | 'pages' | 'index' | 'database' | 'completed'
  progress: number
  label: string
  pageNumber?: number
  totalPages?: number
}

type ImportProgress = (payload: PptxImportProgressPayload) => void

type ImageRegistry = {
  index: number
  byKey: Map<string, string>
}

type ChartSeries = {
  key?: string
  values?: Array<{ x?: string; y?: number }>
}

type FlattenedElement = {
  element: Element
  left: number
  top: number
  width: number
  height: number
  text: string
}

export type ImportedPptxPage = {
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
  html: string
  contentOutline: string
}

export type ImportedPptxDeck = {
  title: string
  pageCount: number
  indexPath: string
  pages: ImportedPptxPage[]
  warnings: string[]
}

const clampNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const stripHtml = (html: string): string => {
  if (!html) return ''
  const $ = cheerio.load(html, { scriptingEnabled: false })
  return $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

const flattenElements = (
  elements: Element[],
  offsetX = 0,
  offsetY = 0
): FlattenedElement[] => {
  const flattened: FlattenedElement[] = []
  for (const element of elements) {
    const record = element as unknown as Record<string, unknown>
    const left = offsetX + clampNumber(record.left)
    const top = offsetY + clampNumber(record.top)
    if (element.type === 'group') {
      flattened.push(
        ...flattenElements(
          Array.isArray(element.elements) ? element.elements : [],
          left,
          top
        )
      )
      continue
    }
    flattened.push({
      element,
      left,
      top,
      width: clampNumber(record.width),
      height: clampNumber(record.height),
      text: 'content' in element ? stripHtml(String(element.content || '')) : ''
    })
  }
  return flattened
}

const isLowValueTitleText = (text: string): boolean => {
  const normalized = text.toLowerCase()
  if (!normalized) return true
  if (/https?:\/\//i.test(text) || /www\./i.test(text)) return true
  if (normalized.includes('ppt模板') || normalized.includes('1ppt.com')) return true
  if (text.includes('单击此处输入') || text.includes('请输入')) return true
  if (normalized.includes('thank you for your attention')) return true
  return false
}

const hasCjkText = (text: string): boolean => /[\u3400-\u9fff]/.test(text)

const hasDeckTitleKeyword = (text: string): boolean =>
  /(总结|汇报|报告|计划|规划|方案|复盘|目录|概述|情况|不足|introduction|overview|summary|agenda|conclusion|plan|report|review)/i.test(text)

const ALLOWED_TEXT_TAGS = new Set([
  'p',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'sub',
  'sup'
])

const DANGEROUS_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
  'img'
])

const ALLOWED_TEXT_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'text-decoration',
  'text-align',
  'line-height',
  'vertical-align',
  'letter-spacing'
])

const sanitizeCssValue = (property: string, rawValue: string, scale: number): string | null => {
  const value = rawValue.trim()
  if (!value) return null
  if (/url\s*\(|expression\s*\(|javascript:|data:/i.test(value)) return null
  if (property === 'font-size' || property === 'line-height') {
    const ptMatch = value.match(/^([0-9.]+)pt$/i)
    if (ptMatch) {
      const px = Math.max(8, clampNumber(ptMatch[1]) * scale)
      return `${px.toFixed(1)}px`
    }
  }
  if (/^[#a-z0-9\s.,()%'"-]+$/i.test(value)) return value
  return null
}

const sanitizeImportedCssColor = (rawValue: unknown): string | null => {
  if (typeof rawValue !== 'string') return null
  return sanitizeCssValue('color', rawValue, 1)
}

const sanitizeGradientStop = (rawColor: unknown, rawPosition: unknown): string | null => {
  const color = sanitizeImportedCssColor(rawColor)
  if (!color) return null
  const position = typeof rawPosition === 'string' || typeof rawPosition === 'number'
    ? String(rawPosition).trim()
    : ''
  if (!position) return color
  return /^[0-9.]+%?$/.test(position) ? `${color} ${position}` : color
}

const sanitizeStyleAttribute = (style: string, scale: number): string => {
  return style
    .split(';')
    .map((part) => {
      const [propertyRaw, ...valueParts] = part.split(':')
      const property = propertyRaw?.trim().toLowerCase()
      const valueRaw = valueParts.join(':')
      if (!property || !ALLOWED_TEXT_STYLE_PROPS.has(property)) return ''
      const value = sanitizeCssValue(property, valueRaw, scale)
      return value ? `${property}:${value}` : ''
    })
    .filter(Boolean)
    .join(';')
}

const sanitizeContentHtml = (html: string, scale: number): string => {
  if (!html) return ''
  const $ = cheerio.load(`<body>${html}</body>`, { scriptingEnabled: false })
  $('*').each((_, node) => {
    const rawNode = node as unknown as { tagName?: string; attribs?: Record<string, string> }
    const element = $(node)
    const tagName = String(rawNode.tagName || '').toLowerCase()
    if (DANGEROUS_TAGS.has(tagName)) {
      element.remove()
      return
    }
    if (!ALLOWED_TEXT_TAGS.has(tagName)) {
      element.replaceWith(element.contents())
      return
    }
    for (const attribute of Object.keys(rawNode.attribs || {})) {
      const value = element.attr(attribute) || ''
      const name = attribute.toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttr(attribute)
        continue
      }
      if (name !== 'style') {
        element.removeAttr(attribute)
        continue
      }
      const sanitizedStyle = sanitizeStyleAttribute(value, scale)
      if (sanitizedStyle) {
        element.attr('style', sanitizedStyle)
      } else {
        element.removeAttr('style')
      }
    }
  })
  return $('body').html() || ''
}

const getRegistryKey = (key: string, dataUrl: string): string => {
  const stableKey = key.trim()
  if (stableKey && stableKey.length < 512 && !stableKey.startsWith('data:')) return `ref:${stableKey}`
  return `sha256:${crypto.createHash('sha256').update(stableKey || dataUrl).digest('hex')}`
}

const getDataUrlInfo = (dataUrl: string): { mimeType: string; extension: string; data: string } => {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) return { mimeType: 'application/octet-stream', extension: '.bin', data: dataUrl }
  const mimeType = match[1]
  const extension =
    mimeType === 'image/png'
      ? '.png'
      : mimeType === 'image/jpeg'
        ? '.jpg'
        : mimeType === 'image/webp'
          ? '.webp'
          : mimeType === 'image/gif'
            ? '.gif'
            : mimeType === 'image/svg+xml'
              ? '.svg'
              : '.bin'
  return { mimeType, extension, data: match[2] }
}

const writeImageDataUrl = async (
  imagesDir: string,
  registry: ImageRegistry,
  key: string,
  dataUrl: string
): Promise<string | null> => {
  if (!dataUrl) return null
  const registryKey = getRegistryKey(key, dataUrl)
  const existing = registry.byKey.get(registryKey)
  if (existing) return existing
  const info = getDataUrlInfo(dataUrl)
  if (!info.data || info.extension === '.bin') return null
  registry.index += 1
  const fileName = `imported-${String(registry.index).padStart(4, '0')}${info.extension}`
  const targetPath = path.join(imagesDir, fileName)
  await fs.promises.writeFile(targetPath, Buffer.from(info.data, 'base64'))
  const relativePath = `./images/${fileName}`
  registry.byKey.set(registryKey, relativePath)
  return relativePath
}

const fillToCss = async (
  fill: Fill | undefined,
  imagesDir: string,
  registry: ImageRegistry
): Promise<string[]> => {
  if (!fill) return []
  if (fill.type === 'color' && fill.value) {
    const color = sanitizeImportedCssColor(fill.value)
    return color ? [`background:${color}`] : []
  }
  if (fill.type === 'image' && fill.value?.base64) {
    const imagePath = await writeImageDataUrl(
      imagesDir,
      registry,
      fill.value.ref || fill.value.base64,
      fill.value.base64
    )
    if (imagePath) {
      return [
        `background-image:url('${imagePath}')`,
        'background-size:cover',
        'background-position:center'
      ]
    }
  }
  if (fill.type === 'gradient' && Array.isArray(fill.value?.colors) && fill.value.colors.length) {
    const colors = fill.value.colors
      .map((item) => sanitizeGradientStop(item.color, item.pos))
      .filter((item): item is string => Boolean(item))
    return colors.length ? [`background:linear-gradient(135deg, ${colors.join(', ')})`] : []
  }
  return []
}

const buildBlockStyle = (args: {
  element: Record<string, unknown>
  scaleX: number
  scaleY: number
  zIndex: number
  offsetX?: number
  offsetY?: number
  overflow?: 'hidden' | 'visible'
  extra?: string[]
}): string => {
  const x = (clampNumber(args.element.left) + clampNumber(args.offsetX)) * args.scaleX
  const y = (clampNumber(args.element.top) + clampNumber(args.offsetY)) * args.scaleY
  const width = Math.max(1, clampNumber(args.element.width) * args.scaleX)
  const height = Math.max(1, clampNumber(args.element.height) * args.scaleY)
  const rotate = clampNumber(args.element.rotate)
  const styles = [
    'position:absolute',
    `left:${x.toFixed(1)}px`,
    `top:${y.toFixed(1)}px`,
    `width:${width.toFixed(1)}px`,
    `height:${height.toFixed(1)}px`,
    `z-index:${args.zIndex}`,
    `overflow:${args.overflow || 'visible'}`,
    rotate ? `transform:rotate(${rotate.toFixed(2)}deg)` : ''
  ]
  return [...styles, ...(args.extra || [])].filter(Boolean).join(';')
}

const borderCss = (element: Record<string, unknown>, scale: number): string[] => {
  const width = clampNumber(element.borderWidth)
  if (width <= 0) return []
  const color = sanitizeImportedCssColor(element.borderColor) || '#d1d5db'
  const rawType = typeof element.borderType === 'string' ? element.borderType.trim().toLowerCase() : ''
  const type = ['solid', 'dashed', 'dotted', 'double'].includes(rawType) ? rawType : 'solid'
  return [`border:${Math.max(1, width * scale).toFixed(1)}px ${type} ${color}`]
}

const titleFromSlide = (slide: Slide, pageNumber: number): string => {
  const candidates = flattenElements([...(slide.layoutElements || []), ...(slide.elements || [])])
    .filter((item) => (item.element.type === 'text' || item.element.type === 'shape') && item.text.length > 0)
    .map((item) => {
      const area = item.width * item.height
      const textLength = Array.from(item.text).length
      const isShortFragment = textLength <= 1
      const isPrimaryBand = item.top < 180
      const score =
        area +
        (isPrimaryBand ? 8000 : 0) +
        (hasCjkText(item.text) ? 5000 : 0) +
        (hasDeckTitleKeyword(item.text) ? 28000 : 0) +
        (textLength >= 2 && textLength <= 28 ? 6000 : 0) -
        (isShortFragment ? 16000 : 0) -
        (isLowValueTitleText(item.text) ? 50000 : 0)
      return { ...item, area, score }
    })
    .sort((a, b) => b.score - a.score || a.top - b.top)
  const title = candidates.find((item) => !isLowValueTitleText(item.text))?.text || candidates[0]?.text
  return title?.slice(0, 80) || `第 ${pageNumber} 页`
}

const buildTextBlock = async (args: {
  element: Record<string, unknown>
  blockId: string
  role?: string
  imagesDir: string
  registry: ImageRegistry
  scaleX: number
  scaleY: number
  textScale: number
  zIndex: number
  offsetX: number
  offsetY: number
}): Promise<string> => {
  const fillCss = await fillToCss(args.element.fill as Fill | undefined, args.imagesDir, args.registry)
  const css = buildBlockStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    extra: [...fillCss, ...borderCss(args.element, args.textScale), 'padding:0.1px']
  })
  const roleAttr = args.role ? ` data-role="${escapeHtml(args.role)}"` : ''
  const content = sanitizeContentHtml(String(args.element.content || ''), args.textScale)
  return `<section data-block-id="${escapeHtml(args.blockId)}"${roleAttr} style="${css}">${content || '&nbsp;'}</section>`
}

const buildImageBlock = async (args: {
  element: Record<string, unknown>
  blockId: string
  imagesDir: string
  registry: ImageRegistry
  scaleX: number
  scaleY: number
  zIndex: number
  offsetX: number
  offsetY: number
}): Promise<string> => {
  const source = await writeImageDataUrl(
    args.imagesDir,
    args.registry,
    String(args.element.ref || args.element.base64 || args.blockId),
    String(args.element.base64 || '')
  )
  const css = buildBlockStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    overflow: 'hidden',
    extra: [...borderCss(args.element, Math.min(args.scaleX, args.scaleY)), 'display:flex']
  })
  if (!source) {
    return `<section data-block-id="${escapeHtml(args.blockId)}" style="${css};align-items:center;justify-content:center;background:#f3f4f6;color:#6b7280;font-size:18px;">图片未能导入</section>`
  }
  return `<figure data-block-id="${escapeHtml(args.blockId)}" style="${css}"><img src="${source}" alt="" style="width:100%;height:100%;object-fit:contain;display:block;" /></figure>`
}

const buildShapeBlock = async (args: {
  element: Record<string, unknown>
  blockId: string
  role?: string
  imagesDir: string
  registry: ImageRegistry
  scaleX: number
  scaleY: number
  textScale: number
  zIndex: number
  offsetX: number
  offsetY: number
}): Promise<string> => {
  if (typeof args.element.content === 'string' && stripHtml(args.element.content).length > 0) {
    return buildTextBlock(args)
  }
  const fillCss = await fillToCss(args.element.fill as Fill | undefined, args.imagesDir, args.registry)
  const css = buildBlockStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    overflow: 'hidden',
    extra: [...fillCss, ...borderCss(args.element, args.textScale)]
  })
  return `<div data-block-id="${escapeHtml(args.blockId)}" style="${css}"></div>`
}

const buildTableBlock = (args: {
  element: Record<string, unknown>
  blockId: string
  scaleX: number
  scaleY: number
  textScale: number
  zIndex: number
  offsetX: number
  offsetY: number
}): string => {
  const rows = Array.isArray(args.element.data) ? (args.element.data as Array<Array<Record<string, unknown>>>) : []
  const tableRows = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const styles = [
            'border:1px solid #d1d5db',
            'padding:6px 8px',
            cell.fillColor ? `background:${cell.fillColor}` : '',
            cell.fontColor ? `color:${cell.fontColor}` : '',
            cell.fontBold ? 'font-weight:700' : ''
          ]
            .filter(Boolean)
            .join(';')
          const colspan = cell.colSpan ? ` colspan="${Number(cell.colSpan)}"` : ''
          const rowspan = cell.rowSpan ? ` rowspan="${Number(cell.rowSpan)}"` : ''
          const content = sanitizeContentHtml(String(cell.text || ''), args.textScale)
          return `<td${colspan}${rowspan} style="${styles}">${content}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  const css = buildBlockStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    extra: ['background:#fff']
  })
  return `<section data-block-id="${escapeHtml(args.blockId)}" style="${css}"><table style="width:100%;height:100%;border-collapse:collapse;font-size:${Math.max(12, 12 * args.textScale).toFixed(1)}px;">${tableRows}</table></section>`
}

const mapChartType = (chartType: string, barDir?: string): { type: string; indexAxis?: 'x' | 'y' } | null => {
  if (/pie/i.test(chartType)) return { type: 'pie' }
  if (/doughnut/i.test(chartType)) return { type: 'doughnut' }
  if (/line/i.test(chartType)) return { type: 'line' }
  if (/bar/i.test(chartType)) {
    // pptxtojson uses barDir="bar" for horizontal bars and "col" for vertical columns.
    return { type: 'bar', indexAxis: barDir === 'bar' ? 'y' : 'x' }
  }
  return null
}

const buildChartBlock = (args: {
  element: Chart
  blockId: string
  pageId: string
  chartIndex: number
  scaleX: number
  scaleY: number
  zIndex: number
  offsetX: number
  offsetY: number
}): string => {
  const chartType = mapChartType(args.element.chartType, 'barDir' in args.element ? args.element.barDir : undefined)
  const canvasId = `chart-${args.pageId}-${args.chartIndex}`
  const css = buildBlockStyle({
    element: args.element as unknown as Record<string, unknown>,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    extra: ['background:#fff', 'padding:10px']
  })
  if (!chartType || !('data' in args.element) || !Array.isArray(args.element.data)) {
    return `<section data-block-id="${escapeHtml(args.blockId)}" style="${css};display:flex;align-items:center;justify-content:center;color:#6b7280;">图表已作为占位导入</section>`
  }
  const series = args.element.data as ChartSeries[]
  const labels = series[0]?.values?.map((item) => item.x || '') || []
  const datasets = series.map((item, index) => ({
    label: item.key || `Series ${index + 1}`,
    data: (item.values || []).map((value) => value.y || 0),
    borderColor: args.element.colors?.[index] || undefined,
    backgroundColor: args.element.colors?.[index] || undefined
  }))
  const config = {
    type: chartType.type,
    data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: chartType.indexAxis || 'x' }
  }
  return `<section data-block-id="${escapeHtml(args.blockId)}" style="${css}">
  <canvas id="${canvasId}" style="width:100%;height:100%;"></canvas>
</section>
<script>
window.addEventListener("DOMContentLoaded", function () {
  var el = document.getElementById("${canvasId}");
  if (!el || !window.PPT || !window.PPT.createChart) return;
  window.PPT.createChart(el, ${JSON.stringify(config).replace(/</g, '\\u003c')});
});
</script>`
}

const renderElement = async (args: {
  element: Element
  pageId: string
  blockCounters: Record<string, number>
  imagesDir: string
  registry: ImageRegistry
  scaleX: number
  scaleY: number
  textScale: number
  zIndex: number
  offsetX: number
  offsetY: number
  titleAssigned: boolean
}): Promise<{ html: string; titleAssigned: boolean }> => {
  const nextBlockId = (prefix: string): string => {
    args.blockCounters[prefix] = (args.blockCounters[prefix] || 0) + 1
    return `${prefix}-${args.blockCounters[prefix]}`
  }
  const record = args.element as unknown as Record<string, unknown>
  if (args.element.type === 'group') {
    const children = Array.isArray(args.element.elements)
      ? [...args.element.elements].sort(
          (a, b) =>
            clampNumber((a as unknown as Record<string, unknown>).order) -
            clampNumber((b as unknown as Record<string, unknown>).order)
        )
      : []
    const rendered: string[] = []
    let titleAssigned = args.titleAssigned
    const groupOffsetX = args.offsetX + clampNumber(record.left)
    const groupOffsetY = args.offsetY + clampNumber(record.top)
    for (const child of children) {
      const result = await renderElement({
        ...args,
        element: child,
        offsetX: groupOffsetX,
        offsetY: groupOffsetY,
        titleAssigned
      })
      rendered.push(result.html)
      titleAssigned = result.titleAssigned
    }
    return { html: rendered.join('\n'), titleAssigned }
  }
  if (args.element.type === 'image') {
    return {
      html: await buildImageBlock({
        element: record,
        blockId: nextBlockId('image'),
        imagesDir: args.imagesDir,
        registry: args.registry,
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex
      }),
      titleAssigned: args.titleAssigned
    }
  }
  if (args.element.type === 'table') {
    return {
      html: buildTableBlock({
        element: record,
        blockId: nextBlockId('table'),
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        textScale: args.textScale,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex
      }),
      titleAssigned: args.titleAssigned
    }
  }
  if (args.element.type === 'chart') {
    const chartIndex = (args.blockCounters.chart || 0) + 1
    args.blockCounters.chart = chartIndex
    return {
      html: buildChartBlock({
        element: args.element,
        blockId: `chart-${chartIndex}`,
        pageId: args.pageId,
        chartIndex,
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex
      }),
      titleAssigned: args.titleAssigned
    }
  }
  if (args.element.type === 'text') {
    const text = stripHtml(String(record.content || ''))
    const shouldBeTitle = !args.titleAssigned && text.length > 0 && clampNumber(record.top) < 120
    return {
      html: await buildTextBlock({
        element: record,
        blockId: shouldBeTitle ? 'title' : nextBlockId('text'),
        role: shouldBeTitle ? 'title' : undefined,
        imagesDir: args.imagesDir,
        registry: args.registry,
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        textScale: args.textScale,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex
      }),
      titleAssigned: args.titleAssigned || shouldBeTitle
    }
  }
  if (args.element.type === 'shape') {
    const text = stripHtml(String(record.content || ''))
    const shouldBeTitle = !args.titleAssigned && text.length > 0 && clampNumber(record.top) < 120
    return {
      html: await buildShapeBlock({
        element: record,
        blockId: shouldBeTitle ? 'title' : nextBlockId(text ? 'text' : 'shape'),
        role: shouldBeTitle ? 'title' : undefined,
        imagesDir: args.imagesDir,
        registry: args.registry,
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        textScale: args.textScale,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex
      }),
      titleAssigned: args.titleAssigned || shouldBeTitle
    }
  }
  if (args.element.type === 'diagram' && Array.isArray(args.element.elements)) {
    const text = args.element.textList?.join(' / ') || 'SmartArt'
    const css = buildBlockStyle({
      element: record,
      scaleX: args.scaleX,
      scaleY: args.scaleY,
      zIndex: args.zIndex,
      offsetX: args.offsetX,
      offsetY: args.offsetY,
      extra: ['background:#f8fafc', 'border:1px dashed #cbd5e1', 'padding:12px', 'color:#475569']
    })
    return {
      html: `<section data-block-id="${nextBlockId('diagram')}" style="${css}">${escapeHtml(text)}</section>`,
      titleAssigned: args.titleAssigned
    }
  }
  return { html: '', titleAssigned: args.titleAssigned }
}

const buildFallbackTitle = (title: string): string =>
  `<header data-block-id="title" data-role="title" style="position:absolute;left:48px;top:36px;width:900px;height:56px;z-index:1;overflow:hidden;">
    <h1 style="margin:0;font-size:36px;line-height:1.2;color:#111827;">${escapeHtml(title)}</h1>
  </header>`

const buildSlideHtml = async (args: {
  slide: Slide
  pageNumber: number
  pageId: string
  title: string
  size: { width: number; height: number }
  projectDir: string
  registry: ImageRegistry
}): Promise<{ html: string; contentOutline: string; warnings: ImportWarning[] }> => {
  const imagesDir = path.join(args.projectDir, 'images')
  const scaleX = PAGE_WIDTH / Math.max(1, args.size.width)
  const scaleY = PAGE_HEIGHT / Math.max(1, args.size.height)
  const textScale = Math.min(scaleX, scaleY)
  const warnings: ImportWarning[] = []
  const backgroundCss = await fillToCss(args.slide.fill, imagesDir, args.registry)
  const blockCounters: Record<string, number> = {}
  const elements = [...(args.slide.layoutElements || []), ...(args.slide.elements || [])].sort(
    (a, b) => clampNumber((a as unknown as Record<string, unknown>).order) - clampNumber((b as unknown as Record<string, unknown>).order)
  )
  const rendered: string[] = []
  let titleAssigned = false
  for (const [index, element] of elements.entries()) {
    try {
      const result = await renderElement({
        element,
        pageId: args.pageId,
        blockCounters,
        imagesDir,
        registry: args.registry,
        scaleX,
        scaleY,
        textScale,
        zIndex: index + 2,
        offsetX: 0,
        offsetY: 0,
        titleAssigned
      })
      if (result.html) rendered.push(result.html)
      titleAssigned = result.titleAssigned
    } catch (error) {
      warnings.push({
        pageNumber: args.pageNumber,
        message: `元素 ${index + 1} 导入失败：${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  if (!titleAssigned) {
    rendered.unshift(buildFallbackTitle(args.title))
  }
  const contentOutline = flattenElements(elements)
    .map(({ element, text }) => {
      if (text && !isLowValueTitleText(text)) return text
      if (element.type === 'table') return '表格'
      if (element.type === 'chart') return '图表'
      if (element.type === 'image') return '图片'
      return ''
    })
    .filter(Boolean)
    .slice(0, 8)
    .join('；')
  const sectionStyle = ['position:relative', 'width:100%', 'height:100%', 'overflow:hidden', ...backgroundCss].join(';')
  const body = `<section data-page-scaffold="1" style="${sectionStyle}">
  <main data-block-id="content" data-role="content" style="position:absolute;inset:0;z-index:0;">
    ${rendered.join('\n')}
  </main>
</section>`
  const scaffold = buildPageScaffoldHtml({
    pageNumber: args.pageNumber,
    pageId: args.pageId,
    title: args.title
  })
  const $ = cheerio.load(scaffold, { scriptingEnabled: false })
  $('.ppt-page-root').first().removeClass('p-8').attr('style', 'padding:0;')
  $('.ppt-page-content').first().html(body)
  const html = $.html()
  const validation = validatePersistedPageHtml(html, args.pageId)
  if (!validation.valid) {
    warnings.push(
      ...validation.errors.map((message) => ({
        pageNumber: args.pageNumber,
        message
      }))
    )
  }
  return {
    html,
    contentOutline: contentOutline || args.title,
    warnings
  }
}

export async function importPptxToEditableHtml(args: {
  filePath: string
  projectDir: string
  title?: string
  onProgress?: ImportProgress
}): Promise<ImportedPptxDeck> {
  const fileName = path.basename(args.filePath)
  const title = (args.title || path.basename(fileName, path.extname(fileName)) || '导入的 PPTX').trim()
  const indexPath = path.join(args.projectDir, 'index.html')
  const imagesDir = path.join(args.projectDir, 'images')
  await fs.promises.mkdir(imagesDir, { recursive: true })
  args.onProgress?.({ stage: 'reading', progress: 5, label: '正在读取 PPTX 文件' })
  const buffer = await fs.promises.readFile(args.filePath)
  const arrayBuffer =
    buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
      ? (buffer.buffer as ArrayBuffer)
      : (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
  args.onProgress?.({ stage: 'parsing', progress: 14, label: '正在解析 PPTX 结构' })
  const parsed = await parse(arrayBuffer, {
    imageMode: 'base64',
    videoMode: 'none',
    audioMode: 'none'
  })
  const slides = parsed.slides || []
  if (slides.length === 0) {
    throw new Error('PPTX 中没有可导入的幻灯片')
  }
  args.onProgress?.({
    stage: 'media',
    progress: 24,
    label: '正在整理图片和页面元素',
    totalPages: slides.length
  })
  const registry: ImageRegistry = { index: 0, byKey: new Map() }
  const pages: ImportedPptxPage[] = []
  const allWarnings: ImportWarning[] = []
  for (let i = 0; i < slides.length; i += 1) {
    const pageNumber = i + 1
    const pageId = `page-${pageNumber}`
    const pageTitle = titleFromSlide(slides[i], pageNumber)
    args.onProgress?.({
      stage: 'pages',
      progress: 25 + Math.round((pageNumber / slides.length) * 58),
      label: `正在导入第 ${pageNumber} / ${slides.length} 页`,
      pageNumber,
      totalPages: slides.length
    })
    const htmlPath = path.join(args.projectDir, `${pageId}.html`)
    const rendered = await buildSlideHtml({
      slide: slides[i],
      pageNumber,
      pageId,
      title: pageTitle,
      size: parsed.size,
      projectDir: args.projectDir,
      registry
    })
    await fs.promises.writeFile(htmlPath, rendered.html, 'utf-8')
    pages.push({
      pageNumber,
      pageId,
      title: pageTitle,
      htmlPath,
      html: rendered.html,
      contentOutline: rendered.contentOutline
    })
    allWarnings.push(...rendered.warnings)
  }
  args.onProgress?.({ stage: 'index', progress: 90, label: '正在生成演示总览' })
  await fs.promises.writeFile(
    indexPath,
    buildProjectIndexHtml(
      title,
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
  return {
    title: title.slice(0, 120) || '导入的 PPTX',
    pageCount: pages.length,
    indexPath,
    pages,
    warnings: allWarnings.map((warning) =>
      warning.pageNumber ? `第 ${warning.pageNumber} 页：${warning.message}` : warning.message
    )
  }
}
