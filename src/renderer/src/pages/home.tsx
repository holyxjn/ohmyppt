import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Input'
import { Card, CardContent } from '../components/ui/Card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/Select'
import { Sparkles } from 'lucide-react'
import { useSessionStore } from '../store'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import { ipc } from '@renderer/lib/ipc'

const MIN_PAGE_COUNT = 1
const MAX_PAGE_COUNT = 20
const DEFAULT_PAGE_COUNT = 5
const SETTINGS_REQUIRED_MESSAGE = '请先前往系统设置完成模型与存储目录配置。'

const resolvePageCount = (raw: string): number => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_COUNT
  return Math.min(MAX_PAGE_COUNT, Math.max(MIN_PAGE_COUNT, parsed))
}

export function HomePage() {
  const navigate = useNavigate()
  const { createSession, loading } = useSessionStore()
  const { settings, fetchSettings } = useSettingsStore()
  const { success, error, warning } = useToastStore()
  const [topic, setTopic] = useState('')
  const [brief, setBrief] = useState('')
  const [pageCount, setPageCount] = useState(String(DEFAULT_PAGE_COUNT))
  const [selectedStyleId, setSelectedStyleId] = useState('')
  const [styleOptions, setStyleOptions] = useState<Array<{ id: string; label: string; description: string }>>([])

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
          description: err instanceof Error ? err.message : '请稍后重试',
        })
      })
  }, [error])

  const handleSubmit = async () => {
    const validationError = validateForm()
    if (validationError) {
      if (validationError === SETTINGS_REQUIRED_MESSAGE) {
        warning('系统设置未完成', {
          description: SETTINGS_REQUIRED_MESSAGE,
          action: {
            label: '去设置',
            onClick: () => navigate('/settings'),
          },
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
    const initialPrompt = briefText || `请围绕"${topicText || '未命名主题'}"生成一份 ${safePageCount} 页、风格为 ${selectedStyle.label} 的演示稿。`

    try {
      const sessionId = await createSession({
        topic: topicText,
        styleId: selectedStyleId,
        pageCount: safePageCount,
      })
      success('会话创建成功', {
        description: `已开始生成创意`,
        duration: 1000,
      })
      setPageCount(String(safePageCount))
        navigate(`/sessions/${sessionId}/generating`, {
        state: {
          initialPrompt,
        },
      })
    } catch (err) {
      error('会话创建失败', {
        description: err instanceof Error ? err.message : '请稍后重试',
      })
    }
  }

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          Unleash your creativity
        </p>
        <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">开始一个新的演示任务</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          内置30+风格，支持自定义风格，Chart.js 图表库与 anime.js 动画引擎，采用「任务下发 → 会话细化」的渐进式协作模式。
        </p>
      </div>

      <div>
        <Card className="mb-6">
          <CardContent className="space-y-4 py-8">
            <div>
              <label className="mb-2 block text-sm font-medium">主题</label>
              <Input
                placeholder="例如：2026 年 AI Agent 产品路线图"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              />
            </div>

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
                          <span className="text-xs text-muted-foreground/60">{option.description}</span>
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

            <div>
              <label className="mb-2 block text-sm font-medium">详细描述</label>
              <Textarea
                placeholder="描述你的简要需求、核心结论、希望保留的数据点，以及你想要的讲述节奏。"
                rows={8}
                value={brief}
                required
                onChange={(e) => setBrief(e.target.value)}
                className="resize-y"
              />
            </div>
          </CardContent>
        </Card>

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
  )
}
