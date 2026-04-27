import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import {
  buildInspectorCleanupScript,
  buildInspectorInjectScript,
  INSPECTOR_CONSOLE_PREFIX
} from './inspector-script'

export interface PreviewIframeHandle {
  patchPageContent: (pageId: string, newHtml: string) => void
}

export const PreviewIframe = forwardRef<
  PreviewIframeHandle,
  {
    html?: string
    src?: string
    title: string
    htmlPath?: string
    pageId?: string
    inspecting?: boolean
    inspectable?: boolean
    onSelectorSelected?: (
      selector: string,
      label: string,
      elementTag?: string,
      elementText?: string
    ) => void
    onInspectExit?: () => void
  }
>(function PreviewIframe(
  {
    src,
    title,
    htmlPath,
    pageId,
    inspecting = false,
    inspectable = false,
    onSelectorSelected,
    onInspectExit
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const [webviewElement, setWebviewElement] = useState<Electron.WebviewTag | null>(null)
  const [transform, setTransform] = useState('scale(1)')

  const resolvePageHtmlPath = (inputPath?: string, currentPageId?: string): string | undefined => {
    if (!inputPath) return undefined
    const isIndex = /[\\/]index\.html?$/i.test(inputPath)
    if (!isIndex) return inputPath
    if (!currentPageId) return undefined
    return inputPath.replace(/index\.html?$/i, `${currentPageId}.html`)
  }

  const encodePathSegments = (filePath: string): string =>
    filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')

  const toFileUrl = (absolutePath: string): string => {
    const normalizedPath = absolutePath.replace(/\\/g, '/')
    const fileUrl = /^[a-zA-Z]:\//.test(normalizedPath)
      ? `file:///${normalizedPath.slice(0, 2)}${encodePathSegments(normalizedPath.slice(2))}`
      : normalizedPath.startsWith('/')
        ? `file://${encodePathSegments(normalizedPath)}`
        : `file:///${encodePathSegments(normalizedPath)}`
    const url = new URL(fileUrl)
    // PreviewIframe already does 1600x900 viewport scaling.
    // Disable page-level auto-fit to avoid double-scaling on specific pages.
    url.searchParams.set('fit', 'off')
    return url.toString()
  }

  const withPreviewParams = (inputUrl: string): string => {
    const url = new URL(inputUrl)
    // PreviewIframe already does 1600x900 viewport scaling.
    // Disable page-level auto-fit to avoid double-scaling on specific pages.
    url.searchParams.set('fit', 'off')
    return url.toString()
  }

  // Always preview concrete page file (page-xx.html). index.html is only for external full-deck preview.
  const pageHtmlPath = resolvePageHtmlPath(htmlPath, pageId)
  const webviewSrc = pageHtmlPath
    ? toFileUrl(pageHtmlPath)
    : src
      ? withPreviewParams(src)
      : undefined
  const pointerEnabled = inspectable && inspecting

  const handleWebviewRef = useCallback((node: Electron.WebviewTag | null): void => {
    webviewRef.current = node
    setWebviewElement((prev) => (prev === node ? prev : node))
  }, [])

  const safeExecuteJavaScript = (webview: Electron.WebviewTag, script: string): void => {
    try {
      webview.executeJavaScript(script).catch(() => {})
    } catch {
      // executeJavaScript may throw synchronously before dom-ready
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      patchPageContent(targetPageId: string, newHtml: string): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `
        var section = document.querySelector('[data-page-id="${targetPageId}"]');
        if (section) {
          section.innerHTML = ${JSON.stringify(newHtml)};
        } else {
          document.body.innerHTML = ${JSON.stringify(newHtml)};
        }
      `
        )
      }
    }),
    []
  )

  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable) return

    const runInspectorLifecycle = (): void => {
      const script = inspecting ? buildInspectorInjectScript() : buildInspectorCleanupScript()
      safeExecuteJavaScript(webview, script)
    }

    runInspectorLifecycle()
    const handleDomReady = (): void => runInspectorLifecycle()
    webview.addEventListener('dom-ready', handleDomReady as EventListener)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady as EventListener)
      safeExecuteJavaScript(webview, buildInspectorCleanupScript())
    }
  }, [inspectable, inspecting, webviewSrc, webviewElement])

  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable) return

    const handleConsoleMessage = (event: Event): void => {
      const payloadText = (event as { message?: unknown }).message
      if (typeof payloadText !== 'string' || !payloadText.startsWith(INSPECTOR_CONSOLE_PREFIX)) {
        return
      }
      const raw = payloadText.slice(INSPECTOR_CONSOLE_PREFIX.length).trim()
      if (!raw) return
      try {
        const parsed = JSON.parse(raw) as {
          type?: string
          selector?: string
          label?: string
          elementTag?: string
          elementText?: string
        }
        if (parsed.type === 'selected' && parsed.selector) {
          onSelectorSelected?.(
            parsed.selector,
            parsed.label || parsed.selector,
            parsed.elementTag,
            parsed.elementText
          )
          return
        }
        if (parsed.type === 'exit') {
          onInspectExit?.()
        }
      } catch {
        // ignore parse error
      }
    }

    webview.addEventListener('console-message', handleConsoleMessage as EventListener)
    return () => {
      webview.removeEventListener('console-message', handleConsoleMessage as EventListener)
    }
  }, [inspectable, onSelectorSelected, onInspectExit, webviewElement])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateScale = (): void => {
      const { width, height } = el.getBoundingClientRect()
      const nextScaleRaw = Math.min(width / 1600, height / 900)
      const nextScale = Number.isFinite(nextScaleRaw) && nextScaleRaw > 0 ? nextScaleRaw : 1
      const offsetX = Math.max(0, (width - 1600 * nextScale) / 2)
      const offsetY = Math.max(0, (height - 900 * nextScale) / 2)
      setTransform(`translate(${offsetX}px, ${offsetY}px) scale(${nextScale})`)
    }

    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-[inherit] bg-[#f5f1e8]"
    >
      {webviewSrc ? (
        <webview
          ref={handleWebviewRef}
          src={webviewSrc}
          title={title}
          className={`absolute left-0 top-0 h-[900px] w-[1600px] origin-top-left ${
            pointerEnabled ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          style={{ transform }}
        />
      ) : null}
    </div>
  )
})
