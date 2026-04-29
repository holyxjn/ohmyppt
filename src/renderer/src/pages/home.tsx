import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Input'
import { Card, CardContent } from '../components/ui/Card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/Select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/Tooltip'
import { CircleAlert, FileText, FileUp, Loader2, Sparkles } from 'lucide-react'
import { useSessionStore } from '../store'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import { ipc } from '@renderer/lib/ipc'

const MIN_PAGE_COUNT = 1
const MAX_PAGE_COUNT = 40
const DEFAULT_PAGE_COUNT = 5
const MAX_DOCUMENT_SIZE_MB = 10
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const MAX_PPTX_SIZE_MB = 80
const MAX_PPTX_SIZE_BYTES = MAX_PPTX_SIZE_MB * 1024 * 1024
const SETTINGS_REQUIRED_MESSAGE = '请先前往系统设置完成模型与存储目录配置。'

const resolvePageCount = (raw: string): number => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_COUNT
  return Math.min(MAX_PAGE_COUNT, Math.max(MIN_PAGE_COUNT, parsed))
}

export function HomePage(): ReactElement {
  const navigate = useNavigate()
  const { createSession, loading } = useSessionStore()
  const { settings, fetchSettings } = useSettingsStore()
  const { success, error, warning } = useToastStore()
  const [topic, setTopic] = useState('')
  const [brief, setBrief] = useState('')
  const [pageCount, setPageCount] = useState(String(DEFAULT_PAGE_COUNT))
  const [selectedStyleId, setSelectedStyleId] = useState('')
  const [styleOptions, setStyleOptions] = useState<
    Array<{ id: string; label: string; description: string }>
  >([])
  const [parsingDocument, setParsingDocument] = useState(false)
  const [importingPptx, setImportingPptx] = useState(false)
  const [pptxImportProgress, setPptxImportProgress] = useState<string | null>(null)
  const [documentParseError, setDocumentParseError] = useState<string | null>(null)
  const [referenceDocumentPath, setReferenceDocumentPath] = useState<string | null>(null)
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const pptxInputRef = useRef<HTMLInputElement | null>(null)

  const validateForm = (): string => {
    const topicText = topic.trim()
    if (!topicText) return '请填写主题。'

    if (!styleOptions.length) return '风格列表加载中，请稍后重试。'
    if (!selectedStyleId) return '请先选择风格。'
    const selectedStyle = styleOptions.find((option) => option.id === selectedStyleId)
    if (!selectedStyle) return '当前风格不存在，请重新选择。'

    const pageCountText = pageCount.trim()
    if (!pageCountText) return `请填写页数（${MIN_PAGE_COUNT}-${MAX_PAGE_COUNT}）。`
    if (!/^\d+$/.test(pageCountText)) return '页数只能是数字。'
    const rawPageCount = Number.parseInt(pageCountText, 10)
    if (rawPageCount < MIN_PAGE_COUNT || rawPageCount > MAX_PAGE_COUNT) {
      return `页数需在 ${MIN_PAGE_COUNT}-${MAX_PAGE_COUNT} 之间。`
    }

    const briefText = brief.trim()
    if (!briefText) return '请填写详细描述。'

    const provider = settings?.provider
    const providerConfig = provider ? settings?.providerConfigs?.[provider] : undefined
    const resolvedApiKey = (providerConfig?.apiKey || '').trim()
    const resolvedModel = (providerConfig?.model || '').trim()
    const resolvedStoragePath = (settings?.storagePath || '').trim()
    if (!resolvedApiKey || !resolvedModel || !resolvedStoragePath) return SETTINGS_REQUIRED_MESSAGE

    return ''
  }

  const requiredReady = (() => {
    const topicText = topic.trim()
    const pageCountText = pageCount.trim()
    const briefText = brief.trim()
    if (!topicText || !selectedStyleId || !briefText) return false
    if (!/^\d+$/.test(pageCountText)) return false
    const n = Number.parseInt(pageCountText, 10)
    return n >= MIN_PAGE_COUNT && n <= MAX_PAGE_COUNT
  })()

  useEffect(() => {
    ipc
      .getStyles()
      .then(({ categories }) => {
        const flat = Object.values(categories).flat()
        setStyleOptions(flat)
        setSelectedStyleId(flat.length > 0 ? flat[0].id : '')
      })
      .catch((err) => {
        error('风格加载失败', {
          description: err instanceof Error ? err.message : '请稍后重试'
        })
      })
  }, [error])

  const handleSubmit = async (): Promise<void> => {
    const validationError = validateForm()
    if (validationError) {
      if (validationError === SETTINGS_REQUIRED_MESSAGE) {
        warning('系统设置未完成', {
          description: SETTINGS_REQUIRED_MESSAGE,
          action: {
            label: '去设置',
            onClick: () => navigate('/settings')
          }
        })
        return
      }
      warning('请完善创建信息', { description: validationError })
      return
    }
    const selectedStyle = styleOptions.find((option) => option.id === selectedStyleId)!
    const topicText = topic.trim()
    const briefText = brief.trim()
    const safePageCount = Number.parseInt(pageCount.trim(), 10)
    const initialPrompt =
      briefText ||
      `请围绕"${topicText || '未命名主题'}"生成一份 ${safePageCount} 页、风格为 ${selectedStyle.label} 的演示稿。`

    try {
      const sessionId = await createSession({
        topic: topicText,
        styleId: selectedStyleId,
        pageCount: safePageCount,
        referenceDocumentPath: referenceDocumentPath || undefined
      })
      success('会话创建成功', {
        description: `已开始生成创意`,
        duration: 1000
      })
      setPageCount(String(safePageCount))
      navigate(`/sessions/${sessionId}/generating`, {
        state: {
          initialPrompt
        }
      })
    } catch (err) {
      error('会话创建失败', {
        description: err instanceof Error ? err.message : '请稍后重试'
      })
    }
  }

  const handleParseDocumentClick = (): void => {
    if (parsingDocument) return
    documentInputRef.current?.click()
  }

  const handleImportPptxClick = (): void => {
    if (importingPptx) return
    pptxInputRef.current?.click()
  }

  const handleDocumentFilesSelected = async (files: FileList | null): Promise<void> => {
    const selectedFiles = Array.from(files || [])
    if (documentInputRef.current) {
      documentInputRef.current.value = ''
    }
    if (selectedFiles.length === 0) return
    if (selectedFiles.length > 1) {
      const message = '一次只能上传一个文档，请重新选择。'
      setDocumentParseError(message)
      error('文档数量超出限制', {
        description: message
      })
      return
    }
    const selectedFile = selectedFiles[0]
    if (selectedFile.size > MAX_DOCUMENT_SIZE_BYTES) {
      const message = `单个文档不能超过 ${MAX_DOCUMENT_SIZE_MB}MB，请压缩或拆分后再上传。`
      setDocumentParseError(message)
      error('文档过大', {
        description: message
      })
      return
    }

    const payloadFiles = selectedFiles
      .map((file) => ({
        path: window.electron?.getPathForFile?.(file) || '',
        name: file.name
      }))
      .filter((file) => file.path)

    if (payloadFiles.length === 0) {
      setDocumentParseError('无法读取文档路径，请重新选择本地文档。')
      error('无法读取文档路径')
      return
    }

    const safePageCount = /^\d+$/.test(pageCount.trim())
      ? resolvePageCount(pageCount.trim())
      : DEFAULT_PAGE_COUNT

    setParsingDocument(true)
    setDocumentParseError(null)
    try {
      const result = await ipc.parseDocumentPlan({
        files: payloadFiles,
        topic: topic.trim(),
        pageCount: safePageCount,
        existingBrief: brief.trim()
      })
      setTopic(result.topic)
      setPageCount(String(result.pageCount))
      setBrief(result.briefText)
      setReferenceDocumentPath(result.files[0]?.path || null)
      success('文档解析完成', {
        description: `已整理 ${result.files.length} 个文档并填入主题、页数和详细描述`
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '请稍后重试'
      setDocumentParseError(message)
      error('文档解析失败', {
        description: message
      })
    } finally {
      setParsingDocument(false)
    }
  }

  const handlePptxFilesSelected = async (files: FileList | null): Promise<void> => {
    const selectedFiles = Array.from(files || [])
    if (pptxInputRef.current) {
      pptxInputRef.current.value = ''
    }
    if (selectedFiles.length === 0) return
    if (selectedFiles.length > 1) {
      error('PPTX 数量超出限制', {
        description: '一次只能导入一个 PPTX 文件。'
      })
      return
    }
    const selectedFile = selectedFiles[0]
    if (!/\.pptx$/i.test(selectedFile.name)) {
      error('文件格式不支持', {
        description: '请上传 .pptx 文件。'
      })
      return
    }
    if (selectedFile.size > MAX_PPTX_SIZE_BYTES) {
      error('PPTX 文件过大', {
        description: `单个 PPTX 不能超过 ${MAX_PPTX_SIZE_MB}MB。`
      })
      return
    }
    const filePath = window.electron?.getPathForFile?.(selectedFile) || ''
    if (!filePath) {
      error('无法读取 PPTX 路径', {
        description: '请重新选择本地 PPTX 文件。'
      })
      return
    }

    setImportingPptx(true)
    setPptxImportProgress('正在准备导入 PPTX…')
    try {
      const result = await ipc.importPptx({
        filePath,
        title: selectedFile.name.replace(/\.pptx$/i, ''),
        styleId: selectedStyleId || null
      })
      success('PPTX 导入完成', {
        description:
          result.warnings.length > 0
            ? `已导入 ${result.pageCount} 页，存在 ${result.warnings.length} 条降级提示。`
            : `已导入 ${result.pageCount} 页。`
      })
      navigate(`/sessions/${result.sessionId}`)
    } catch (err) {
      error('PPTX 导入失败', {
        description: err instanceof Error ? err.message : '请稍后重试'
      })
    } finally {
      setImportingPptx(false)
      setPptxImportProgress(null)
    }
  }

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    // 提前注册，避免主进程导入刚开始时的进度事件丢失。
    return ipc.onPptxImportProgress((payload) => {
      setPptxImportProgress(`${payload.label}${payload.progress ? ` · ${payload.progress}%` : ''}`)
    })
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          Unleash your creativity
        </p>
        <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">
          开始一个新的演示任务
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          内置30+风格，支持自定义风格，Chart.js 图表库与 anime.js 动画引擎，采用「任务下发 →
          会话细化」的渐进式协作模式。
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <TooltipProvider delayDuration={180}>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleParseDocumentClick}
                        disabled={parsingDocument || importingPptx}
                        className="shrink-0"
                      >
                        {parsingDocument ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="mr-2 h-4 w-4" />
                        )}
                        {parsingDocument ? '解析中…' : '上传文档自动解析'}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    支持 txt、md、csv、docx，单个不超过 {MAX_DOCUMENT_SIZE_MB}MB。解析后会自动填充主题、页数和详细描述，这里填入的是文档大纲；后续生成会继续参考实际文档内容进行 AI 创意生成。
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleImportPptxClick}
                        disabled={importingPptx || parsingDocument}
                        className="shrink-0"
                      >
                        {importingPptx ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileUp className="mr-2 h-4 w-4" />
                        )}
                        {importingPptx ? '导入中…' : '导入 PPTX 直接AI编辑'}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    支持导入 .pptx 文件，单个不超过 {MAX_PPTX_SIZE_MB}MB。导入后会转换成可编辑页面。
                  </TooltipContent>
                </Tooltip>

                {referenceDocumentPath && !parsingDocument ? (
                  <span className="rounded-full bg-[#e8f0df] px-2.5 py-1 text-xs text-[#4f6340]">
                    已解析
                  </span>
                ) : null}
              </div>
            </TooltipProvider>

            {pptxImportProgress ? (
              <p className="min-w-0 text-xs text-[#4f6340]">{pptxImportProgress}</p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            你的所有文档都只会存在本地，只是解析为 AI 可读文档。
          </p>

          <input
            ref={documentInputRef}
            type="file"
            accept=".md,.txt,.text,.csv,.docx"
            multiple={false}
            className="hidden"
            onChange={(event) => void handleDocumentFilesSelected(event.target.files)}
          />
          <input
            ref={pptxInputRef}
            type="file"
            accept=".pptx"
            multiple={false}
            className="hidden"
            onChange={(event) => void handlePptxFilesSelected(event.target.files)}
          />
        </div>
        {documentParseError && (
          <div className="flex items-start gap-2 rounded-md border border-[#d58b7f]/45 bg-[#fff2ef] px-3 py-2 text-xs text-[#8a3d33]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{documentParseError}</span>
          </div>
        )}

        <Card className="mb-6">
          <CardContent className="space-y-5 py-7">
            <div>
              <label className="mb-2 block text-sm font-medium">主题</label>
              <Input
                placeholder="例如：2026 年 AI Agent 产品路线图"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <label className="mb-2 block text-sm font-medium">风格</label>
                <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择风格" />
                  </SelectTrigger>
                  <SelectContent>
                    {styleOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        <span className="flex items-baseline gap-1.5">
                          {option.label}
                          {option.description && (
                            <span className="text-xs text-muted-foreground/60">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">页数</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder={`${MIN_PAGE_COUNT}-${MAX_PAGE_COUNT}`}
                  value={pageCount}
                  required
                  onChange={(e) => {
                    const next = e.target.value
                    if (next === '') {
                      setPageCount('')
                      return
                    }
                    if (!/^\d+$/.test(next)) return
                    setPageCount(next)
                  }}
                  onBlur={() => {
                    setPageCount(String(resolvePageCount(pageCount)))
                  }}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">详细描述</label>
              <Textarea
                placeholder="描述你的简要需求、核心结论、希望保留的数据点，以及你想要的讲述节奏"
                rows={8}
                value={brief}
                required
                onChange={(e) => setBrief(e.target.value)}
                className="resize-y"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              void handleSubmit()
            }}
            className="w-full md:w-auto"
            disabled={loading || !requiredReady}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {loading ? '创建中…' : '创建会话并开始'}
          </Button>
        </div>
      </div>
    </div>
  )
}
