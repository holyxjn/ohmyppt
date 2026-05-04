import { GripHorizontal, Loader2, Save, X } from 'lucide-react'
import { useRef, type PointerEvent } from 'react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import type { TextEditorSelectionPayload } from '../preview/text-editor-types'
import { useT } from '@renderer/i18n'

export interface ElementEditDraft {
  text: string
  color: string
  fontSize: string
  fontWeight: string
}

export interface InspectorPanelPosition {
  x: number
  y: number
}

export function ElementInspectorPanel({
  selection,
  draft,
  isSaving,
  position,
  onDraftChange,
  onSave,
  onCancel,
  onPositionChange
}: {
  selection: TextEditorSelectionPayload | null
  draft: ElementEditDraft
  isSaving: boolean
  position: InspectorPanelPosition | null
  onDraftChange: (draft: ElementEditDraft) => void
  onSave: () => void
  onCancel: () => void
  onPositionChange: (position: InspectorPanelPosition) => void
}): React.JSX.Element {
  const t = useT()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    panelX: number
    panelY: number
  } | null>(null)

  const clampPanelPosition = (x: number, y: number): InspectorPanelPosition => {
    const panel = panelRef.current
    const parent = panel?.parentElement
    const parentWidth = parent?.clientWidth || 0
    const parentHeight = parent?.clientHeight || 0
    const panelWidth = panel?.offsetWidth || 360
    const panelHeight = panel?.offsetHeight || 420
    return {
      x: Math.max(12, Math.min(Math.max(12, parentWidth - panelWidth - 12), x)),
      y: Math.max(12, Math.min(Math.max(12, parentHeight - panelHeight - 12), y))
    }
  }

  const beginDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const panel = panelRef.current
    if (!panel) return
    const current = position ?? { x: panel.offsetLeft, y: panel.offsetTop }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panelX: current.x,
      panelY: current.y
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    onPositionChange(
      clampPanelPosition(
        state.panelX + event.clientX - state.startX,
        state.panelY + event.clientY - state.startY
      )
    )
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    dragStateRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={panelRef}
      className="absolute z-30 w-[min(360px,calc(100%-40px))] overflow-hidden rounded-[16px] border border-[#d9cfbd]/72 bg-[#fffaf1]/94 shadow-[0_20px_48px_rgba(74,59,42,0.2)] backdrop-blur-xl"
      style={position ? { left: position.x, top: position.y } : { right: 20, bottom: 80 }}
    >
      <div
        className="flex cursor-move touch-none items-center justify-between border-b border-[#dfd2bd]/70 px-3.5 py-3"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#7a875f]">
            <GripHorizontal className="h-3.5 w-3.5" />
            {t('sessionDetail.elementInspector')}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-[#34402c]">{`<${selection?.elementTag || 'text'}>`}</div>
        </div>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onCancel}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#667257] transition-colors hover:bg-[#e8e0d0]/80 hover:text-[#34402c]"
          aria-label={t('sessionDetail.closeInspector')}
          title={t('sessionDetail.closeInspector')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 px-3.5 py-3.5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[#657058]">
            {t('sessionDetail.textContent')}
          </span>
          <Textarea
            value={draft.text}
            onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
            rows={5}
            className="min-h-[136px] resize-none rounded-[12px] border-[#d7cbb7]/80 bg-[#fffdf8]/92 text-[15px] leading-6"
          />
        </label>

        <div className="grid grid-cols-[1fr_104px] gap-2.5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#657058]">
              {t('sessionDetail.textColor')}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.color || '#34402c'}
                onChange={(event) => onDraftChange({ ...draft, color: event.target.value })}
                className="h-9 w-11 shrink-0 cursor-pointer rounded-[9px] border border-[#d7cbb7]/80 bg-transparent p-1"
                aria-label={t('sessionDetail.textColor')}
              />
              <Input
                value={draft.color}
                onChange={(event) => onDraftChange({ ...draft, color: event.target.value })}
                className="h-9 rounded-[10px] px-2.5 text-xs"
              />
            </div>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#657058]">
              {t('sessionDetail.fontSize')}
            </span>
            <Input
              type="number"
              min={8}
              max={160}
              value={draft.fontSize}
              onChange={(event) => onDraftChange({ ...draft, fontSize: event.target.value })}
              className="h-9 rounded-[10px] px-2.5 text-xs"
            />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[#657058]">
            {t('sessionDetail.fontWeight')}
          </span>
          <select
            value={draft.fontWeight}
            onChange={(event) => onDraftChange({ ...draft, fontWeight: event.target.value })}
            className={cn(
              'h-9 w-full rounded-[10px] border border-[#d7cbb7]/80 bg-[#fffdf8]/92 px-2.5 text-xs text-[#34402c]',
              'focus:outline-none focus:ring-2 focus:ring-[#8fbc8f]/50'
            )}
          >
            <option value="300">300</option>
            <option value="400">400</option>
            <option value="500">500</option>
            <option value="600">600</option>
            <option value="700">700</option>
            <option value="800">800</option>
          </select>
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full border-transparent bg-[#e8e0d0]/80 px-3 text-xs text-[#4f5f42] hover:bg-[#ded3bf]"
            onClick={onCancel}
            disabled={isSaving}
          >
            {t('sessionDetail.cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            className="rounded-full bg-[#5d6b4d] px-3 text-xs text-white hover:bg-[#3e4a32]"
            onClick={onSave}
            disabled={isSaving || !draft.text.trim()}
          >
            {isSaving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t('sessionDetail.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
