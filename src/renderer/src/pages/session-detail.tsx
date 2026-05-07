import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ipc } from '@renderer/lib/ipc'
import type { DragEditorMovePayload } from '../components/preview/drag-editor-script'
import type { TextEditorSelectionPayload } from '../components/preview/text-editor-types'
import type { PreviewIframeHandle } from '../components/preview/PreviewIframe'
import { TooltipProvider } from '../components/ui/Tooltip'
import { MessagePanel } from '../components/session-detail/MessagePanel'
import { PageSidebar } from '../components/session-detail/PageSidebar'
import { PreviewStage } from '../components/session-detail/PreviewStage'
import { SessionToolbar } from '../components/session-detail/SessionToolbar'
import type { ElementEditDraft } from '../components/session-detail/ElementInspectorPanel'
import type { ChatType, SessionPreviewPage } from '../components/session-detail/types'
import { useSessionStore, useGenerateStore } from '../store'
import { useSessionDetailUiStore } from '../store/sessionDetailStore'
import type { GenerateChunkEvent } from '@shared/generation.js'
import { useToastStore } from '../store'
import { getEditorGate } from '../lib/sessionMetadata'
import { useT } from '../i18n'

const EMPTY_ELEMENT_DRAFT: ElementEditDraft = {
  text: '',
  color: '#34402c',
  fontSize: '',
  fontWeight: '400'
}

function normalizePagesForSelection(
  pages: Array<{
    pageNumber: number
    title: string
    html: string
    htmlPath?: string
    pageId?: string
    sourceUrl?: string
    status?: string
    error?: string | null
  }>
): SessionPreviewPage[] {
  return [...pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) =>
      page.pageId ? (page as SessionPreviewPage) : { ...page, pageId: `page-${page.pageNumber}` }
    )
}

