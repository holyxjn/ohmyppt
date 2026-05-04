import { useEffect, useState } from 'react'
import { Check, Crosshair, Loader2, Move, Sparkles, Type } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import { Button } from '../ui/Button'
import { PreviewIframe } from '../preview/PreviewIframe'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import type { DragEditorMovePayload } from '../preview/drag-editor-script'
import type { TextEditorSelectionPayload } from '../preview/text-editor-types'
import { ElementInspectorPanel, type ElementEditDraft } from './ElementInspectorPanel'
import type { InspectorPanelPosition } from './ElementInspectorPanel'
import type { SessionPreviewPage } from './types'
import { useT } from '@renderer/i18n'

export function PreviewStage({
  selectedPage,
  sessionTitle,
  isGenerating,
  progressLabel,
  previewRefreshKey = 0,
  pendingDragCount = 0,
  isSavingDragEdits = false,
  textSelection,
  textDraft,
  isSavingTextEdit = false,
  onTextDraftChange,
  onElementMoved,
  onTextSelected,
  onSaveTextEdit,
  onCancelTextEdit,
  onSaveDragEdits,
  onCancelDragEdits
}: {
  selectedPage: SessionPreviewPage | null
  sessionTitle?: string | null
  isGenerating: boolean
  progressLabel?: string
  previewRefreshKey?: number
  pendingDragCount?: number
  isSavingDragEdits?: boolean
  textSelection: TextEditorSelectionPayload | null
  textDraft: ElementEditDraft
  isSavingTextEdit?: boolean
  onTextDraftChange: (draft: ElementEditDraft) => void
  onElementMoved: (payload: DragEditorMovePayload) => void
  onTextSelected: (payload: TextEditorSelectionPayload) => void
  onSaveTextEdit: () => void
  onCancelTextEdit: () => void
  onSaveDragEdits: () => void
  onCancelDragEdits: () => void
}): React.JSX.Element {
  const t = useT()
  const previewKey = useSessionDetailUiStore((state) => state.previewKey)
  const inspecting = useSessionDetailUiStore((state) => state.inspecting)
  const dragEditing = useSessionDetailUiStore((state) => state.dragEditing)
  const textEditing = useSessionDetailUiStore((state) => state.textEditing)
  const setInspecting = useSessionDetailUiStore((state) => state.setInspecting)
  const setDragEditing = useSessionDetailUiStore((state) => state.setDragEditing)
  const setTextEditing = useSessionDetailUiStore((state) => state.setTextEditing)
  const setSelectedElement = useSessionDetailUiStore((state) => state.setSelectedElement)
  const [inspectorPanelPosition, setInspectorPanelPosition] =
    useState<InspectorPanelPosition | null>(null)
  const displayTitle = sessionTitle || t('sessionDetail.sessionFallback')

  useEffect(() => {
    if (!inspecting && !dragEditing && !textEditing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setInspecting(false)
        if (dragEditing && pendingDragCount > 0) {
          onCancelDragEdits()
        }
        setDragEditing(false)
        setTextEditing(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    dragEditing,
    inspecting,
    onCancelDragEdits,
    pendingDragCount,
    setDragEditing,
    setInspecting,
    setTextEditing,
    textEditing
  ])

  return (
    <main className="flex min-h-0 flex-1 flex-col px-3 py-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[2rem] bg-[#e8e0d0]/54 p-3 shadow-[0_24px_54px_rgba(93,107,77,0.15)]">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#d4e4c1]/48" />
        <div className="pointer-events-none absolute -bottom-24 left-8 h-48 w-64 rounded-[5%_95%_10%_90%/85%_15%_85%_15%] bg-[#c8b89e]/22" />
        {selectedPage ? (
          <div className="relative h-full overflow-hidden rounded-[1.55rem] bg-[#f5f1e8] p-2 shadow-[0_14px_32px_rgba(93,107,77,0.14)]">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute left-5 top-5 z-20 w-[clamp(250px,38%,500px)] truncate rounded-[8px] bg-[#f5f1e8]/82 px-3 py-1 text-sm font-semibold tracking-[0.01em] text-[#3e4a32] shadow-[0_6px_18px_rgba(93,107,77,0.11)] backdrop-blur-md">
                  {displayTitle}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                {displayTitle}
              </TooltipContent>
            </Tooltip>
            <PreviewIframe
              key={`preview-${selectedPage.pageId}-${previewKey}-${previewRefreshKey}`}
              src={selectedPage.sourceUrl}
              htmlPath={selectedPage.htmlPath}
              pageId={selectedPage.pageId}
              title={`preview-page-${selectedPage.pageNumber}`}
              inspectable
              inspecting={inspecting}
              dragEditing={dragEditing}
              textEditing={textEditing}
              onSelectorSelected={setSelectedElement}
              onElementMoved={onElementMoved}
              onTextSelected={onTextSelected}
              onInspectExit={() => {
                setInspecting(false)
                setDragEditing(false)
                setTextEditing(false)
                onCancelTextEdit()
              }}
            />
            {selectedPage.htmlPath && (
              <div className="absolute right-5 top-5 z-20 flex items-center gap-2">
                <Button
                  type="button"
                  variant={dragEditing ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'rounded-[8px] px-2.5 text-[11px] leading-none shadow-[0_8px_20px_rgba(93,107,77,0.14)]',
                    dragEditing
                      ? 'bg-[#5d6b4d] text-white'
                      : 'border-transparent bg-[#d4e4c1]/86 text-[#3e4a32] hover:bg-[#c8ddb2]'
                  )}
                  onClick={() => {
                    if (dragEditing && pendingDragCount > 0) {
                      onCancelDragEdits()
                    }
                    setDragEditing(!dragEditing)
                    setInspecting(false)
                    setTextEditing(false)
                  }}
                  disabled={isGenerating || isSavingDragEdits}
                >
                  <Move className="mr-1 h-3 w-3" />
                  {dragEditing
                    ? pendingDragCount > 0
                      ? t('sessionDetail.exitWithoutSaving')
                      : t('sessionDetail.exitAdjust')
                    : t('sessionDetail.adjustLayout')}
                </Button>
                {dragEditing && pendingDragCount > 0 && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="rounded-[8px] bg-[#5d6b4d] px-2.5 text-[11px] leading-none text-white shadow-[0_8px_20px_rgba(93,107,77,0.16)]"
                    onClick={onSaveDragEdits}
                    disabled={isGenerating || isSavingDragEdits}
                  >
                    {isSavingDragEdits ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-3 w-3" />
                    )}
                    {t('sessionDetail.saveAdjustments')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant={inspecting ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'rounded-[8px] px-2.5 text-[11px] leading-none shadow-[0_8px_20px_rgba(93,107,77,0.14)]',
                    inspecting
                      ? 'bg-[#5d6b4d] text-white'
                      : 'border-transparent bg-[#d4e4c1]/86 text-[#3e4a32] hover:bg-[#c8ddb2]'
                  )}
                  onClick={() => {
                    setInspecting(!inspecting)
                    if (dragEditing && pendingDragCount > 0) {
                      onCancelDragEdits()
                    }
                    setDragEditing(false)
                    setTextEditing(false)
                  }}
                  disabled={isGenerating || isSavingDragEdits}
                >
                  <Crosshair className="mr-1 h-3 w-3" />
                  {inspecting ? t('sessionDetail.exitInspect') : t('sessionDetail.inspectElement')}
                </Button>
              </div>
            )}
            {selectedPage.htmlPath && (
              <div className="absolute bottom-5 right-5 z-20 rounded-[12px] border border-[#d9cfbd]/72 bg-[#fffaf1]/90 p-1 shadow-[0_14px_34px_rgba(74,59,42,0.16)] backdrop-blur-xl">
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-9 min-w-[86px] items-center justify-center rounded-[9px] px-3 text-xs font-semibold transition-colors',
                      !textEditing
                        ? 'bg-[#5d6b4d] text-white shadow-[0_7px_16px_rgba(93,107,77,0.2)]'
                        : 'text-[#59664b] hover:bg-[#e8e0d0]/74'
                    )}
                    onClick={() => {
                      setTextEditing(false)
                      onCancelTextEdit()
                    }}
                    disabled={isGenerating || isSavingDragEdits || isSavingTextEdit}
                    aria-pressed={!textEditing}
                  >
                    {t('sessionDetail.previewMode')}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-9 min-w-[104px] items-center justify-center rounded-[9px] px-3 text-xs font-semibold transition-colors',
                      textEditing
                        ? 'bg-[#5d6b4d] text-white shadow-[0_7px_16px_rgba(93,107,77,0.2)]'
                        : 'text-[#59664b] hover:bg-[#d4e4c1]/78'
                    )}
                    onClick={() => {
                      const nextTextEditing = !textEditing
                      setTextEditing(nextTextEditing)
                      setInspecting(false)
                      if (dragEditing && pendingDragCount > 0) {
                        onCancelDragEdits()
                      }
                      setDragEditing(false)
                      if (!nextTextEditing) onCancelTextEdit()
                    }}
                    disabled={isGenerating || isSavingDragEdits || isSavingTextEdit}
                    aria-pressed={textEditing}
                  >
                    <Type className="mr-1.5 h-3.5 w-3.5" />
                    {textEditing ? t('sessionDetail.exitEditMode') : t('sessionDetail.editMode')}
                  </button>
                </div>
              </div>
            )}
            {textEditing && textSelection && (
              <ElementInspectorPanel
                selection={textSelection}
                draft={textDraft}
                isSaving={isSavingTextEdit}
                position={inspectorPanelPosition}
                onDraftChange={onTextDraftChange}
                onSave={onSaveTextEdit}
                onCancel={onCancelTextEdit}
                onPositionChange={setInspectorPanelPosition}
              />
            )}
            {selectedPage.status === 'failed' && (
              <div className="absolute bottom-5 left-5 z-20 max-w-[520px] rounded-[1rem] bg-[#fff4ef]/92 px-3 py-2 text-xs text-[#8e5a53] shadow-[0_10px_24px_rgba(142,90,83,0.12)] backdrop-blur-sm">
                {t('sessionDetail.failedPageHint')}
              </div>
            )}
            {inspecting && (
              <div className="pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full bg-[#eff5ff]/90 px-2.5 py-1.5 text-[11px] leading-none text-[#375f97] shadow-[0_8px_18px_rgba(55,95,151,0.12)] backdrop-blur-sm">
                {t('sessionDetail.clickToSelect')}
              </div>
            )}
            {textEditing && (
              <div className="pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full bg-[#f1faee]/92 px-2.5 py-1.5 text-[11px] leading-none text-[#3f6f34] shadow-[0_8px_18px_rgba(63,111,52,0.12)] backdrop-blur-sm">
                {t('sessionDetail.clickTextToEdit')}
              </div>
            )}
            {isGenerating && (
              <div className="absolute inset-0 flex items-center justify-center rounded-[1.55rem] bg-[#f5f1e8]/68 backdrop-blur-sm transition-opacity">
                <div className="flex flex-col items-center gap-3 rounded-[1.5rem] bg-[#e8e0d0]/88 px-8 py-5 shadow-[0_20px_44px_rgba(93,107,77,0.16)]">
                  <Loader2 className="h-6 w-6 animate-spin text-[#6f8159]" />
                  {progressLabel ? <p className="text-sm text-[#5a674b]">{progressLabel}</p> : null}
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
              <p className="text-base font-medium text-[#3e4a32]">
                {t('sessionDetail.emptyPreviewTitle')}
              </p>
              <p className="text-sm">
                {isGenerating ? t('sessionDetail.preparingPreview') : t('sessionDetail.briefHint')}
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
