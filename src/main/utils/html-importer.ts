import fs from 'fs'
import path from 'path'
import * as cheerio from 'cheerio'
import { pathToFileURL } from 'url'
import { buildProjectIndexHtml, type DeckPageFile } from '../ipc/engine/template'
import { BASE_PAGE_STYLE_TAG, FIT_SCRIPT } from '../tools'
import { escapeHtml } from '../ipc/utils'

const MAX_IMPORTED_PAGES = 80
const TARGET_PAGE_WIDTH = 1600
const TARGET_PAGE_HEIGHT = 900

export type HtmlImportProgressPayload = {
  sessionId?: string
  stage: 'reading' | 'parsing' | 'pages' | 'index' | 'database' | 'completed'
  progress: number
  label: string
  pageNumber?: number
  totalPages?: number
}

type HtmlImportProgress = (payload: HtmlImportProgressPayload) => void

export type ImportedHtmlPage = {
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
  html: string
  contentOutline: string
}

export type ImportedHtmlDeck = {
  title: string
  pageCount: number
  indexPath: string
  pages: ImportedHtmlPage[]
  warnings: string[]
}

const normalizeText = (value: string): string =>
  value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

const stripHtml = (html: string): string => {
  if (!html) return ''
  const $ = cheerio.load(html, { scriptingEnabled: false })
  return normalizeText($.root().text())
}

const makePageId = (pageNumber: number): string => `page-${String(pageNumber).padStart(2, '0')}`

const extractTitle = ($: cheerio.CheerioAPI, html: string, pageNumber: number): string => {
  const fragment = cheerio.load(html, { scriptingEnabled: false }, false)
  const heading = normalizeText(fragment('h1,h2,h3,[data-title],title').first().text())
  if (heading) return heading.slice(0, 80)
  const docTitle = normalizeText($('title').first().text())
  if (docTitle) return pageNumber === 1 ? docTitle.slice(0, 80) : `${docTitle} ${pageNumber}`
  return `HTML 第 ${pageNumber} 页`
}

const serializeHeadChildren = ($: cheerio.CheerioAPI): string =>
  $('head')
    .children()
    .toArray()
    .map((node) => $.html(node))
    .filter(Boolean)
    .join('\n')

const readCssPixelValue = (css: string, selector: string, property: string): number | null => {
  const selectorPattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const propertyPattern = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockPattern = new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, 'i')
  const block = css.match(blockPattern)?.[1]
  if (!block) return null
  const valueMatch = block.match(new RegExp(`${propertyPattern}\\s*:\\s*([0-9.]+)px`, 'i'))
  const value = valueMatch ? Number(valueMatch[1]) : NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

const detectSourceCanvasSize = ($: cheerio.CheerioAPI): { width: number; height: number } => {
  const css = $('style')
    .toArray()
    .map((node) => $(node).html() || '')
    .join('\n')
  const width =
    readCssPixelValue(css, '#deck', 'width') ||
    readCssPixelValue(css, '#stage', 'width') ||
    readCssPixelValue(css, 'main#stage', 'width') ||
    readCssPixelValue(css, '.stage', 'width') ||
    readCssPixelValue(css, '.slide', 'width') ||
    TARGET_PAGE_WIDTH
  const height =
    readCssPixelValue(css, '#deck', 'height') ||
    readCssPixelValue(css, '#stage', 'height') ||
    readCssPixelValue(css, 'main#stage', 'height') ||
    readCssPixelValue(css, '.stage', 'height') ||
    readCssPixelValue(css, '.slide', 'height') ||
    TARGET_PAGE_HEIGHT
  return { width, height }
}

const resolveSlideCandidates = ($: cheerio.CheerioAPI): string[] => {
  const selectors = [
    '#deck > .slide',
    '#deck > section',
    '#viewport .slide',
    'main > .slide',
    'main > section.slide',
    '.slides > section',
    '.slides > .slide',
    'body > [data-slide]',
    'body > [data-page]',
    'body > .slide',
    'body > .page',
    'body > section',
    'body > article'
  ]

  for (const selector of selectors) {
    const nodes = $(selector).toArray()
    if (nodes.length > 1) {
      return nodes.slice(0, MAX_IMPORTED_PAGES).map((node) => $.html(node) || '')
    }
  }

  const bodyHtml = $('body').html()
  return [bodyHtml && bodyHtml.trim().length > 0 ? bodyHtml : $.root().html() || '']
}

const normalizeImportedSlideHtml = (html: string): string => {
  const $ = cheerio.load(html, { scriptingEnabled: false }, false)
  const root = $.root().children().first()
  if (root.length === 0) return html
  if (root.hasClass('slide') || root.attr('data-slide') !== undefined || root.attr('data-page') !== undefined) {
    root.addClass('active')
    root.attr('aria-hidden', 'false')
  }
  return $.root().html() || html
}

const hasPptRuntimeShell = (html: string): boolean =>
  /\bppt-page-root\b/i.test(html) && /\bppt-page-content\b/i.test(html)

