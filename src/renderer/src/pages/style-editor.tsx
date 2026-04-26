import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Input, Textarea } from '../components/ui/Input'
import { ScrollArea } from '../components/ui/ScrollArea'
import { useToastStore } from '../store'
import { ipc, type StyleDetail } from '@renderer/lib/ipc'
import ReactMarkdown from 'react-markdown'
import { ArrowLeft, Eye, Pencil, Save, Trash2 } from 'lucide-react'

const createNewStyleId = () => `custom-${Math.random().toString(36).slice(2, 8)}`
const NEW_STYLE_SKILL_TEMPLATE = `## 视觉
- 白色或浅色基底，保持留白与呼吸感
- 插画/图形风格统一，不混杂多套审美

## 布局
- 标题突出，内容分区清晰，信息层级明确
- 每页核心结论优先，辅助信息次级呈现

## 排版
- 标题、正文、注释形成稳定字号梯度
- 行长适中，避免大段拥挤文字

## 动画（Anime.js v4）
- 支持 Anime.js v4 风格动画，节奏自然，避免炫技
- 动画描述建议写清楚：元素、顺序、时长、缓动、是否错峰
- 入场动画建议 300-700ms，整体过渡平滑自然
- 动画用于强调层级与引导视线，不影响可读性

## 图表
- 需要图表时可明确图表类型（柱状图/折线图/饼图等）
- 颜色与页面主题保持一致，避免高饱和冲突

## 不要
- 不要使用远程 CDN 资源
- 不要堆叠过多同时运动元素
- 不要出现闪烁、眩晕感强的动画`

