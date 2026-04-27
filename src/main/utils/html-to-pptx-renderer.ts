import { BrowserWindow } from 'electron'
import log from 'electron-log/main.js'
import { pathToFileURL } from 'url'
import {
  buildHtmlToPptxExtractScript,
  normalizeExtractedHtmlToPptxSlide,
  type HtmlToPptxSlide
} from './html-to-pptx'
import {
  FREEZE_PAGE_FOR_PPTX_SCRIPT,
  HIDE_TEXT_FOR_PPTX_BACKGROUND_SCRIPT
} from './html-to-pptx-browser-scripts'

export interface HtmlPageForPptx {
  htmlPath: string
  pageId: string
  title?: string
}

export interface HtmlPageToPptxSlideOptions {
  page: HtmlPageForPptx
  timeoutMs: number
  settleMs: number
  waitForPrintReadySignal: (args: {
    win: BrowserWindow
    pageId: string
    timeoutMs: number
  }) => Promise<{ timedOut: boolean }>
}

export interface HtmlPageToPptxSlideResult {
  slide: HtmlToPptxSlide
  warning?: string
}

const PPTX_CAPTURE_WIDTH = 1600
const PPTX_CAPTURE_HEIGHT = 900
const PPTX_SLIDE_WIDTH_IN = 13.333
const PPTX_SLIDE_HEIGHT_IN = 7.5

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const extractHtmlPageToPptxSlide = async ({
  page,
  timeoutMs,
  settleMs,
  waitForPrintReadySignal
}: HtmlPageToPptxSlideOptions): Promise<HtmlPageToPptxSlideResult> => {
  const win = new BrowserWindow({
    show: false,
    width: PPTX_CAPTURE_WIDTH,
    height: PPTX_CAPTURE_HEIGHT,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: false
    }
  })

  try {
    win.webContents.setZoomFactor(1)
    win.setContentSize(PPTX_CAPTURE_WIDTH, PPTX_CAPTURE_HEIGHT)

    const pageUrl = new URL(pathToFileURL(page.htmlPath).toString())
    pageUrl.searchParams.set('fit', 'off')
    pageUrl.searchParams.set('print', '1')
    pageUrl.searchParams.set('export', '1')
    pageUrl.searchParams.set('pageId', page.pageId)
    pageUrl.searchParams.set('printTimeoutMs', String(timeoutMs))
    pageUrl.searchParams.set('_ts', String(Date.now()))

    const readyWaitPromise = waitForPrintReadySignal({
      win,
      pageId: page.pageId,
      timeoutMs
    })

    await win.loadURL(pageUrl.toString())
    await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_PPTX_SCRIPT, true)
    const readyResult = await readyWaitPromise
    if (readyResult.timedOut) {
      log.warn('[export:pptx] print ready timeout', {
        pageId: page.pageId,
        htmlPath: page.htmlPath,
        timeoutMs
      })
    }

    await sleep(settleMs)
    await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_PPTX_SCRIPT, true)
    await sleep(450)
    await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_PPTX_SCRIPT, true)
    await sleep(80)

    const extracted = await win.webContents.executeJavaScript(
      buildHtmlToPptxExtractScript({
        pageWidthPx: PPTX_CAPTURE_WIDTH,
        pageHeightPx: PPTX_CAPTURE_HEIGHT,
        maxShapes: 0,
        maxImages: 0
      }),
      true
    )

    await win.webContents.executeJavaScript(HIDE_TEXT_FOR_PPTX_BACKGROUND_SCRIPT, true)
    await sleep(50)

    const backgroundImage = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: PPTX_CAPTURE_WIDTH,
      height: PPTX_CAPTURE_HEIGHT
    })
    const backgroundPng = backgroundImage.toPNG()
    const slide = normalizeExtractedHtmlToPptxSlide(extracted, page.title)
    slide.backgroundImage = {
      dataUri: `data:image/png;base64,${backgroundPng.toString('base64')}`,
      mimeType: 'image/png',
      x: 0,
      y: 0,
      w: PPTX_SLIDE_WIDTH_IN,
      h: PPTX_SLIDE_HEIGHT_IN,
      alt: page.title
    }
    slide.shapes = []
    slide.images = []

    return {
      slide,
      warning: readyResult.timedOut
        ? `页面 ${page.pageId} 未收到打印就绪信号，已按当前状态导出`
        : undefined
    }
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}