const buildImportedPageHtml = (args: {
  title: string
  pageId: string
  headHtml: string
  bodyHtml: string
  sourceDir: string
  sourceCanvas: { width: number; height: number }
}): string => {
  const safeTitle = escapeHtml(args.title)
  const baseHref = pathToFileURL(`${path.resolve(args.sourceDir)}${path.sep}`).toString()
  const normalizedBodyHtml = normalizeImportedSlideHtml(args.bodyHtml)
  const scale = Math.min(
    TARGET_PAGE_WIDTH / Math.max(1, args.sourceCanvas.width),
    TARGET_PAGE_HEIGHT / Math.max(1, args.sourceCanvas.height)
  )
  const offsetX = (TARGET_PAGE_WIDTH - args.sourceCanvas.width * scale) / 2
  const offsetY = (TARGET_PAGE_HEIGHT - args.sourceCanvas.height * scale) / 2
  const bodyContent = hasPptRuntimeShell(normalizedBodyHtml)
    ? normalizedBodyHtml
    : `<main class="ppt-page-root p-2" data-ppt-guard-root="1">
      <div class="ppt-page-fit-scope">
        <div class="ppt-page-content">
          <section class="html-import-slide" data-page-scaffold="1" data-html-imported="1">
            <div class="html-import-scale-wrap">
              ${normalizedBodyHtml}
            </div>
          </section>
        </div>
      </div>
    </main>`

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base href="${baseHref}" />
    <title>${safeTitle}</title>
    ${args.headHtml}
    ${BASE_PAGE_STYLE_TAG}
    <style id="html-import-style">
      .ppt-page-root[data-ppt-guard-root="1"] {
        padding: 0 !important;
      }
      .html-import-slide {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .html-import-scale-wrap {
        position: absolute;
        left: ${offsetX.toFixed(4)}px;
        top: ${offsetY.toFixed(4)}px;
        width: ${args.sourceCanvas.width.toFixed(4)}px;
        height: ${args.sourceCanvas.height.toFixed(4)}px;
        transform: scale(${scale.toFixed(8)});
        transform-origin: top left;
        overflow: hidden;
      }
      .html-import-scale-wrap > .slide,
      .html-import-scale-wrap > [data-slide],
      .html-import-scale-wrap > [data-page] {
        position: absolute !important;
        inset: 0 !important;
        width: ${args.sourceCanvas.width.toFixed(4)}px !important;
        height: ${args.sourceCanvas.height.toFixed(4)}px !important;
      }
      .html-import-slide > :first-child {
        margin-top: 0;
      }
      .html-import-slide > :last-child {
        margin-bottom: 0;
      }
    </style>
  </head>
  <body data-page-id="${args.pageId}">
    ${bodyContent}
    ${FIT_SCRIPT}
  </body>
</html>`
}

export const importHtmlToEditableDeck = async (args: {
  filePath: string
  projectDir: string
  title: string
  onProgress?: HtmlImportProgress
}): Promise<ImportedHtmlDeck> => {
  args.onProgress?.({ stage: 'reading', progress: 5, label: '正在读取 HTML 文件' })
  const html = await fs.promises.readFile(args.filePath, 'utf-8')
  const sourceDir = path.dirname(args.filePath)

  args.onProgress?.({ stage: 'parsing', progress: 20, label: '正在解析 HTML 页面' })
  const $ = cheerio.load(html, { scriptingEnabled: false })
  const headHtml = serializeHeadChildren($)
  const sourceCanvas = detectSourceCanvasSize($)
  const slideHtmlList = resolveSlideCandidates($).filter((item) => item.trim().length > 0)
  if (slideHtmlList.length === 0) {
    throw new Error('HTML 文件中没有可导入的页面内容')
  }

  const deckTitle = args.title || normalizeText($('title').first().text()) || '导入的 HTML'
  const pages: ImportedHtmlPage[] = []
  const warnings: string[] = []

  for (const [index, bodyHtml] of slideHtmlList.entries()) {
    const pageNumber = index + 1
    const pageId = makePageId(pageNumber)
    const title = extractTitle($, bodyHtml, pageNumber)
    const htmlPath = path.join(args.projectDir, `${pageId}.html`)
    const pageHtml = buildImportedPageHtml({
      title,
      pageId,
      headHtml,
      bodyHtml,
      sourceDir,
      sourceCanvas
    })

    await fs.promises.writeFile(htmlPath, pageHtml, 'utf-8')
    pages.push({
      pageNumber,
      pageId,
      title,
      htmlPath,
      html: pageHtml,
      contentOutline: stripHtml(bodyHtml).slice(0, 500)
    })
    args.onProgress?.({
      stage: 'pages',
      progress: Math.min(88, 24 + Math.round((pageNumber / slideHtmlList.length) * 56)),
      label: `正在写入第 ${pageNumber} 页`,
      pageNumber,
      totalPages: slideHtmlList.length
    })
  }

  if (slideHtmlList.length >= MAX_IMPORTED_PAGES) {
    warnings.push(`HTML 页面数量超过 ${MAX_IMPORTED_PAGES}，仅导入前 ${MAX_IMPORTED_PAGES} 页。`)
  }

  args.onProgress?.({ stage: 'index', progress: 90, label: '正在生成预览目录', totalPages: pages.length })
  const indexPath = path.join(args.projectDir, 'index.html')
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

  return {
    title: deckTitle,
    pageCount: pages.length,
    indexPath,
    pages,
    warnings
  }
}
