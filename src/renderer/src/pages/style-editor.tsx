import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Input, Textarea } from '../components/ui/Input'
import { ScrollArea } from '../components/ui/ScrollArea'
import { useToastStore } from '../store'
import { ipc, type StyleDetail, type StyleParseResult } from '@renderer/lib/ipc'
import ReactMarkdown from 'react-markdown'
import { ArrowLeft, Eye, Import, Loader2, Pencil, Save, Trash2 } from 'lucide-react'
import { useT } from '../i18n'

const MAX_STYLE_TEXT_FILE_SIZE_MB = 1
const MAX_STYLE_PPTX_FILE_SIZE_MB = 80
const MAX_STYLE_IMAGE_SIZE_MB = 5
const MAX_STYLE_TEXT_FILE_SIZE_BYTES = MAX_STYLE_TEXT_FILE_SIZE_MB * 1024 * 1024
const MAX_STYLE_PPTX_FILE_SIZE_BYTES = MAX_STYLE_PPTX_FILE_SIZE_MB * 1024 * 1024
const MAX_STYLE_IMAGE_SIZE_BYTES = MAX_STYLE_IMAGE_SIZE_MB * 1024 * 1024
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const isPptxFileName = (name: string): boolean => /\.pptx$/i.test(name.trim())
const isImageFileName = (name: string): boolean => /\.(png|jpe?g|webp)$/i.test(name.trim())
const getImageMimeTypeFromFileName = (name: string): string => {
  const normalized = name.trim().toLowerCase()
  if (normalized.endsWith('.png')) return 'image/png'
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.webp')) return 'image/webp'
  return ''
}

