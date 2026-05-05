import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import {
  buildInspectorCleanupScript,
  buildInspectorInjectScript,
  INSPECTOR_CONSOLE_PREFIX
} from './inspector-script'
import {
  buildDragEditorCleanupScript,
  buildDragEditorInjectScript,
  DRAG_EDITOR_CONSOLE_PREFIX,
  type DragEditorMovePayload
} from './drag-editor-script'
import {
  buildTextEditorCleanupScript,
  buildTextEditorInjectScript,
  TEXT_EDITOR_CONSOLE_PREFIX
} from './text-editor-script'
import type { TextEditorSelectionPayload } from './text-editor-types'
import { ipc } from '@renderer/lib/ipc'

export interface PreviewIframeHandle {
  patchPageContent: (pageId: string, newHtml: string) => void
  liveUpdateTextElement: (selector: string, patch: { text?: string; style?: { color?: string; fontSize?: string; fontWeight?: string } }) => void
  clearTextEditorSelection: () => void
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
    dragEditing?: boolean
    textEditing?: boolean
    onSelectorSelected?: (
      selector: string,
      label: string,
      elementTag?: string,
      elementText?: string
    ) => void
    onElementMoved?: (payload: DragEditorMovePayload) => void
    onTextSelected?: (payload: TextEditorSelectionPayload) => void
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
    dragEditing = false,
    textEditing = false,
    onSelectorSelected,
    onElementMoved,
    onTextSelected,
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
  const pointerEnabled = inspectable && (inspecting || dragEditing || textEditing)

