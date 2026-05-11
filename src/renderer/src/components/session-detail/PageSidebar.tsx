import { memo, useEffect, useMemo, useRef } from 'react'
import { Home, Move, Plus, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useGenerateStore, useSessionStore } from '@renderer/store'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ScrollArea } from '../ui/ScrollArea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { PageThumbnail } from './PageThumbnail'
import type { SessionPreviewPage } from './types'
import { useT } from '@renderer/i18n'

function SortablePageItem({
  id,
  disabled,
  children
}: {
  id: string
  disabled: boolean
  children: (bindings: {
    attributes: ReturnType<typeof useSortable>['attributes']
    listeners: ReturnType<typeof useSortable>['listeners']
    setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef']
    isDragging: boolean
  }) => React.ReactNode
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id,
    disabled
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  )
}

export const PageSidebar = memo(function PageSidebar({
  pages,
  disabled = false,
  onAddPage,
  onRetryFailedPage,
  onReorderPages,
  onDeletePage,
  pageManagementDisabled = false
}: {
  pages: SessionPreviewPage[]
  disabled?: boolean
  onAddPage?: () => void
  onRetryFailedPage?: (page: SessionPreviewPage) => void
  onReorderPages?: (orderedPageIds: string[], selectedPageId?: string) => Promise<void> | void
  onDeletePage?: (page: SessionPreviewPage) => void
  pageManagementDisabled?: boolean
}): React.JSX.Element {
  const navigate = useNavigate()
  const t = useT()
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const previewKey = useSessionDetailUiStore((state) => state.previewKey)
  const thumbnailVersions = useSessionDetailUiStore((state) => state.thumbnailVersions)
  const setSelectedPageId = useSessionDetailUiStore((state) => state.setSelectedPageId)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const wasAddingRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const resetSessionRuntimeState = useSessionStore((state) => state.resetRuntimeState)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const sortableIds = useMemo(() => pages.map((p) => p.id), [pages])

  // Keep selected thumbnail in view when add-page completes (isAddingPage: true -> false).
  // Fallback to bottom if selected thumbnail is not found yet.
  useEffect(() => {
    if (wasAddingRef.current && !isAddingPage && viewportRef.current) {
      const viewport = viewportRef.current
      const selectedNode =
        selectedPageId
          ? viewport.querySelector<HTMLElement>(`[data-page-id="${selectedPageId}"]`)
          : null

      if (selectedNode) {
        selectedNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      } else {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
    wasAddingRef.current = isAddingPage
  }, [isAddingPage, selectedPageId, pages.length])

  const handleBackToSessions = (): void => {
    useGenerateStore.getState().reset()
    useSessionDetailUiStore.getState().resetForSessionChange()
    resetSessionRuntimeState()
    navigate('/sessions')
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    if (!onReorderPages || pageManagementDisabled || disabled) return
    const oldIndex = pages.findIndex((p) => p.id === String(active.id))
    const newIndex = pages.findIndex((p) => p.id === String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const next = arrayMove(pages, oldIndex, newIndex)
    void onReorderPages(
      next.map((p) => p.id),
      String(active.id)
    )
  }

  return (
    <aside className="flex min-h-0 w-[220px] shrink-0 flex-col bg-[#f5f1e8] px-2.5 pb-3 pt-3 shadow-[inset_-16px_0_30px_rgba(93,107,77,0.045)]">
      <div className="relative mb-3 flex items-center justify-between overflow-hidden rounded-[1.35rem] bg-[#e8e0d0]/72 px-2 py-1.5 shadow-[0_10px_24px_rgba(93,107,77,0.08)]">
        <div className="pointer-events-none absolute -right-6 -top-7 h-20 w-20 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#d4e4c1]/62" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleBackToSessions}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-[38%_62%_44%_56%/55%_45%_55%_45%] bg-[#f5f1e8]/72 text-[#5d6b4d] shadow-[0_4px_10px_rgba(93,107,77,0.08)] transition-colors hover:bg-[#d4e4c1]/78 hover:text-[#3e4a32] cursor-pointer"
              aria-label={t('sessionDetail.backToSessions')}
            >
              <Home className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('sessionDetail.backToSessions')}</TooltipContent>
        </Tooltip>
        <div className="relative rounded-full bg-[#d4e4c1]/74 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3e4a32] shadow-[0_3px_8px_rgba(93,107,77,0.08)]">
          {t('sessionDetail.pagesCount', { count: pages.length })}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-0.5 pb-2" viewportRef={viewportRef}>
        {pages.length === 0 ? (
          <div className="flex min-h-[96px] items-center justify-center rounded-[1.25rem] bg-[#e8e0d0]/54 text-xs text-[#8a9a7b]">
            {t('sessionDetail.pagesEmpty')}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2.5">
                {pages.map((page) => (
                  <div key={page.id} data-page-id={page.id}>
                    <SortablePageItem id={page.id} disabled={pageManagementDisabled || disabled}>
                      {({ attributes, listeners, setActivatorNodeRef, isDragging }) => (
                        <PageThumbnail
                          page={page}
                          isSelected={selectedPageId === page.id}
                          previewVersion={previewKey + (thumbnailVersions[page.pageId] || 0)}
                          onSelect={disabled ? undefined : setSelectedPageId}
                          actions={
                            <div className="absolute inset-x-1 top-1 z-10 flex items-start justify-between opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                ref={setActivatorNodeRef}
                                disabled={pageManagementDisabled || disabled}
                                onClick={(e) => {
                                  e.stopPropagation()
                                }}
                                className="cursor-grab rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={t('pageManagement.dragHandle')}
                                title={t('pageManagement.dragHandle')}
                                {...attributes}
                                {...listeners}
                              >
                                <Move className={`h-4 w-4 ${isDragging ? 'opacity-60' : ''}`} />
                              </button>
                              {onDeletePage ? (
                                <button
                                  type="button"
                                  disabled={pageManagementDisabled || disabled || pages.length <= 1}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onDeletePage(page)
                                  }}
                                  className="rounded bg-white/90 p-1 shadow-sm"
                                  aria-label={t('pageManagement.deletePage')}
                                  title={t('pageManagement.deletePage')}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                          }
                        />
                      )}
                    </SortablePageItem>
                    {page.status === 'failed' && onRetryFailedPage && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setSelectedPageId(page.id)
                          onRetryFailedPage(page)
                        }}
                        className="group mt-1 block w-full rounded-[1.1rem] bg-[#f3e4df]/85 p-1.5 text-left shadow-[0_8px_18px_rgba(142,90,83,0.08)] transition-all duration-200 hover:bg-[#f1ddd7] hover:shadow-[0_10px_22px_rgba(142,90,83,0.12)] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <div className="rounded-[0.9rem] border border-[#d7b5ae]/70 bg-[#fbf1ee] px-2.5 py-2">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#a36a63]">
                            P{page.pageNumber}
                          </div>
                          <div className="mt-1 text-[11px] font-medium leading-4 text-[#93564f]">
                            {t('sessionDetail.retryFailedPage')}
                          </div>
                        </div>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </ScrollArea>
      {onAddPage && (
        <button
          type="button"
          disabled={disabled}
          onClick={onAddPage}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[1rem] border border-dashed border-[#b5c4a1]/60 bg-[#d4e4c1]/30 px-3 py-2 text-xs font-medium text-[#5d6b4d] transition-colors hover:bg-[#d4e4c1]/50 hover:text-[#3e4a32] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('sessionDetail.addPage')}
        </button>
      )}
    </aside>
  )
})