export function StyleEditorPage(): React.JSX.Element {
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
  const [importing, setImporting] = useState(false)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const styleFileInputRef = useRef<HTMLInputElement | null>(null)
  const { success, error, warning, info } = useToastStore()
  const t = useT()

  useEffect(() => {
    const run = async (): Promise<void> => {
      setLoading(true)
      try {
        if (isNew) {
          const initial: StyleDetail = {
            id: '',
            label: t('styleEditor.defaultLabel'),
            description: t('styleEditor.defaultDescription'),
            aliases: [],
            styleSkill: t('styleEditor.template'),
            source: 'custom',
            editable: true,
            category: t('styleEditor.defaultCategory'),
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
        error(t('styleEditor.detailLoadFailed'), {
          description: e instanceof Error ? e.message : t('common.retryLater'),
        })
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [error, isNew, styleId, t])

  const currentStyleName = useMemo(
    () => (isNew ? t('styleEditor.createTitle') : t('styleEditor.editTitle')),
    [isNew, t]
  )

  const handleSave = async (): Promise<void> => {
    if (!draft) return
    const nextLabel = labelInput.trim()
    const nextDescription = descriptionInput.trim()
    const nextMarkdown = markdownInput.trim()
    const shouldCreate = isNew || !loadedRecordId

    if (!shouldCreate && !draft.id.trim()) {
      warning(t('styleEditor.invalidStyleId'), { description: t('styleEditor.backAndRetry') })
      return
    }
    if (!nextLabel) {
      warning(t('styleEditor.fillName'))
      return
    }
    if (!nextMarkdown) {
      warning(t('styleEditor.fillPrompt'))
      return
    }
    setSaving(true)
    try {
      const createPayload = {
        label: nextLabel,
        description: nextDescription,
        category: draft.category || t('styleEditor.defaultCategory'),
        aliases: draft.aliases || [],
        styleSkill: nextMarkdown
      }
      const result = shouldCreate
        ? await ipc.createStyle(createPayload)
        : await ipc.updateStyle({
            ...createPayload,
            id: draft.id.trim().toLowerCase()
          })
      setLoadedRecordId(result.id)
      success(t('styleEditor.saved'), {
        description:
          result.source === 'override' ? t('styleEditor.savedOverride') : t('styleEditor.savedCustom')
      })
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              id: result.id,
              label: createPayload.label,
              description: createPayload.description,
              category: createPayload.category,
              aliases: createPayload.aliases,
              styleSkill: createPayload.styleSkill
            }
          : prev
      )
      navigate('/styles', { replace: true })
    } catch (e) {
      error(t('styleEditor.saveFailed'), {
        description: e instanceof Error ? e.message : t('common.retryLater'),
      })
    } finally {
      setSaving(false)
    }
  }

  const ensureUploadPrerequisites = async (): Promise<boolean> => {
    const validation = await ipc.validateUploadPrerequisites()
    if (validation.ready) return true
    warning(t('home.settingsRequiredTitle'), {
      description: validation.message || t('home.settingsRequired'),
      action: {
        label: t('home.goToSettings'),
        onClick: () => navigate('/settings')
      }
    })
    return false
  }

  const handleImportStyleClick = async (): Promise<void> => {
    if (importing) return
    if (!(await ensureUploadPrerequisites())) return
    styleFileInputRef.current?.click()
  }

  const applyParsedStyle = (result: StyleParseResult): void => {
    setLabelInput(result.label)
    setDescriptionInput(result.description)
    setMarkdownInput(result.styleSkill)
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            label: result.label,
            description: result.description,
            category: result.category,
            aliases: result.aliases,
            styleSkill: result.styleSkill
          }
        : prev
    )
  }

  const parseSelectedStyleFile = async (file: File): Promise<StyleParseResult> => {
    const isPptx = isPptxFileName(file.name || '')
    const maxSizeBytes = isPptx ? MAX_STYLE_PPTX_FILE_SIZE_BYTES : MAX_STYLE_TEXT_FILE_SIZE_BYTES
    const maxSizeMb = isPptx ? MAX_STYLE_PPTX_FILE_SIZE_MB : MAX_STYLE_TEXT_FILE_SIZE_MB
    if (file.size > maxSizeBytes) {
      throw new Error(t('styleEditor.fileTooLarge', { maxSize: maxSizeMb }))
    }

    const filePath = window.electron?.getPathForFile?.(file) || ''
    if (!filePath) {
      throw new Error(t('styleEditor.filePathFailed'))
    }

    return isPptx ? await ipc.parseStylePptx({ filePath }) : await ipc.parseStyleFile({ filePath })
  }

  const parseSelectedStyleImage = async (file: File): Promise<StyleParseResult> => {
    const hintedMimeType = (file.type || '').toLowerCase()
    const fallbackMimeType = getImageMimeTypeFromFileName(file.name || '')
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(hintedMimeType) && !fallbackMimeType) {
      throw new Error(t('styleEditor.imageFormatInvalid'))
    }
    if (file.size > MAX_STYLE_IMAGE_SIZE_BYTES) {
      throw new Error(t('styleEditor.fileTooLarge', { maxSize: MAX_STYLE_IMAGE_SIZE_MB }))
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error(t('styleEditor.imageReadFailed')))
      reader.readAsDataURL(file)
    })
    const match = dataUrl.match(/^data:([^;]*);base64,(.+)$/)
    if (!match) {
      throw new Error(t('styleEditor.imageReadFailed'))
    }
    const dataUrlMimeType = String(match[1] || '').trim().toLowerCase()
    const mimeType = SUPPORTED_IMAGE_MIME_TYPES.has(dataUrlMimeType)
      ? dataUrlMimeType
      : SUPPORTED_IMAGE_MIME_TYPES.has(hintedMimeType)
        ? hintedMimeType
        : fallbackMimeType
    const imageBase64 = String(match[2] || '').trim()
    if (!mimeType || !imageBase64) {
      throw new Error(t('styleEditor.imageReadFailed'))
    }
    return await ipc.parseStyleImage({ imageBase64, mimeType })
  }

  const handleStyleFileSelected = async (files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (styleFileInputRef.current) styleFileInputRef.current.value = ''
    if (!file) return
    if (!(await ensureUploadPrerequisites())) return

    setImporting(true)
    try {
      const isImage = SUPPORTED_IMAGE_MIME_TYPES.has((file.type || '').toLowerCase()) || isImageFileName(file.name || '')
      const result = isImage ? await parseSelectedStyleImage(file) : await parseSelectedStyleFile(file)
      applyParsedStyle(result)
      success(t('styleEditor.importSuccess'))
    } catch (e) {
      error(t('styleEditor.importFailed'), {
        description: e instanceof Error ? e.message : t('common.retryLater')
      })
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const result = await ipc.deleteStyle(draft.id)
      if (!result.deleted) {
        warning(t('styleEditor.cannotDelete'), {
          description: result.message || t('styleEditor.builtinCannotDelete'),
        })
        return
      }
      info(t('styleEditor.deleted'))
      navigate('/styles', { replace: true })
    } catch (e) {
      error(t('styleEditor.deleteFailed'), {
        description: e instanceof Error ? e.message : t('common.retryLater'),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('styleEditor.eyebrow')}</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="organic-serif text-[32px] font-semibold leading-none text-[#3e4a32]">{currentStyleName}</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <Button size="sm" variant="secondary" className="min-w-[112px]" onClick={() => navigate('/styles')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('styleEditor.backToList')}
            </Button>
          </div>
        </div>
      </div>

      {loading || !draft ? (
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">{t('styleEditor.loading')}</CardContent>
        </Card>
      ) : (
        <>
          {isNew ? (
            <div className="mb-4 space-y-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void handleImportStyleClick()
                }}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Import className="mr-2 h-4 w-4" />
                )}
                {importing ? t('styleEditor.importing') : t('styleEditor.importStyle')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t('styleEditor.importHint', {
                  textMaxSize: MAX_STYLE_TEXT_FILE_SIZE_MB,
                  pptxMaxSize: MAX_STYLE_PPTX_FILE_SIZE_MB,
                  imageMaxSize: MAX_STYLE_IMAGE_SIZE_MB
                })}
              </p>
            </div>
          ) : null}
          <input
            ref={styleFileInputRef}
            type="file"
            accept=".md,.txt,.html,.htm,.pptx,image/png,image/jpeg,image/webp"
            multiple={false}
            className="hidden"
            onChange={(e) => void handleStyleFileSelected(e.target.files)}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('styleEditor.skillMarkdown')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">{t('styleEditor.name')}</label>
                <Input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">{t('styleEditor.descriptionLabel')}</label>
                <Input
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  placeholder={t('styleEditor.descriptionPlaceholder')}
                />
              </div>
            </div>
            <div className="rounded-lg border border-[#d9ccb4]/70 bg-[#f8f0e2]/72 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#5d6f4d]">{t('styleEditor.writingTips')}</p>
              <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-[#5b6b4d]">
                <li>{t('styleEditor.tipStructure')}</li>
                <li>{t('styleEditor.tipAnimation')}</li>
                <li>{t('styleEditor.tipNatural')}</li>
                <li>{t('styleEditor.tipReadable')}</li>
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
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('preview')}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t('common.preview')}
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
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('preview')}
                      className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t('common.preview')}
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
                    {markdownInput || t('styleEditor.emptyMarkdown')}
                  </ReactMarkdown>
                </ScrollArea>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? t('common.saving') : t('styleEditor.saveStyle')}
              </Button>
              <Button variant="outline" onClick={handleDelete} disabled={saving}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t('common.delete')}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('styleEditor.currentMode', {
                mode: draft.source === 'builtin' ? t('styleEditor.builtinMode') : draft.source || ''
              })}
            </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