  const ensureAnchoredSelector = async (args: {
    selector: string
    elementTag?: string
    elementText?: string
    reason: 'inspect' | 'drag' | 'text-edit'
  }): Promise<string> => {
    if (!pageHtmlPath || !pageId) return args.selector
    if (/\[data-block-id=/.test(args.selector)) return args.selector
    try {
      const result = await ipc.ensureElementAnchor({
        htmlPath: pageHtmlPath,
        pageId,
        selector: args.selector,
        elementTag: args.elementTag,
        elementText: args.elementText,
        reason: args.reason
      })
      return result.selector || args.selector
    } catch {
      return args.selector
    }
  }

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
      },
      liveUpdateTextElement(selector: string, patch: { text?: string; style?: { color?: string; fontSize?: string; fontWeight?: string } }): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `if (window.__pptTextEditorLiveUpdate) window.__pptTextEditorLiveUpdate(${JSON.stringify(selector)}, ${JSON.stringify(patch)});`
        )
      },
      clearTextEditorSelection(): void {
        const wv = webviewRef.current
        if (!wv) return
        safeExecuteJavaScript(
          wv,
          `if (window.__pptTextEditorClearSelection) window.__pptTextEditorClearSelection();`
        )
      }
    }),
    []
  )

  // Inspector effect: handles AI inspect mode only.
  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable) return

    const runInspectorLifecycle = (): void => {
      if (inspecting) {
        safeExecuteJavaScript(webview, buildInspectorInjectScript())
      } else {
        safeExecuteJavaScript(webview, buildInspectorCleanupScript())
      }
    }

    runInspectorLifecycle()
    const handleDomReady = (): void => runInspectorLifecycle()
    webview.addEventListener('dom-ready', handleDomReady as EventListener)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady as EventListener)
      safeExecuteJavaScript(webview, buildInspectorCleanupScript())
    }
  }, [inspectable, inspecting, webviewSrc, webviewElement])

  // Text editor effect: handles double-click text editing in edit mode.
  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable) return

    const runTextEditorLifecycle = (): void => {
      if (textEditing) {
        safeExecuteJavaScript(webview, buildTextEditorInjectScript())
      } else {
        safeExecuteJavaScript(webview, buildTextEditorCleanupScript())
      }
    }

    runTextEditorLifecycle()
    const handleDomReady = (): void => runTextEditorLifecycle()
    webview.addEventListener('dom-ready', handleDomReady as EventListener)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady as EventListener)
      safeExecuteJavaScript(webview, buildTextEditorCleanupScript())
    }
  }, [inspectable, textEditing, webviewSrc, webviewElement])

  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable) return

    const runDragEditorLifecycle = (): void => {
      const script = dragEditing ? buildDragEditorInjectScript() : buildDragEditorCleanupScript()
      safeExecuteJavaScript(webview, script)
    }

    runDragEditorLifecycle()
    const handleDomReady = (): void => runDragEditorLifecycle()
    webview.addEventListener('dom-ready', handleDomReady as EventListener)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady as EventListener)
      safeExecuteJavaScript(webview, buildDragEditorCleanupScript())
    }
  }, [inspectable, dragEditing, webviewSrc, webviewElement])

  useEffect(() => {
    const webview = webviewElement
    if (!webview || !inspectable) return

    const handleConsoleMessage = (event: Event): void => {
      const payloadText = (event as { message?: unknown }).message
      if (typeof payloadText !== 'string') {
        return
      }
      const isInspectorMessage = payloadText.startsWith(INSPECTOR_CONSOLE_PREFIX)
      const isDragEditorMessage = payloadText.startsWith(DRAG_EDITOR_CONSOLE_PREFIX)
      const isTextEditorMessage = payloadText.startsWith(TEXT_EDITOR_CONSOLE_PREFIX)
      if (!isInspectorMessage && !isDragEditorMessage && !isTextEditorMessage) return

      const prefixLength = isInspectorMessage
        ? INSPECTOR_CONSOLE_PREFIX.length
        : isDragEditorMessage
          ? DRAG_EDITOR_CONSOLE_PREFIX.length
          : TEXT_EDITOR_CONSOLE_PREFIX.length
      const raw = payloadText.slice(prefixLength).trim()
      if (!raw) return
      try {
        const parsed = JSON.parse(raw) as {
          type?: string
          selector?: string
          label?: string
          elementTag?: string
          elementText?: string
          x?: number
          y?: number
          deltaX?: number
          deltaY?: number
          width?: number
          height?: number
          scale?: number
          childUpdates?: Array<{
            path: number[]
            width?: number
            height?: number
          }>
          oldText?: string
          newText?: string
          mode?: string
          text?: string
          style?: TextEditorSelectionPayload['style']
          bounds?: TextEditorSelectionPayload['bounds']
        }
        if ((isInspectorMessage || isTextEditorMessage) && parsed.type === 'selected' && parsed.selector) {
          void (async () => {
            const isTextMode = isTextEditorMessage || parsed.mode === 'text-edit'
            const anchoredSelector = await ensureAnchoredSelector({
              selector: parsed.selector || '',
              elementTag: parsed.elementTag,
              elementText: parsed.elementText,
              reason: isTextMode ? 'text-edit' : 'inspect'
            })
          if (isTextMode) {
            onTextSelected?.({
              selector: anchoredSelector,
              label: anchoredSelector,
              elementTag: parsed.elementTag || '',
              text:
                typeof parsed.text === 'string'
                  ? parsed.text
                  : typeof parsed.elementText === 'string'
                    ? parsed.elementText
                    : '',
              style: parsed.style || {},
              bounds: parsed.bounds
            })
            return
          }
          onSelectorSelected?.(
            anchoredSelector,
            anchoredSelector,
            parsed.elementTag,
            parsed.elementText
          )
          })().catch(() => {})
          return
        }
        if (isDragEditorMessage && parsed.type === 'pre-anchor' && parsed.selector) {
          void (async () => {
            let anchorResult: string = parsed.selector || ''
            try {
              anchorResult = await ensureAnchoredSelector({
                selector: parsed.selector || '',
                elementTag: parsed.elementTag,
                reason: 'drag'
              })
            } catch { /* fallback to temp selector */ }
            const wv = webviewRef.current
            if (wv) {
              safeExecuteJavaScript(
                wv,
                `if (window.__pptResolveDragAnchor) window.__pptResolveDragAnchor(${JSON.stringify({ selector: anchorResult })});`
              )
            }
          })().catch(() => {})
          return
        }
        if (isDragEditorMessage && parsed.type === 'moved' && parsed.selector) {
          void (async () => {
            const anchoredSelector = await ensureAnchoredSelector({
              selector: parsed.selector || '',
              elementTag: parsed.elementTag,
              reason: 'drag'
            })
            onElementMoved?.({
            selector: anchoredSelector,
            label: anchoredSelector,
            elementTag: parsed.elementTag || '',
            x: Number(parsed.x || 0),
            y: Number(parsed.y || 0),
            deltaX: Number(parsed.deltaX || 0),
            deltaY: Number(parsed.deltaY || 0),
            width: parsed.width === undefined ? undefined : Number(parsed.width),
            height: parsed.height === undefined ? undefined : Number(parsed.height),
            scale: parsed.scale === undefined ? undefined : Number(parsed.scale),
            childUpdates: Array.isArray(parsed.childUpdates)
              ? parsed.childUpdates
                  .map((item) => ({
                    path: Array.isArray(item.path)
                      ? item.path
                          .map((value) => Number(value))
                          .filter((value) => Number.isInteger(value) && value >= 0)
                      : [],
                    width: item.width === undefined ? undefined : Number(item.width),
                    height: item.height === undefined ? undefined : Number(item.height)
                  }))
                  .filter(
                    (item) =>
                      item.path.length > 0 &&
                      (item.width !== undefined || item.height !== undefined)
                  )
              : undefined
            })
          })().catch(() => {})
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
  }, [
    inspectable,
    onSelectorSelected,
    onElementMoved,
    onTextSelected,
    onInspectExit,
    pageHtmlPath,
    pageId,
    webviewElement
  ])

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
          } ${dragEditing ? 'cursor-move' : textEditing ? 'cursor-text' : inspecting ? 'cursor-crosshair' : ''}`}
          style={{ transform }}
        />
      ) : null}
    </div>
  )
})