function rgbToHex(value: string | undefined): string {
  const text = String(value || '').trim()
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(text)) return text
  const match = text.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i)
  if (!match) return '#34402c'
  const toHex = (part: string): string =>
    Math.max(0, Math.min(255, Number(part) || 0))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`
}

function fontSizeToNumber(value: string | undefined): string {
  const parsed = Number(String(value || '').replace(/px$/i, ''))
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.round(parsed)) : ''
}

function normalizeFontWeight(value: string | undefined): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value === 'bold' ? '700' : '400'
  return String(Math.max(300, Math.min(800, Math.round(parsed / 100) * 100)))
}

export function SessionDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const t = useT()
  const isMac = window.electron?.process?.platform === 'darwin'
  const {
    currentSession,
    currentGeneratedPages,
    loadSession,
    loadMessages,
    setMessages,
    addMessage
  } = useSessionStore()
  const { isGenerating, updateProgress, cancelGeneration, progress, currentPages, error } =
    useGenerateStore()
  const chatType = useSessionDetailUiStore((state) => state.chatType)
  const selectedPageNumber = useSessionDetailUiStore((state) => state.selectedPageNumber)
  const interactionMode = useSessionDetailUiStore((state) => state.interactionMode)
  const setChatType = useSessionDetailUiStore((state) => state.setChatType)
  const resetForPageChange = useSessionDetailUiStore((state) => state.resetForPageChange)
  const resetForSessionChange = useSessionDetailUiStore((state) => state.resetForSessionChange)
  const addPageDialogOpen = useSessionDetailUiStore((state) => state.addPageDialogOpen)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const isRetryingSinglePage = useSessionDetailUiStore((state) => state.isRetryingSinglePage)
  const setAddPageDialogOpen = useSessionDetailUiStore((state) => state.setAddPageDialogOpen)
  const setIsAddingPage = useSessionDetailUiStore((state) => state.setIsAddingPage)
  const activeChatRef = useRef<{ chatType: ChatType; pageId?: string }>({ chatType: 'page' })
  const [pendingDragEdits, setPendingDragEdits] = useState<
    Array<DragEditorMovePayload & { pageId: string; htmlPath: string }>
  >([])
  const [pendingTextEdits, setPendingTextEdits] = useState<
    Array<{ pageId: string; htmlPath: string; selector: string; patch: { text: string; style: { color: string; fontSize: string; fontWeight: string } } }>
  >([])
  const [isSavingEdits, setIsSavingEdits] = useState(false)
  const [textSelection, setTextSelection] = useState<TextEditorSelectionPayload | null>(null)
  const [textDraft, setTextDraft] = useState<ElementEditDraft>(EMPTY_ELEMENT_DRAFT)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0)
  const previewIframeRef = useRef<PreviewIframeHandle | null>(null)
  const sendingMessageRef = useRef(false)
  const [addPageInput, setAddPageInput] = useState('')
  const {
    success: toastSuccess,
    error: toastError,
    info: toastInfo,
    warning: toastWarning
  } = useToastStore()

  const orderedPages = useMemo(
    () => [...currentPages].sort((a, b) => a.pageNumber - b.pageNumber),
    [currentPages]
  )

  const normalizedOrderedPages = useMemo(
    () => normalizePagesForSelection(orderedPages),
    [orderedPages]
  )

  const selectedPage = useMemo(
    () =>
      normalizedOrderedPages.find((page) => page.pageNumber === selectedPageNumber) ??
      normalizedOrderedPages[0] ??
      null,
    [normalizedOrderedPages, selectedPageNumber]
  )

  useEffect(() => {
    resetForPageChange()
    window.setTimeout(() => {
      setPendingDragEdits([])
      setPendingTextEdits([])
      setTextSelection(null)
      setTextDraft(EMPTY_ELEMENT_DRAFT)
    }, 0)
  }, [resetForPageChange, selectedPage?.pageId])

  const canEditInSessionDetail = useMemo(() => {
    if (!currentSession) return false
    return getEditorGate(currentSession).canEdit
  }, [currentSession])

  useEffect(() => {
    if (!id) return
    setMessages([])
    useGenerateStore.getState().setPages([])
    resetForSessionChange()
    void loadSession(id)
    // Cleanup on unmount (leaving session-detail)
    return () => {
      useGenerateStore.getState().reset()
      useSessionDetailUiStore.getState().resetForSessionChange()
    }
  }, [id, loadSession, resetForSessionChange, setMessages])

  useEffect(() => {
    useGenerateStore.getState().setPages(currentGeneratedPages)
  }, [currentGeneratedPages])

  useEffect(() => {
    if (!id || !currentSession) return
    // Don't redirect during addPage / retrySinglePage — we're already on the editor page
    if (useSessionDetailUiStore.getState().isAddingPage || useSessionDetailUiStore.getState().isRetryingSinglePage) return
    if (!canEditInSessionDetail) {
      navigate(`/sessions/${id}/generating`, { replace: true })
    }
  }, [canEditInSessionDetail, currentSession, id, navigate])

  useEffect(() => {
    if (!id) return
    const saved = window.localStorage.getItem(`workbench:selected-page:${id}`)
    if (!saved) return
    const parsed = Number(saved)
    if (Number.isFinite(parsed) && parsed > 0) {
      useSessionDetailUiStore.getState().setSelectedPageNumber(parsed)
    }
  }, [id])

  useEffect(() => {
    // Skip auto-select during addPage / retrySinglePage — selection managed explicitly
    if (useSessionDetailUiStore.getState().isAddingPage || useSessionDetailUiStore.getState().isRetryingSinglePage) return

    if (normalizedOrderedPages.length === 0) {
      useSessionDetailUiStore.getState().setSelectedPageNumber(null)
      return
    }

    if (
      selectedPageNumber &&
      normalizedOrderedPages.some((page) => page.pageNumber === selectedPageNumber)
    ) {
      return
    }

    useSessionDetailUiStore.getState().setSelectedPageNumber(normalizedOrderedPages[0].pageNumber)
  }, [normalizedOrderedPages, selectedPageNumber])

  useEffect(() => {
    if (!id || !selectedPageNumber) return
    window.localStorage.setItem(`workbench:selected-page:${id}`, String(selectedPageNumber))
  }, [id, selectedPageNumber])

  useEffect(() => {
    setChatType('page')
  }, [id, setChatType])

  useEffect(() => {
    const pageId = chatType === 'page' ? selectedPage?.pageId : undefined
    activeChatRef.current = { chatType, pageId }
  }, [chatType, selectedPage?.pageId])

  useEffect(() => {
    if (!id) return
    if (chatType === 'page' && !selectedPage?.pageId) {
      void loadMessages({
        sessionId: id,
        chatType: 'page',
        pageId: 'page-1'
      })
      return
    }
    void loadMessages({
      sessionId: id,
      chatType,
      pageId: chatType === 'page' ? selectedPage?.pageId : undefined
    })
  }, [id, chatType, selectedPage?.pageId, loadMessages, setMessages])

  useEffect(() => {
    if (!id) return
    const handler = (event: GenerateChunkEvent): void => {
      const { type, payload } = event
      if (payload.sessionId && payload.sessionId !== id) return
      if (
        type === 'stage_started' ||
        type === 'stage_progress' ||
        type === 'page_generated' ||
        type === 'llm_status'
      ) {
        // 不清空 currentPages，保持预览可见
        useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
        updateProgress({
          stage: payload.stage,
          label: payload.label,
          progress: payload.progress ?? 0,
          currentPage: payload.currentPage,
          totalPages: payload.totalPages
        })
        if (type === 'page_generated') {
          // Skip page_generated during addPage — pages will be reloaded on run_completed
          if (useSessionDetailUiStore.getState().isAddingPage) {
            updateProgress({
              stage: payload.stage,
              label: payload.label,
              progress: payload.progress ?? 0,
              currentPage: payload.currentPage,
              totalPages: payload.totalPages
            })
            return
          }
          const store = useGenerateStore.getState()
          // 全新生成：第 1 页到来时清掉旧页面，避免新旧混合
          if (payload.pageNumber === 1 && store.currentPages.length > 0) {
            store.setPages([])
          }
          store.addPage({
            pageNumber: payload.pageNumber,
            title: payload.title,
            html: payload.html,
            htmlPath: payload.htmlPath,
            pageId: payload.pageId || `page-${payload.pageNumber}`,
            sourceUrl: payload.sourceUrl,
            status: 'completed',
            error: null
          })
          useSessionDetailUiStore.getState().setSelectedPageNumber(payload.pageNumber)
          useSessionDetailUiStore.getState().bumpPreviewKey()
        }
      } else if (type === 'page_updated') {
        useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
        useGenerateStore.getState().addPage({
          pageNumber: payload.pageNumber,
          title: payload.title,
          html: payload.html,
          htmlPath: payload.htmlPath,
          pageId: payload.pageId || `page-${payload.pageNumber}`,
          sourceUrl: payload.sourceUrl,
          status: 'completed',
          error: null
        })
        useSessionDetailUiStore.getState().setSelectedPageNumber(payload.pageNumber)
        useSessionDetailUiStore.getState().bumpPreviewKey()
      } else if (type === 'assistant_message') {
        const incomingType = payload.chatType === 'page' && payload.pageId ? 'page' : 'main'
        const incomingPageId = incomingType === 'page' ? payload.pageId : undefined
        const active = activeChatRef.current
        const matchesCurrentChat =
          incomingType === active.chatType &&
          (incomingType !== 'page' || incomingPageId === active.pageId)
        if (!matchesCurrentChat) return
        const createdAt = payload.timestamp
          ? Math.floor(new Date(payload.timestamp).getTime() / 1000)
          : Math.floor(Date.now() / 1000)
        addMessage({
          id: payload.id || crypto.randomUUID(),
          session_id: id,
          chat_scope: incomingType,
          page_id: incomingPageId || null,
          role: 'assistant',
          content: payload.content,
          type: 'text',
          tool_name: null,
          tool_call_id: null,
          token_count: null,
          created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000)
        })
      } else if (type === 'run_completed') {
        if (!useSessionDetailUiStore.getState().isAddingPage) {
          useGenerateStore.getState().finishGeneration()
        }
      } else if (type === 'run_error') {
        if (!useSessionDetailUiStore.getState().isAddingPage) {
          useGenerateStore.getState().setError(payload.message)
        }
      }
    }
    const unsubscribe = ipc.onGenerateChunk(handler)
    return () => {
      unsubscribe?.()
    }
  }, [addMessage, id, updateProgress])

  const isSupportedImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)
  }

  const uploadFiles = async (files: File[]): Promise<void> => {
    if (!id || files.length === 0) return
    const imageFiles = files.filter(isSupportedImageFile).slice(0, 10)
    if (imageFiles.length === 0) {
      toastWarning(t('sessionDetail.imageOnly'))
      return
    }
    const payloadFiles = imageFiles
      .map((file) => ({
        path: window.electron?.getPathForFile?.(file) || '',
        name: file.name
      }))
      .filter((file) => file.path)
    if (payloadFiles.length === 0) {
      toastError(t('sessionDetail.imagePathFailed'))
      return
    }
    useSessionDetailUiStore.getState().setIsUploadingAssets(true)
    try {
      const result = await ipc.uploadAssets({ sessionId: id, files: payloadFiles })
      if (result.assets.length > 0) {
        useSessionDetailUiStore.getState().addPendingAssets(result.assets)
        toastSuccess(t('sessionDetail.assetsAdded', { count: result.assets.length }))
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.assetUploadFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsUploadingAssets(false)
      useSessionDetailUiStore.getState().setAssetDragActive(false)
    }
  }

  const handleChooseAssets = async (): Promise<void> => {
    if (!id || useSessionDetailUiStore.getState().isUploadingAssets) return
    useSessionDetailUiStore.getState().setIsUploadingAssets(true)
    try {
      const result = await ipc.chooseAndUploadAssets(id)
      if (result.cancelled) return
      if (result.assets.length > 0) {
        useSessionDetailUiStore.getState().addPendingAssets(result.assets)
        toastSuccess(t('sessionDetail.assetsAdded', { count: result.assets.length }))
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.assetUploadFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsUploadingAssets(false)
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!id) return
    if (sendingMessageRef.current || isGenerating) return
    const detailState = useSessionDetailUiStore.getState()
    if (detailState.chatType === 'main') {
      toastInfo(t('sessionDetail.switchToPageFirst'))
      return
    }
    if (!detailState.input.trim() && detailState.pendingAssets.length === 0) return
    const content = detailState.input.trim() || t('sessionDetail.useUploadedAssets')
    const assetsForMessage = detailState.pendingAssets
    const hasSelector = Boolean(detailState.selectedSelector?.trim())
    const selectorForMessage = hasSelector ? detailState.selectedSelector!.trim() : null
    const effectiveChatType: 'main' | 'page' = hasSelector ? 'page' : detailState.chatType
    const effectivePage = selectedPage ?? normalizedOrderedPages[0] ?? null
    const targetPageId = effectiveChatType === 'page' ? effectivePage?.pageId : undefined
    const targetPagePath =
      effectiveChatType === 'page'
        ? effectivePage?.htmlPath || normalizedOrderedPages[0]?.htmlPath
        : undefined
    if (effectiveChatType === 'page' && !targetPageId) {
      toastError(t('sessionDetail.selectPageFirst'))
      return
    }
    if (hasSelector && detailState.chatType !== 'page') {
      detailState.setChatType('page')
    }
    sendingMessageRef.current = true
    try {
      useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
      addMessage({
        id: crypto.randomUUID(),
        session_id: id,
        chat_scope: effectiveChatType,
        page_id: effectiveChatType === 'page' ? (targetPageId as string) : null,
        selector: effectiveChatType === 'page' ? selectorForMessage : null,
        image_paths: assetsForMessage.map((asset) => asset.relativePath),
        role: 'user',
        content,
        type: 'text',
        tool_name: null,
        tool_call_id: null,
        token_count: null,
        created_at: Math.floor(Date.now() / 1000)
      })
      detailState.setInput('')
      detailState.clearPendingAssets()
      detailState.clearSelectedElement()
      const hasExistingPages = normalizedOrderedPages.length > 0
      await ipc.startGenerate({
        sessionId: id,
        userMessage: content,
        type: hasExistingPages ? 'page' : 'deck',
        chatType: effectiveChatType,
        chatPageId: effectiveChatType === 'page' ? targetPageId : undefined,
        selectedPageId: hasExistingPages && effectiveChatType === 'page' ? targetPageId : undefined,
        htmlPath: hasExistingPages && effectiveChatType === 'page' ? targetPagePath : undefined,
        selector: selectorForMessage || undefined,
        elementTag: hasSelector ? detailState.elementTag || undefined : undefined,
        elementText: hasSelector ? detailState.elementText || undefined : undefined,
        imagePaths: assetsForMessage.map((asset) => asset.relativePath)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('generating.failed')
      useGenerateStore.getState().setError(message)
      toastError(message)
    } finally {
      sendingMessageRef.current = false
    }
  }

  const handleCancel = async (): Promise<void> => {
    await ipc.cancelGenerate(id!)
    cancelGeneration()
  }

  const handleOpenAddPageDialog = (): void => {
    setAddPageInput('')
    setAddPageDialogOpen(true)
  }

  const handleRetryFailedPage = async (page: SessionPreviewPage): Promise<void> => {
    if (!id || !page.pageId) return
    useSessionDetailUiStore.getState().setIsRetryingSinglePage(true)
    useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
    try {
      await ipc.retrySinglePage({ sessionId: id, pageId: page.pageId })
      await loadSession(id)
      useGenerateStore.getState().setPages(useSessionStore.getState().currentGeneratedPages)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sessionDetail.retryPageFailed')
      toastError(message)
    } finally {
      useGenerateStore.getState().finishGeneration()
      useSessionDetailUiStore.getState().setIsRetryingSinglePage(false)
    }
  }

  const handleAddPage = async (): Promise<void> => {
    if (!id || !addPageInput.trim()) return
    const description = addPageInput.trim()
    const beforePageIds = new Set(normalizedOrderedPages.map((page) => page.pageId))
    const beforePageCount = normalizedOrderedPages.length
    setAddPageDialogOpen(false)
    setAddPageInput('')
    setIsAddingPage(true)
    const insertAfter = selectedPageNumber ?? normalizedOrderedPages.length
    useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
    let targetSelection: number | null | undefined = undefined

    try {
      await ipc.addPage({
        sessionId: id,
        userMessage: description,
        insertAfterPageNumber: insertAfter
      })
      // addPage 返回后，新增页可能尚未写回 session，短轮询确保拿到新页再选中。
      let latestGeneratedPages = useSessionStore.getState().currentGeneratedPages
      let latestPages = normalizePagesForSelection(latestGeneratedPages)
      let addedPage = latestPages.find((page) => !beforePageIds.has(page.pageId))

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await loadSession(id)
        latestGeneratedPages = useSessionStore.getState().currentGeneratedPages
        latestPages = normalizePagesForSelection(latestGeneratedPages)
        addedPage = latestPages.find((page) => !beforePageIds.has(page.pageId))
        if (addedPage || latestPages.length > beforePageCount) break
        await new Promise<void>((resolve) => window.setTimeout(resolve, 300))
      }

      useGenerateStore.getState().setPages(latestGeneratedPages)
      const fallbackPage =
        latestPages[Math.min(insertAfter, Math.max(latestPages.length - 1, 0))] ||
        latestPages[latestPages.length - 1]
      targetSelection = (addedPage || fallbackPage)?.pageNumber ?? null
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sessionDetail.addPageFailed')
      toastError(message)
    } finally {
      useSessionDetailUiStore.getState().finishAddPage(targetSelection)
      useGenerateStore.getState().finishGeneration()
    }
  }

  const cleanMessageContent = (content: string): string =>
    content.replace(
      /[（(](?:目标)?选择器[:：]\s*[^）\n]{8,}[）)]/g,
      t('sessionDetail.selectorLocated')
    )

  const getPptxExportNotice = (warnings?: string[]): string | null => {
    const items = (warnings || []).filter(Boolean)
    if (items.length === 0) return null

    const hasPageLoadDelay = items.some((item) => item.includes('未收到打印就绪信号'))
    if (hasPageLoadDelay) {
      return t('sessionDetail.pageLoadNotice')
    }

    const hasNoEditableText = items.some((item) => item.includes('未提取到可编辑文本'))
    if (hasNoEditableText) {
      return t('sessionDetail.noEditableTextNotice')
    }

    const hasOnlyCapabilityNote = items.every(
      (item) =>
        item.includes('自研') ||
        item.includes('pptxgenjs') ||
        item.includes('HTML 解析器') ||
        item.includes('文本层')
    )
    if (hasOnlyCapabilityNote) return null

    return t('sessionDetail.exportCheckNotice')
  }

  const openProjectPreview = async (): Promise<void> => {
    const basePath = selectedPage?.htmlPath || normalizedOrderedPages[0]?.htmlPath
    if (!basePath) return
    const indexPath = basePath.replace(/page-\d+\.html$/i, 'index.html')
    const pageHash = selectedPage?.pageId || normalizedOrderedPages[0]?.pageId
    await ipc.openInBrowser(indexPath, pageHash ? `#${pageHash}` : undefined, id || undefined)
  }

  const handleExportPdf = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isExportingPdf) return
    detailState.setIsExportingPdf(true)
    toastInfo(t('sessionDetail.exportPdfStart'), {
      description: t('sessionDetail.exportPdfDescription'),
      duration: 8000
    })
    try {
      const result = await ipc.exportPdf(id)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastWarning(t('sessionDetail.exportDonePages', { count: result.pageCount || 0 }), {
          description: result.warnings[0]
        })
        return
      }
      toastSuccess(t('sessionDetail.exportSuccessPages', { count: result.pageCount || 0 }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPdf(false)
    }
  }

  const handleExportPng = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isExportingPng) return
    detailState.setIsExportingPng(true)
    toastInfo(t('sessionDetail.exportPngStart'), {
      description: t('sessionDetail.exportPngDescription'),
      duration: 8000
    })
    try {
      const result = await ipc.exportPng(id)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastWarning(t('sessionDetail.pngExported', { count: result.pageCount || 0 }), {
          description: t('sessionDetail.pageLoadNotice')
        })
        return
      }
      toastSuccess(t('sessionDetail.pngExported', { count: result.pageCount || 0 }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPng(false)
    }
  }

  const handleExportPptx = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isExportingPptx) return
    detailState.setIsExportingPptx(true)
    toastInfo(t('sessionDetail.pptxPreparing'), {
      description: t('sessionDetail.pptxPreparingDescription'),
      duration: 8000
    })
    try {
      const result = await ipc.exportPptx(id)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      const exportNotice = getPptxExportNotice(result.warnings)
      if (exportNotice) {
        toastWarning(t('sessionDetail.pptxExported', { count: result.pageCount || 0 }), {
          description: exportNotice
        })
        return
      }
      toastSuccess(t('sessionDetail.pptxExported', { count: result.pageCount || 0 }), {
        description: t('sessionDetail.pptxEditableDescription')
      })
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPptx(false)
    }
  }

  const selectedPagePendingDragCount = useMemo(() => {
    if (!selectedPage?.pageId) return 0
    return pendingDragEdits.filter((item) => item.pageId === selectedPage.pageId).length
  }, [pendingDragEdits, selectedPage])

  const handleElementMoved = (payload: DragEditorMovePayload): void => {
    if (!id || !selectedPage?.htmlPath || !selectedPage.pageId) return
    const nextEdit = {
      ...payload,
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath
    }
    setPendingDragEdits((items) => {
      const existingIndex = items.findIndex(
        (item) =>
          item.pageId === nextEdit.pageId &&
          item.htmlPath === nextEdit.htmlPath &&
          item.selector === nextEdit.selector
      )
      if (existingIndex < 0) return [...items, nextEdit]
      return items.map((item, index) => (index === existingIndex ? nextEdit : item))
    })
  }

  // Unified save: persist both drag edits and text edits for the current page
  const handleSaveAllEdits = async (): Promise<void> => {
    if (!id || !selectedPage?.pageId) return
    const dragEdits = pendingDragEdits.filter((item) => item.pageId === selectedPage.pageId)
    const textEdits = pendingTextEdits.filter((item) => item.pageId === selectedPage.pageId)
    if (dragEdits.length === 0 && textEdits.length === 0) {
      useSessionDetailUiStore.getState().setInteractionMode('preview')
      return
    }
    setIsSavingEdits(true)
    try {
      for (const edit of dragEdits) {
        const result = await ipc.updateElementLayout({
          sessionId: id,
          htmlPath: edit.htmlPath,
          pageId: edit.pageId,
          selector: edit.selector,
          x: edit.x,
          y: edit.y,
          width: edit.width,
          height: edit.height,
          childUpdates: edit.childUpdates
        })
        if (!result.success) {
          throw new Error(t('sessionDetail.layoutSaveFailed'))
        }
      }
      for (const edit of textEdits) {
        const result = await ipc.updateElementProperties({
          sessionId: id,
          htmlPath: edit.htmlPath,
          pageId: edit.pageId,
          selector: edit.selector,
          patch: edit.patch
        })
        if (!result.success) {
          throw new Error(t('sessionDetail.textSaveFailed'))
        }
      }
      setPendingDragEdits((items) => items.filter((item) => item.pageId !== selectedPage.pageId))
      setPendingTextEdits((items) => items.filter((item) => item.pageId !== selectedPage.pageId))
      previewIframeRef.current?.clearTextEditorSelection()
      setTextSelection(null)
      setTextDraft(EMPTY_ELEMENT_DRAFT)
      useSessionDetailUiStore.getState().bumpThumbnailVersion(selectedPage.pageId)
      useSessionDetailUiStore.getState().setInteractionMode('preview')
      const totalCount = dragEdits.length + textEdits.length
      toastSuccess(t('sessionDetail.adjustmentsSaved', { count: totalCount }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.layoutSaveFailed'))
    } finally {
      setIsSavingEdits(false)
    }
  }

  const handleDiscardAllEdits = (): void => {
    if (!selectedPage?.pageId) return
    const hadDragPending = pendingDragEdits.some((item) => item.pageId === selectedPage.pageId)
    const hadTextPending = pendingTextEdits.some((item) => item.pageId === selectedPage.pageId)
    setPendingDragEdits((items) => items.filter((item) => item.pageId !== selectedPage.pageId))
    setPendingTextEdits((items) => items.filter((item) => item.pageId !== selectedPage.pageId))
    previewIframeRef.current?.clearTextEditorSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
    setPreviewRefreshKey((key) => key + 1)
    useSessionDetailUiStore.getState().setInteractionMode('preview')
    if (hadDragPending || hadTextPending) toastInfo(t('sessionDetail.discardedAdjustments'))
  }

  const handleTextSelected = (payload: TextEditorSelectionPayload): void => {
    // Commit previous edit before switching to new element
    commitCurrentTextEdit()
    setTextSelection(payload)
    setTextDraft({
      text: payload.text,
      color: rgbToHex(payload.style.color),
      fontSize: fontSizeToNumber(payload.style.fontSize),
      fontWeight: normalizeFontWeight(payload.style.fontWeight)
    })
  }

  const handleTextDraftChange = (draft: ElementEditDraft): void => {
    setTextDraft(draft)
    // Live preview in iframe
    if (textSelection && selectedPage?.pageId) {
      previewIframeRef.current?.liveUpdateTextElement(textSelection.selector, {
        text: draft.text,
        style: {
          color: draft.color,
          fontSize: draft.fontSize ? `${draft.fontSize}px` : undefined,
          fontWeight: draft.fontWeight
        }
      })
    }
  }

  // When user starts editing a new element, save the previous text edit as pending
  const commitCurrentTextEdit = (): void => {
    if (!textSelection || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const nextText = textDraft.text.trim()
    if (!nextText) return
    // Skip if nothing actually changed
    if (
      nextText === textSelection.text &&
      textDraft.color === rgbToHex(textSelection.style.color) &&
      textDraft.fontSize === fontSizeToNumber(textSelection.style.fontSize) &&
      textDraft.fontWeight === normalizeFontWeight(textSelection.style.fontWeight)
    ) return
    const patch = {
      text: nextText,
      style: {
        color: textDraft.color,
        fontSize: textDraft.fontSize,
        fontWeight: textDraft.fontWeight
      }
    }
    const entry = {
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      selector: textSelection.selector,
      patch
    }
    setPendingTextEdits((items) => {
      const existingIndex = items.findIndex(
        (item) => item.pageId === entry.pageId && item.selector === entry.selector
      )
      if (existingIndex < 0) return [...items, entry]
      return items.map((item, index) => (index === existingIndex ? entry : item))
    })
  }

  const handleCancelTextEdit = (): void => {
    // Commit current text edit before closing panel
    commitCurrentTextEdit()
    previewIframeRef.current?.clearTextEditorSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
  }

  return (
    <TooltipProvider delayDuration={180}>
      <div className="flex h-full min-h-0 flex-col bg-[#f5f1e8] text-foreground">
        <header className="app-drag-region app-titlebar relative shrink-0 bg-[#f5f1e8]/95 shadow-[0_10px_26px_rgba(93,107,77,0.055)] backdrop-blur-xl">
          <div className="absolute left-0 top-0 h-full w-[220px] bg-[#f5f1e8]" />
          <div
            className={`relative flex h-full items-center justify-end pl-[244px] ${
              isMac ? 'px-3' : 'pr-[calc(var(--app-titlebar-control-safe-area)+16px)]'
            }`}
          >
            <div className="app-no-drag flex items-center gap-1.5">
              <SessionToolbar
                hasPages={normalizedOrderedPages.length > 0}
                canPreview={Boolean(selectedPage?.htmlPath || normalizedOrderedPages[0]?.htmlPath)}
                canRevealFile={Boolean(selectedPage?.htmlPath)}
                onExportPdf={() => void handleExportPdf()}
                onExportPng={() => void handleExportPng()}
                onExportPptx={() => void handleExportPptx()}
                onOpenPreview={() => void openProjectPreview()}
                onRevealFile={() => {
                  if (selectedPage?.htmlPath) {
                    void ipc.revealFile(selectedPage.htmlPath, id || undefined)
                  }
                }}
              />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-[#f5f1e8]">
          <PageSidebar
            pages={normalizedOrderedPages}
            disabled={interactionMode === 'ai-inspect' && isGenerating}
            onAddPage={handleOpenAddPageDialog}
            onRetryFailedPage={handleRetryFailedPage}
          />

          <PreviewStage
            ref={previewIframeRef}
            selectedPage={selectedPage}
            sessionTitle={currentSession?.title}
            isGenerating={isGenerating}
            progressLabel={progress?.label}
            previewRefreshKey={previewRefreshKey}
            pendingEditCount={selectedPagePendingDragCount + pendingTextEdits.filter((item) => item.pageId === selectedPage?.pageId).length}
            isSavingEdits={isSavingEdits}
            textSelection={textSelection}
            textDraft={textDraft}
            onTextDraftChange={handleTextDraftChange}
            onElementMoved={handleElementMoved}
            onTextSelected={handleTextSelected}
            onCancelTextEdit={handleCancelTextEdit}
            onSaveAllEdits={() => void handleSaveAllEdits()}
            onDiscardAllEdits={handleDiscardAllEdits}
          />

          {interactionMode === 'ai-inspect' && (
            <MessagePanel
              selectedPageExists={Boolean(selectedPage?.pageId)}
              selectedPageNumber={selectedPage?.pageNumber}
              isGenerating={isGenerating}
              progress={progress}
              error={error}
              onDropFiles={(files) => void uploadFiles(files)}
              onChooseAssets={() => void handleChooseAssets()}
              onSend={() => void handleSend()}
              onCancel={() => void handleCancel()}
              cleanMessageContent={cleanMessageContent}
            />
          )}
        </div>

        {/* Add Page Dialog */}
        {addPageDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-[520px] rounded-2xl bg-white p-6 shadow-2xl">
              <h3 className="mb-3 text-base font-semibold text-[#2f3a2a]">
                {t('sessionDetail.addPage')}
              </h3>
              <textarea
                value={addPageInput}
                onChange={(e) => setAddPageInput(e.target.value)}
                placeholder={t('sessionDetail.addPageDescription')}
                className="mb-4 h-40 w-full resize-none rounded-xl border border-[#d4e4c1]/60 bg-[#f8f6f0] px-4 py-3 text-sm leading-relaxed text-[#2f3a2a] placeholder:text-[#8a9a7b] focus:border-[#5d6b4d] focus:outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && addPageInput.trim()) {
                    e.preventDefault()
                    void handleAddPage()
                  }
                  if (e.key === 'Escape') {
                    setAddPageDialogOpen(false)
                  }
                }}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddPageDialogOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-[#5d6b4d] transition-colors hover:bg-[#f0ece3] cursor-pointer"
                >
                  {t('sessionDetail.addPageCancel')}
                </button>
                <button
                  type="button"
                  disabled={!addPageInput.trim()}
                  onClick={() => void handleAddPage()}
                  className="rounded-xl bg-[#5d6b4d] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3e4a32] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {t('sessionDetail.addPageGenerate')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Page Progress Overlay */}
        {isAddingPage && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="flex w-[360px] flex-col items-center gap-4 rounded-2xl bg-white/95 px-8 py-6 shadow-2xl">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#d4e4c1] border-t-[#5d6b4d]" />
              <div className="flex w-full flex-col items-center gap-2">
                <p className="text-sm font-medium text-[#3e4a32]">
                  {progress?.label || t('sessionDetail.addPageGenerating')}
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e8e0d0]">
                  <div
                    className="h-full rounded-full bg-[#5d6b4d] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progress?.progress ?? 0))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Retry Single Page Progress Overlay */}
        {isRetryingSinglePage && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="flex w-[360px] flex-col items-center gap-4 rounded-2xl bg-white/95 px-8 py-6 shadow-2xl">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#f3e4df] border-t-[#93564f]" />
              <div className="flex w-full flex-col items-center gap-2">
                <p className="text-sm font-medium text-[#93564f]">
                  {progress?.label || t('sessionDetail.retryPageGenerating')}
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e8e0d0]">
                  <div
                    className="h-full rounded-full bg-[#93564f] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progress?.progress ?? 0))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
