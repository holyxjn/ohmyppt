import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { ipc } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { Button } from '../components/ui/Button'
import { Textarea } from '../components/ui/Input'
import { Progress } from '../components/ui/Progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/Select'
import { ScrollArea } from '../components/ui/ScrollArea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../components/ui/DropdownMenu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/Tooltip'
import { PreviewIframe } from '../components/preview/PreviewIframe'
import {
  Send,
  StopCircle,
  Loader2,
  Sparkles,
  FileSearch,
  Home,
  ExternalLink,
  FileDown,
  Presentation,
  Crosshair,
  X,
  Plus,
  Image as ImageIcon,
  FileText
} from 'lucide-react'
import { useSessionStore, useGenerateStore } from '../store'
import type { GenerateChunkEvent, UploadedAsset } from '@shared/generation.js'
import { useToastStore } from '../store'
import { getEditorGate } from '../lib/sessionMetadata'

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isMac = window.electron?.process?.platform === 'darwin'
  const {
    currentSession,
    currentMessages,
    currentGeneratedPages,
    loadSession,
    loadMessages,
    setMessages,
    addMessage
  } = useSessionStore()
  const { isGenerating, updateProgress, cancelGeneration, progress, currentPages, error } =
    useGenerateStore()
  const [input, setInput] = useState('')
  const [chatType, setChatType] = useState<'main' | 'page'>('page')
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [previewKey, setPreviewKey] = useState(0)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isExportingPng, setIsExportingPng] = useState(false)
  const [isExportingPptx, setIsExportingPptx] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [selectedSelector, setSelectedSelector] = useState<string | null>(null)
  const [selectorLabel, setSelectorLabel] = useState('')
  const [elementTag, setElementTag] = useState('')
  const [elementText, setElementText] = useState('')
  const [pendingAssets, setPendingAssets] = useState<UploadedAsset[]>([])
  const [assetDragActive, setAssetDragActive] = useState(false)
  const [isUploadingAssets, setIsUploadingAssets] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeChatRef = useRef<{ chatType: 'main' | 'page'; pageId?: string }>({ chatType: 'page' })
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
    () =>
      orderedPages.map((page) => ({
        ...page,
        pageId: page.pageId || `page-${page.pageNumber}`
      })),
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
    setInspecting(false)
    setSelectedSelector(null)
    setSelectorLabel('')
    setElementTag('')
    setElementText('')
  }, [selectedPage?.pageId])

  const isFullyGenerated = useMemo(() => {
    if (!currentSession) return false
    const gate = getEditorGate(currentSession)
    return gate.generatedCount >= gate.totalCount && gate.failedCount === 0
  }, [currentSession])

  useEffect(() => {
    if (!inspecting) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setInspecting(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inspecting])

  useEffect(() => {
    if (!id) return
    setMessages([])
    useGenerateStore.getState().setPages([])
    setSelectedPageNumber(null)
    setPendingAssets([])
    void loadSession(id)
  }, [id, loadSession, setMessages])

  useEffect(() => {
    useGenerateStore.getState().setPages(currentGeneratedPages)
  }, [currentGeneratedPages])

  useEffect(() => {
    if (!id || !currentSession) return
    if (!isFullyGenerated) {
      navigate(`/sessions/${id}/generating`, { replace: true })
    }
  }, [currentSession, id, isFullyGenerated, navigate])

  useEffect(() => {
    if (!id) return
    const saved = window.localStorage.getItem(`workbench:selected-page:${id}`)
    if (!saved) return
    const parsed = Number(saved)
    if (Number.isFinite(parsed) && parsed > 0) {
      setSelectedPageNumber(parsed)
    }
  }, [id])

  useEffect(() => {
    if (normalizedOrderedPages.length === 0) {
      setSelectedPageNumber(null)
      return
    }

    if (
      selectedPageNumber &&
      normalizedOrderedPages.some((page) => page.pageNumber === selectedPageNumber)
    ) {
      return
    }

    setSelectedPageNumber(normalizedOrderedPages[0].pageNumber)
  }, [normalizedOrderedPages, selectedPageNumber])

  useEffect(() => {
    if (!id || !selectedPageNumber) return
    window.localStorage.setItem(`workbench:selected-page:${id}`, String(selectedPageNumber))
  }, [id, selectedPageNumber])

  useEffect(() => {
    setChatType('page')
  }, [id])

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
    const handler = (event: GenerateChunkEvent) => {
      const { type, payload } = event
      if (payload.sessionId && payload.sessionId !== id) return
      if (
        type === 'stage_started' ||
        type === 'stage_progress' ||
        type === 'page_generated' ||
        type === 'llm_status'
      ) {
        // 不清空 currentPages，保持预览可见
        useGenerateStore.setState({ isGenerating: true, error: null })
        updateProgress({
          stage: payload.stage,
          label: payload.label,
          progress: payload.progress ?? 0,
          currentPage: payload.currentPage,
          totalPages: payload.totalPages
        })
        if (type === 'page_generated') {
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
          setSelectedPageNumber(payload.pageNumber)
          setPreviewKey((k) => k + 1)
        }
      } else if (type === 'page_updated') {
        useGenerateStore
          .getState()
          .updatePage(payload.pageId || `page-${payload.pageNumber}`, payload.html, {
            pageNumber: payload.pageNumber,
            title: payload.title,
            htmlPath: payload.htmlPath,
            sourceUrl: payload.sourceUrl,
            status: 'completed',
            error: null
          })
        setSelectedPageNumber(payload.pageNumber)
        setPreviewKey((k) => k + 1)
      } else if (type === 'assistant_message') {
        const incomingType = payload.chatType === 'page' && payload.pageId ? 'page' : 'main'
        const incomingPageId = incomingType === 'page' ? payload.pageId : undefined
        const active = activeChatRef.current
        const matchesCurrentChat =
          incomingType === active.chatType &&
          (incomingType !== 'page' || incomingPageId === active.pageId)
        if (!matchesCurrentChat) return
        addMessage({
          id: crypto.randomUUID(),
          session_id: id,
          chat_scope: incomingType,
          page_id: incomingPageId || null,
          role: 'assistant',
          content: payload.content,
          type: 'text',
          tool_name: null,
          tool_call_id: null,
          token_count: null,
          created_at: Math.floor(Date.now() / 1000)
        })
      } else if (type === 'run_completed') {
        useGenerateStore.getState().finishGeneration()
      } else if (type === 'run_error') {
        useGenerateStore.getState().setError(payload.message)
      }
    }
    const unsubscribe = ipc.onGenerateChunk(handler)
    return () => {
      unsubscribe?.()
    }
  }, [id, addMessage, updateProgress])

  // 消息面板自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages, isGenerating, progress?.progress, consoleOpen])

  const isSupportedImageFile = (file: File) => {
    if (file.type.startsWith('image/')) return true
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)
  }

  const uploadFiles = async (files: File[]) => {
    if (!id || files.length === 0) return
    const imageFiles = files.filter(isSupportedImageFile).slice(0, 10)
    if (imageFiles.length === 0) {
      toastWarning('暂只支持图片素材')
      return
    }
    const payloadFiles = imageFiles
      .map((file) => ({
        path: window.electron?.getPathForFile?.(file) || '',
        name: file.name
      }))
      .filter((file) => file.path)
    if (payloadFiles.length === 0) {
      toastError('无法读取图片路径')
      return
    }
    setIsUploadingAssets(true)
    try {
      const result = await ipc.uploadAssets({ sessionId: id, files: payloadFiles })
      if (result.assets.length > 0) {
        setPendingAssets((assets) => [...assets, ...result.assets])
        toastSuccess(`已添加 ${result.assets.length} 个素材`)
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : '素材上传失败')
    } finally {
      setIsUploadingAssets(false)
      setAssetDragActive(false)
    }
  }

  const handleChooseAssets = async () => {
    if (!id || isUploadingAssets) return
    setIsUploadingAssets(true)
    try {
      const result = await ipc.chooseAndUploadAssets(id)
      if (result.cancelled) return
      if (result.assets.length > 0) {
        setPendingAssets((assets) => [...assets, ...result.assets])
        toastSuccess(`已添加 ${result.assets.length} 个素材`)
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : '素材上传失败')
    } finally {
      setIsUploadingAssets(false)
    }
  }

  const handleSend = async () => {
    if (!id) return
    if (chatType === 'main') {
      toastInfo('主会话已禁用发送，请先切换到“当前页”上下文。')
      return
    }
    if (!input.trim() && pendingAssets.length === 0) return
    const content = input.trim() || '使用已上传素材'
    const assetsForMessage = pendingAssets
    const hasSelector = Boolean(selectedSelector?.trim())
    const selectorForMessage = hasSelector ? selectedSelector!.trim() : null
    const effectiveChatType: 'main' | 'page' = hasSelector ? 'page' : chatType
    const effectivePage = selectedPage ?? normalizedOrderedPages[0] ?? null
    const targetPageId = effectiveChatType === 'page' ? effectivePage?.pageId : undefined
    const targetPagePath =
      effectiveChatType === 'page'
        ? effectivePage?.htmlPath || normalizedOrderedPages[0]?.htmlPath
        : undefined
    if (effectiveChatType === 'page' && !targetPageId) {
      toastError('请先选择页面后再发送')
      return
    }
    if (hasSelector && chatType !== 'page') {
      setChatType('page')
    }
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
    setInput('')
    setPendingAssets([])
    setSelectedSelector(null)
    setSelectorLabel('')
    setElementTag('')
    setElementText('')
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
      elementTag: hasSelector ? elementTag || undefined : undefined,
      elementText: hasSelector ? elementText || undefined : undefined,
      imagePaths: assetsForMessage.map((asset) => asset.relativePath)
    })
  }

  const handleCancel = async () => {
    await ipc.cancelGenerate(id!)
    cancelGeneration()
  }

  const contextHint =
    chatType === 'page' && selectedPage
      ? `当前页 · P${selectedPage.pageNumber}`
      : '主会话 · 用于全局结构与 index 调整'
  const inputPlaceholder =
    pendingAssets.length > 0
      ? '描述你想怎么使用这些素材，例如：把第一张图作为封面背景。'
      : chatType === 'page'
        ? '当前页模式：只会修改当前页内容。可先用“检选”选中元素，再说：改改当前的颜色或者字号等等。'
        : '主会话模式已禁用发送。请先把“上下文”切到“当前页”。'
  const selectorSummary = selectedSelector
    ? [
        selectorLabel || selectedSelector,
        elementTag ? `<${elementTag}>${elementText ? ` ${elementText}` : ''}` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const selectorTitle = selectedSelector
    ? [
        `selector: ${selectedSelector}`,
        selectorLabel && selectorLabel !== selectedSelector ? `label: ${selectorLabel}` : '',
        elementTag ? `element: <${elementTag}>` : '',
        elementText ? `text: ${elementText}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    : undefined
  const cleanMessageContent = (content: string) =>
    content.replace(/[（(](?:目标)?选择器[:：]\s*[^）\n]{8,}[）)]/g, '（已定位选中元素）')
  const toolbarButtonClass =
    'h-7 rounded-full border-transparent bg-[#e8e0d0]/72 px-2.5 text-[11px] text-[#3e4a32] shadow-[0_4px_10px_rgba(86,72,53,0.08)] hover:bg-[#d4e4c1]/78'
  const toolbarIconClass = 'mr-1.5 h-3.5 w-3.5'
  const getPptxExportNotice = (warnings?: string[]): string | null => {
    const items = (warnings || []).filter(Boolean)
    if (items.length === 0) return null

    const hasPageLoadDelay = items.some((item) => item.includes('未收到打印就绪信号'))
    if (hasPageLoadDelay) {
      return '部分页面加载时间较长，已按当前画面完成导出。建议打开 PPTX 快速检查一下。'
    }

    const hasNoEditableText = items.some((item) => item.includes('未提取到可编辑文本'))
    if (hasNoEditableText) {
      return '部分页面已优先保留完整画面，可能需要在 PowerPoint 中手动微调文字。'
    }

    const hasOnlyCapabilityNote = items.every(
      (item) =>
        item.includes('自研') ||
        item.includes('pptxgenjs') ||
        item.includes('HTML 解析器') ||
        item.includes('文本层')
    )
    if (hasOnlyCapabilityNote) return null

    return '文件已导出，建议打开 PPTX 快速检查版式细节。'
  }

  const openProjectPreview = async () => {
    const basePath = selectedPage?.htmlPath || normalizedOrderedPages[0]?.htmlPath
    if (!basePath) return
    const indexPath = basePath.replace(/page-\d+\.html$/i, 'index.html')
    const pageHash = selectedPage?.pageId || normalizedOrderedPages[0]?.pageId
    await ipc.openInBrowser(indexPath, pageHash ? `#${pageHash}` : undefined, id || undefined)
  }

  const handleExportPdf = async () => {
    if (!id || isExportingPdf) return
    setIsExportingPdf(true)
    toastInfo('正在导出 PDF，请稍等', {
      description: '页面较多或图表较复杂时可能会比较慢，请保持窗口打开，完成后会自动提示结果。',
      duration: 8000
    })
    try {
      const result = await ipc.exportPdf(id)
      if (result.cancelled) {
        toastInfo('已取消导出')
        return
      }
      if (!result.success || !result.path) {
        toastError('导出失败')
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastWarning(`导出完成（${result.pageCount || 0} 页）`, {
          description: result.warnings[0]
        })
        return
      }
      toastSuccess(`导出成功（${result.pageCount || 0} 页）`)
    } catch (error) {
      toastError(error instanceof Error ? error.message : '导出失败')
    } finally {
      setIsExportingPdf(false)
    }
  }

  const handleExportPng = async (): Promise<void> => {
    if (!id || isExportingPng) return
    setIsExportingPng(true)
    toastInfo('正在导出 PNG 图片', {
      description: '会将所有页面按顺序保存为高清图片，适合发文档、Notion 或社媒。',
      duration: 8000
    })
    try {
      const result = await ipc.exportPng(id)
      if (result.cancelled) {
        toastInfo('已取消导出')
        return
      }
      if (!result.success || !result.path) {
        toastError('导出失败')
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastWarning(`PNG 已导出（${result.pageCount || 0} 张）`, {
          description: '部分页面加载时间较长，已按当前画面完成导出。'
        })
        return
      }
      toastSuccess(`PNG 已导出（${result.pageCount || 0} 张）`)
    } catch (error) {
      toastError(error instanceof Error ? error.message : '导出失败')
    } finally {
      setIsExportingPng(false)
    }
  }

  const handleExportPptx = async (): Promise<void> => {
    if (!id || isExportingPptx) return
    setIsExportingPptx(true)
    toastInfo('正在准备可编辑 PPTX', {
      description: '会尽量保留版式、颜色和图片效果，同时让主要文字可继续编辑。',
      duration: 8000
    })
    try {
      const result = await ipc.exportPptx(id)
      if (result.cancelled) {
        toastInfo('已取消导出')
        return
      }
      if (!result.success || !result.path) {
        toastError('导出失败')
        return
      }
      const exportNotice = getPptxExportNotice(result.warnings)
      if (exportNotice) {
        toastWarning(`PPTX 已导出（${result.pageCount || 0} 页）`, {
          description: exportNotice
        })
        return
      }
      toastSuccess(`PPTX 已导出（${result.pageCount || 0} 页）`, {
        description: '已尽量保留版式与可编辑文字。'
      })
    } catch (error) {
      toastError(error instanceof Error ? error.message : '导出失败')
    } finally {
      setIsExportingPptx(false)
    }
  }

  const handleSelectorSelected = (
    selector: string,
    label: string,
    newElementTag?: string,
    newElementText?: string
  ) => {
    setSelectedSelector(selector)
    setSelectorLabel(label)
    setElementTag(newElementTag || '')
    setElementText(newElementText || '')
    setInspecting(false)
  }

  const toolbarActions = (
    <>
      {normalizedOrderedPages.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={() => void handleExportPptx()}
          disabled={isExportingPptx}
        >
          {isExportingPptx ? (
            <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
          ) : (
            <Presentation className={toolbarIconClass} />
          )}
          导出 PPTX
        </Button>
      )}
      {normalizedOrderedPages.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={() => void handleExportPng()}
          disabled={isExportingPng}
        >
          {isExportingPng ? (
            <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
          ) : (
            <ImageIcon className={toolbarIconClass} />
          )}
          导出 PNG
        </Button>
      )}
      {normalizedOrderedPages.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={() => void handleExportPdf()}
          disabled={isExportingPdf}
        >
          {isExportingPdf ? (
            <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
          ) : (
            <FileDown className={toolbarIconClass} />
          )}
          导出 PDF
        </Button>
      )}
      {(selectedPage?.htmlPath || normalizedOrderedPages[0]?.htmlPath) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={() => void openProjectPreview()}
        >
          <ExternalLink className={toolbarIconClass} />
          预览
        </Button>
      )}
      {selectedPage?.htmlPath && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={() => ipc.revealFile(selectedPage.htmlPath!, id || undefined)}
        >
          <FileSearch className={toolbarIconClass} />
          查看文件
        </Button>
      )}
      <button
        type="button"
        onClick={() => setConsoleOpen((open) => !open)}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-[38%_62%_44%_56%/55%_45%_55%_45%] cursor-pointer transition-colors',
          consoleOpen
            ? 'bg-[#d4e4c1]/86 text-[#486034] shadow-[0_5px_12px_rgba(93,107,77,0.12)]'
            : 'text-[#5d6b4d] hover:bg-[#e8e0d0]/72 hover:text-[#3e4a32]'
        )}
        aria-label={consoleOpen ? '收起消息面板' : '展开消息面板'}
        title={consoleOpen ? '收起消息面板' : '展开消息面板'}
        aria-pressed={consoleOpen}
      >
        <Sparkles className={cn('h-3.5 w-3.5', consoleOpen ? 'text-[#5e7d3e]' : '')} />
      </button>
    </>
  )

  return (
    <TooltipProvider delayDuration={180}>
      <div className="flex h-full min-h-0 flex-col bg-[#f5f1e8] text-foreground">
        <header className="app-drag-region app-titlebar relative shrink-0 bg-[#f5f1e8]/95 shadow-[0_10px_26px_rgba(93,107,77,0.055)] backdrop-blur-xl">
          <div className="absolute left-0 top-0 h-full w-[220px] bg-[#f5f1e8]" />
          <div
            className={cn(
              'relative flex h-full items-center justify-end pl-[244px]',
              isMac ? 'px-3' : 'pr-[calc(var(--app-titlebar-control-safe-area)+16px)]'
            )}
          >
            <div className="app-no-drag flex items-center gap-1.5">{toolbarActions}</div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-[#f5f1e8]">
          <aside className="flex min-h-0 w-[220px] shrink-0 flex-col bg-[#f5f1e8] px-2.5 pb-3 pt-3 shadow-[inset_-16px_0_30px_rgba(93,107,77,0.045)]">
            <div className="relative mb-3 flex items-center justify-between overflow-hidden rounded-[1.35rem] bg-[#e8e0d0]/72 px-2 py-1.5 shadow-[0_10px_24px_rgba(93,107,77,0.08)]">
              <div className="pointer-events-none absolute -right-6 -top-7 h-20 w-20 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#d4e4c1]/62" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => navigate('/sessions')}
                    className="relative inline-flex h-8 w-8 items-center justify-center rounded-[38%_62%_44%_56%/55%_45%_55%_45%] bg-[#f5f1e8]/72 text-[#5d6b4d] shadow-[0_4px_10px_rgba(93,107,77,0.08)] transition-colors hover:bg-[#d4e4c1]/78 hover:text-[#3e4a32] cursor-pointer"
                    aria-label="返回会话页"
                  >
                    <Home className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">返回会话页</TooltipContent>
              </Tooltip>
              <div className="relative rounded-full bg-[#d4e4c1]/74 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3e4a32] shadow-[0_3px_8px_rgba(93,107,77,0.08)]">
                Pages · {normalizedOrderedPages.length}
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1" viewportClassName="px-0.5 pb-2">
              {normalizedOrderedPages.length === 0 ? (
                <div className="flex min-h-[96px] items-center justify-center rounded-[1.25rem] bg-[#e8e0d0]/54 text-xs text-[#8a9a7b]">
                  暂无页面
                </div>
              ) : (
                <div className="space-y-2.5">
                  {normalizedOrderedPages.map((page) => {
                    const isSelected = selectedPage?.pageNumber === page.pageNumber
                    return (
                      <Tooltip key={page.pageNumber}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setSelectedPageNumber(page.pageNumber)}
                            className={cn(
                              'group relative block w-full min-w-0 overflow-hidden rounded-[1.25rem] p-1.5 text-left transition-all duration-200 cursor-pointer',
                              isSelected
                                ? 'bg-[#d4e4c1]/86 shadow-[0_14px_26px_rgba(93,107,77,0.18)]'
                                : 'bg-[#e8e0d0]/34 hover:bg-[#e8e0d0]/68 hover:shadow-[0_8px_18px_rgba(93,107,77,0.09)]'
                            )}
                          >
                            <div
                              className={cn(
                                'pointer-events-none absolute -right-7 -top-8 h-20 w-20 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] transition-opacity',
                                isSelected
                                  ? 'bg-[#8fbc8f]/24 opacity-100'
                                  : 'bg-[#d4e4c1]/28 opacity-0 group-hover:opacity-100'
                              )}
                            />
                            <div
                              className={cn(
                                'relative h-[106px] w-full overflow-hidden rounded-[1rem] bg-[#f5f1e8]/88 shadow-[0_5px_14px_rgba(93,107,77,0.08)]',
                                isSelected
                                  ? 'shadow-[0_6px_16px_rgba(93,107,77,0.13)]'
                                  : 'group-hover:shadow-[0_6px_15px_rgba(93,107,77,0.1)]'
                              )}
                              style={{ contain: 'paint' }}
                            >
                              <PreviewIframe
                                key={`thumb-${page.pageId}-${previewKey}`}
                                src={page.sourceUrl}
                                htmlPath={page.htmlPath}
                                pageId={page.pageId}
                                title={`filmstrip-page-${page.pageNumber}`}
                                inspectable={false}
                              />
                            </div>
                            <div className="relative mt-1.5 flex items-center justify-between gap-1 px-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5c6c47]">
                                P{page.pageNumber}
                              </span>
                              {isSelected ? (
                                <span className="rounded-full bg-[#5d6b4d] px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-[0_3px_8px_rgba(62,74,50,0.18)]">
                                  当前
                                </span>
                              ) : null}
                            </div>
                            <div
                              className="relative mt-0.5 block w-full min-w-0 max-w-full overflow-hidden whitespace-normal break-words px-0.5 text-[11px] font-medium leading-4 text-[#4c5d3d]"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical'
                              }}
                            >
                              {page.title}
                            </div>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" align="start">
                          <div className="max-w-[240px]">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a875f]">
                              Page {page.pageNumber}
                            </div>
                            <div className="mt-0.5 text-sm font-medium text-[#3e4a32]">
                              {page.title}
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </aside>

          <main className="flex min-h-0 flex-1 flex-col px-3 py-3">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[2rem] bg-[#e8e0d0]/54 p-3 shadow-[0_24px_54px_rgba(93,107,77,0.15)]">
              <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#d4e4c1]/48" />
              <div className="pointer-events-none absolute -bottom-24 left-8 h-48 w-64 rounded-[5%_95%_10%_90%/85%_15%_85%_15%] bg-[#c8b89e]/22" />
              {selectedPage ? (
                <div className="relative h-full overflow-hidden rounded-[1.55rem] bg-[#f5f1e8] p-2 shadow-[0_14px_32px_rgba(93,107,77,0.14)]">
                  <div className="pointer-events-none absolute left-5 top-5 z-20 max-w-[calc(100%-9rem)] overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-[#f5f1e8]/82 px-3 py-1 text-sm font-semibold tracking-[0.01em] text-[#3e4a32] shadow-[0_6px_18px_rgba(93,107,77,0.11)] backdrop-blur-md">
                    {currentSession?.title || '会话'}
                  </div>
                  <PreviewIframe
                    key={`preview-${selectedPage.pageId}-${previewKey}`}
                    src={selectedPage.sourceUrl}
                    htmlPath={selectedPage.htmlPath}
                    pageId={selectedPage.pageId}
                    title={`preview-page-${selectedPage.pageNumber}`}
                    inspectable
                    inspecting={inspecting}
                    onSelectorSelected={handleSelectorSelected}
                    onInspectExit={() => setInspecting(false)}
                  />
                  {selectedPage.htmlPath && (
                    <Button
                      type="button"
                      variant={inspecting ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        'absolute right-5 top-5 z-20 rounded-full px-3 text-xs shadow-[0_8px_20px_rgba(93,107,77,0.14)]',
                        inspecting
                          ? 'bg-[#5d6b4d] text-white'
                          : 'border-transparent bg-[#d4e4c1]/86 text-[#3e4a32] hover:bg-[#c8ddb2]'
                      )}
                      onClick={() => setInspecting((value) => !value)}
                      disabled={isGenerating}
                    >
                      <Crosshair className="mr-1.5 h-3.5 w-3.5" />
                      {inspecting ? '退出检选' : '检选元素'}
                    </Button>
                  )}
                  {selectedPage.status === 'failed' && (
                    <div className="absolute bottom-5 left-5 z-20 max-w-[520px] rounded-[1rem] bg-[#fff4ef]/92 px-3 py-2 text-xs text-[#8e5a53] shadow-[0_10px_24px_rgba(142,90,83,0.12)] backdrop-blur-sm">
                      这一页上次生成失败，当前展示的是可恢复的页面文件。请保持“当前页”上下文，直接描述如何修复或重新生成这一页。
                    </div>
                  )}
                  {inspecting && (
                    <div className="pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full bg-[#eff5ff]/90 px-3 py-1.5 text-xs text-[#375f97] shadow-[0_8px_18px_rgba(55,95,151,0.12)] backdrop-blur-sm">
                      点击页面元素以选中
                    </div>
                  )}
                  {isGenerating && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-[1.55rem] bg-[#f5f1e8]/68 backdrop-blur-sm transition-opacity">
                      <div className="flex flex-col items-center gap-3 rounded-[1.5rem] bg-[#e8e0d0]/88 px-8 py-5 shadow-[0_20px_44px_rgba(93,107,77,0.16)]">
                        <Loader2 className="h-6 w-6 animate-spin text-[#6f8159]" />
                        {progress && <p className="text-sm text-[#5a674b]">{progress.label}</p>}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative flex h-full min-h-[420px] flex-col items-center justify-center gap-4 rounded-[1.55rem] bg-[#f5f1e8]/84 text-center text-[#5d6b4d] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.32)]">
                  {isGenerating ? (
                    <Loader2 className="h-7 w-7 animate-spin text-[#5d6b4d]" />
                  ) : (
                    <Sparkles className="h-7 w-7 text-[#8fbc8f]" />
                  )}
                  <div className="space-y-1">
                    <p className="text-base font-medium text-[#3e4a32]">等着你的创意</p>
                    <p className="text-sm">
                      {isGenerating
                        ? '正在准备第一版预览…'
                        : '在消息面板里输入 brief，我会把预览放到这里。'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </main>

          {consoleOpen && (
            <aside className="mr-3 my-3 flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-[2rem] bg-[#d4e4c1]/58 shadow-[0_24px_54px_rgba(93,107,77,0.18)] backdrop-blur-xl">
              <div className="relative mx-2.5 mt-2.5 overflow-hidden rounded-[1.35rem] bg-[#f5f1e8]/68 px-3 pb-2.5 pt-3 shadow-[0_8px_20px_rgba(93,107,77,0.1)]">
                <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#8fbc8f]/24" />
                <div className="relative flex flex-col gap-2">
                  <h3 className="text-sm font-semibold tracking-[0.04em] text-[#4c5f3f]">
                    消息与输入
                  </h3>
                  <div className="flex items-center justify-between gap-2 text-xs text-[#6f7f58]">
                    <span>上下文</span>
                    <Select
                      value={chatType}
                      onValueChange={(value) => setChatType(value === 'page' ? 'page' : 'main')}
                    >
                      <SelectTrigger className="h-8 w-[96px] rounded-full border-transparent bg-[#f5f1e8]/76 px-2.5 py-1 text-xs text-[#3e4a32] shadow-[0_4px_10px_rgba(93,107,77,0.08)]">
                        <SelectValue placeholder="选择上下文" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="page" disabled={!selectedPage}>
                          当前页
                        </SelectItem>
                        <SelectItem value="main">主会话</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <ScrollArea
                data-messages-container
                className="min-h-0 flex-1"
                viewportClassName="px-2.5 py-2"
              >
                {currentMessages.length === 0 && !isGenerating ? (
                  <div className="flex min-h-full items-center justify-center text-sm text-[#6f7f58]">
                    还没有创意消息
                  </div>
                ) : (
                  <div className="flex min-h-full flex-col justify-end gap-2.5">
                    {currentMessages.map((msg) => {
                      const isUser = msg.role === 'user'
                      const selectorText =
                        typeof msg.selector === 'string' && msg.selector.trim().length > 0
                          ? msg.selector.trim()
                          : ''
                      const imagePaths = Array.isArray(msg.image_paths)
                        ? msg.image_paths
                            .map((item) => String(item || '').trim())
                            .filter((item) => item.startsWith('./images/'))
                            .slice(0, 10)
                        : []
                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            'flex w-full min-w-0',
                            isUser ? 'justify-end' : 'justify-start'
                          )}
                        >
                          <div
                            className={cn(
                              'min-w-0 overflow-hidden rounded-[1.15rem] px-3 py-2 shadow-[0_8px_18px_rgba(93,107,77,0.1)]',
                              selectorText ? 'w-full max-w-[238px]' : 'w-fit max-w-[238px]',
                              isUser
                                ? 'bg-[#f5f1e8]/82 text-[#3f4b35]'
                                : 'bg-[#e8e0d0]/76 text-[#3f4b35]'
                            )}
                          >
                            <div className="space-y-1">
                              {isUser && selectorText && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex w-full min-w-0 items-center overflow-hidden rounded-full bg-[#d4e4c1]/64 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#657552]">
                                      <span className="mr-1 shrink-0">SELECTOR</span>
                                      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal tracking-normal">
                                        {selectorText}
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent className="whitespace-pre-wrap break-all">
                                    {selectorText}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {isUser && imagePaths.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {imagePaths.map((imagePath) => (
                                    <Tooltip key={imagePath}>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#d4e4c1]/64 px-1.5 py-0.5 text-[10px] font-medium text-[#5f6d4b]">
                                          <ImageIcon className="h-3 w-3 shrink-0" />
                                          <span className="min-w-0 max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
                                            {imagePath}
                                          </span>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent className="whitespace-pre-wrap break-all">
                                        {imagePath}
                                      </TooltipContent>
                                    </Tooltip>
                                  ))}
                                </div>
                              )}
                              <p className="whitespace-pre-wrap break-words text-[13px] leading-5">
                                {cleanMessageContent(msg.content)}
                              </p>
                              <p className="text-[11px] leading-4 text-muted-foreground">
                                {dayjs(msg.created_at * 1000).format('YYYY-MM-DD HH:mm:ss')}
                              </p>
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {isGenerating && progress && (
                      <div className="rounded-[1.15rem] bg-[#f5f1e8]/74 px-3 py-2 shadow-[0_8px_18px_rgba(93,107,77,0.08)]">
                        <p className="mb-2 text-sm text-[#6f7f58]">
                          {progress.label || '模型处理中…'}
                        </p>
                        <Progress value={progress.progress} />
                      </div>
                    )}

                    {error && (
                      <div className="rounded-[1.15rem] bg-[rgba(217,124,139,0.12)] px-3 py-2 text-sm text-destructive">
                        {error}
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              <div
                className={cn(
                  'mx-2.5 mb-2.5 rounded-[1.4rem] bg-[#f5f1e8]/72 px-2.5 pb-3 pt-2 shadow-[0_14px_30px_rgba(93,107,77,0.12)] transition-colors',
                  assetDragActive && 'bg-[#edf4e3]/78'
                )}
                onDragEnter={(event) => {
                  event.preventDefault()
                  if (event.dataTransfer.types.includes('Files')) setAssetDragActive(true)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  if (event.dataTransfer.types.includes('Files')) setAssetDragActive(true)
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setAssetDragActive(false)
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const files = Array.from(event.dataTransfer.files)
                  void uploadFiles(files)
                }}
              >
                {selectedSelector && (
                  <div className="mb-2 flex items-center gap-2 rounded-[1rem] bg-[#e8e0d0]/64 px-2 py-1.5">
                    <span className="shrink-0 rounded-full bg-[#d4e4c1]/72 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#5f6d4b]">
                      SELECTOR
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-[#4f5f3f]">
                          {selectorSummary}
                        </span>
                      </TooltipTrigger>
                      {selectorTitle && (
                        <TooltipContent className="whitespace-pre-wrap">
                          {selectorTitle}
                        </TooltipContent>
                      )}
                    </Tooltip>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSelector(null)
                        setSelectorLabel('')
                        setElementTag('')
                        setElementText('')
                      }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#64735a] transition-colors hover:bg-[#d4e4c1]/85 hover:text-[#3e4a32]"
                      aria-label="清除 selector"
                      title="清除 selector"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {chatType === 'main' && (
                  <div className="mb-2 rounded-[1rem] bg-[#e8e0d0]/72 px-2.5 py-2 text-xs text-[#6b785a]">
                    主会话已禁用发送。请将“上下文”切换到“当前页”后再继续编辑。
                  </div>
                )}
                {pendingAssets.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {pendingAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex max-w-full items-center gap-1.5 rounded-full bg-[#d4e4c1]/74 px-2 py-1 text-[11px] text-[#4f6340] shadow-[0_3px_8px_rgba(93,107,77,0.08)]"
                        title={`${asset.originalName}\n${asset.relativePath}`}
                      >
                        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">
                          {asset.originalName || asset.fileName}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingAssets((assets) =>
                              assets.filter((item) => item.id !== asset.id)
                            )
                          }
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[#657552] hover:bg-[#c8ddb2]"
                          aria-label="移除素材"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Textarea
                  placeholder={inputPlaceholder}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && chatType !== 'main') {
                      e.preventDefault()
                      void handleSend()
                    }
                  }}
                  disabled={isGenerating || chatType === 'main'}
                  rows={4}
                  className="min-h-[96px] resize-none rounded-[1.15rem] border-transparent bg-[#e8e0d0]/52 px-3 py-2 text-[13px] leading-5 text-[#445439] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)] focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={isGenerating || isUploadingAssets || chatType === 'main'}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[38%_62%_44%_56%/55%_45%_55%_45%] bg-[#d4e4c1]/78 text-[#5e704c] shadow-[0_5px_12px_rgba(93,107,77,0.12)] transition-colors hover:bg-[#c8ddb2] disabled:pointer-events-none disabled:opacity-45"
                          aria-label="添加素材"
                          title="添加素材"
                        >
                          {isUploadingAssets ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="top" className="w-40">
                        <DropdownMenuItem onSelect={() => void handleChooseAssets()}>
                          <ImageIcon className="h-4 w-4" />
                          选择图片
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                          <FileText className="h-4 w-4" />
                          选择文件（即将支持）
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-[#6f7f58]">
                      {contextHint}
                    </div>
                  </div>

                  {isGenerating ? (
                    <Button
                      variant="destructive"
                      onClick={handleCancel}
                      size="sm"
                      className="shrink-0 whitespace-nowrap rounded-full px-3 text-xs shadow-[0_8px_18px_rgba(177,90,88,0.22)]"
                    >
                      <StopCircle className="mr-1 h-4 w-4" />
                      停止
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSend}
                      disabled={
                        chatType === 'main' ||
                        (!input.trim() && pendingAssets.length === 0) ||
                        ((selectedSelector ? 'page' : chatType) === 'page' && !selectedPage?.pageId)
                      }
                      size="sm"
                      className="shrink-0 whitespace-nowrap rounded-full bg-[#5d6b4d] px-3 text-xs text-white shadow-[0_8px_18px_rgba(93,107,77,0.24)] hover:bg-[#3e4a32]"
                    >
                      <Send className="mr-1 h-4 w-4" />
                      发送
                    </Button>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