export function StyleEditorPage() {
  const navigate = useNavigate()
  const { styleId = 'new' } = useParams<{ styleId: string }>()
  const isNew = styleId === 'new'

  const [draft, setDraft] = useState<StyleDetail | null>(null)
  const [loadedRecordId, setLoadedRecordId] = useState<string>('')
  const [labelInput, setLabelInput] = useState('')
  const [descriptionInput, setDescriptionInput] = useState('')
  const [markdownInput, setMarkdownInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const { success, error, warning, info } = useToastStore()

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      try {
        if (isNew) {
          const nextId = createNewStyleId()
          const initial: StyleDetail = {
            id: nextId,
            label: '我的风格',
            description: '自定义风格',
            aliases: [],
            styleSkill: NEW_STYLE_SKILL_TEMPLATE,
            source: 'custom',
            editable: true,
            category: '自定义',
          }
          setDraft(initial)
          setLabelInput(initial.label)
          setDescriptionInput(initial.description || '')
          setMarkdownInput(initial.styleSkill)
          setLoadedRecordId('')
          return
        }
        const detail = await ipc.getStyleDetail(styleId)
        setDraft(detail)
        setLoadedRecordId(detail.id)
        setLabelInput(detail.label)
        setDescriptionInput(detail.description || '')
        setMarkdownInput(detail.styleSkill)
      } catch (e) {
        error('风格详情加载失败', {
          description: e instanceof Error ? e.message : '请稍后重试',
        })
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [isNew, styleId, error])

  const currentStyleName = useMemo(() => draft?.label || (isNew ? '新建风格' : styleId), [draft, isNew, styleId])

  const handleSave = async () => {
    if (!draft) return
    const nextStyleId = draft.id.trim().toLowerCase()
    const nextLabel = labelInput.trim()
    const nextDescription = descriptionInput.trim()
    const nextMarkdown = markdownInput.trim()

    if (!nextStyleId) {
      warning('当前 styleId 无效', { description: '请返回列表后重试' })
      return
    }
    if (!nextLabel) {
      warning('请先填写名称')
      return
    }
    if (!nextMarkdown) {
      warning('请先填写风格提示词')
      return
    }
    setSaving(true)
    try {
      const payload = {
        id: nextStyleId,
        label: nextLabel,
        description: nextDescription,
        category: draft.category || '自定义',
        styleSkill: nextMarkdown,
      }
      const shouldCreate = isNew || !loadedRecordId
      const result = shouldCreate
        ? await ipc.createStyle(payload)
        : await ipc.updateStyle(payload)
      setLoadedRecordId(result.id)
      success('风格已保存', {
        description: result.source === 'override' ? '已保存为覆盖内置风格' : '自定义风格已更新',
      })
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              id: payload.id,
              label: payload.label,
              description: payload.description,
              category: payload.category,
              styleSkill: payload.styleSkill,
            }
          : prev
      )
      if (styleId !== result.id) {
        navigate(`/styles/${result.id}`, { replace: true })
      }
    } catch (e) {
      error('保存失败', {
        description: e instanceof Error ? e.message : '请稍后重试',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const result = await ipc.deleteStyle(draft.id)
      if (!result.deleted) {
        warning('该风格不可删除', {
          description: result.message || '内置风格请直接编辑并保存为 override',
        })
        return
      }
      info('风格已删除')
      navigate('/styles', { replace: true })
    } catch (e) {
      error('删除失败', {
        description: e instanceof Error ? e.message : '请稍后重试',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Style Editor</p>
          <h1 className="organic-serif mt-2 text-[42px] font-semibold leading-none text-[#3e4a32]">{currentStyleName}</h1>
        </div>
        <Button variant="secondary" onClick={() => navigate('/styles')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回列表
        </Button>
      </div>

      {loading || !draft ? (
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">正在加载风格内容…</CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Skill Markdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">名称</label>
                <Input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">描述（Description）</label>
                <Input
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  placeholder="一句话描述这个风格"
                />
              </div>
            </div>
            <div className="rounded-lg border border-[#d9ccb4]/70 bg-[#f8f0e2]/72 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#5d6f4d]">Style Skill 编写建议</p>
              <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-[#5b6b4d]">
                <li>建议按“视觉 / 布局 / 排版 / 动画 / 图表 / 不要”组织内容，便于模型稳定执行。</li>
                <li>支持 Anime.js v4 动画风格，建议明确节奏、时长和动效目的。</li>
                <li>直接描述你想要的效果与节奏即可，不需要写实现细节。</li>
                <li>保持可读性优先：动画轻量、分层清晰、避免高频闪烁和大范围抖动。</li>
              </ul>
            </div>

            {mode === 'edit' ? (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-sm font-medium">Markdown</label>
                  <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                    <button
                      type="button"
                      onClick={() => setMode('edit')}
                      className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('preview')}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      预览
                    </button>
                  </div>
                </div>
                <Textarea
                  value={markdownInput}
                  onChange={(e) => setMarkdownInput(e.target.value)}
                  rows={24}
                  className="resize-y font-mono text-sm"
                />
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-sm font-medium">Markdown</label>
                  <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                    <button
                      type="button"
                      onClick={() => setMode('edit')}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('preview')}
                      className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      预览
                    </button>
                  </div>
                </div>
                <ScrollArea className="h-[400px] rounded-lg border border-border/70 bg-background/70" viewportClassName="p-5">
                  <ReactMarkdown
                    components={{
                      h1: ({ children }) => <h1 className="mb-3 text-xl font-semibold text-foreground">{children}</h1>,
                      h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold text-foreground">{children}</h2>,
                      h3: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold text-foreground">{children}</h3>,
                      p: ({ children }) => <p className="mb-2 text-sm leading-relaxed text-muted-foreground">{children}</p>,
                      ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{children}</ul>,
                      ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{children}</ol>,
                      li: ({ children }) => <li>{children}</li>,
                      code: ({ children }) => (
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{children}</code>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="mb-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">{children}</blockquote>
                      ),
                    }}
                  >
                    {markdownInput || '_暂无 Markdown 内容_'}
                  </ReactMarkdown>
                </ScrollArea>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? '保存中…' : '保存风格'}
              </Button>
              <Button variant="outline" onClick={handleDelete} disabled={saving}>
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              当前模式：{draft.source === 'builtin' ? '内置（保存时会生成 override）' : draft.source}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
