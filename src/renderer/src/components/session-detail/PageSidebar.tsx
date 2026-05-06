import { memo } from 'react'
import { Home } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import { ScrollArea } from '../ui/ScrollArea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { PageThumbnail } from './PageThumbnail'
import type { SessionPreviewPage } from './types'
import { useT } from '@renderer/i18n'

export const PageSidebar = memo(function PageSidebar({
  pages,
  disabled = false
}: {
  pages: SessionPreviewPage[]
  disabled?: boolean
}): React.JSX.Element {
  const navigate = useNavigate()
  const t = useT()
  const selectedPageNumber = useSessionDetailUiStore((state) => state.selectedPageNumber)
  const previewKey = useSessionDetailUiStore((state) => state.previewKey)
  const thumbnailVersions = useSessionDetailUiStore((state) => state.thumbnailVersions)
  const setSelectedPageNumber = useSessionDetailUiStore((state) => state.setSelectedPageNumber)

  return (
    <aside className="flex min-h-0 w-[220px] shrink-0 flex-col bg-[#f5f1e8] px-2.5 pb-3 pt-3 shadow-[inset_-16px_0_30px_rgba(93,107,77,0.045)]">
      <div className="relative mb-3 flex items-center justify-between overflow-hidden rounded-[1.35rem] bg-[#e8e0d0]/72 px-2 py-1.5 shadow-[0_10px_24px_rgba(93,107,77,0.08)]">
        <div className="pointer-events-none absolute -right-6 -top-7 h-20 w-20 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#d4e4c1]/62" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => navigate('/sessions')}
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
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-0.5 pb-2">
        {pages.length === 0 ? (
          <div className="flex min-h-[96px] items-center justify-center rounded-[1.25rem] bg-[#e8e0d0]/54 text-xs text-[#8a9a7b]">
            {t('sessionDetail.pagesEmpty')}
          </div>
        ) : (
          <div className="space-y-2.5">
            {pages.map((page) => (
              <PageThumbnail
                key={page.pageId}
                page={page}
                isSelected={selectedPageNumber === page.pageNumber}
                previewVersion={previewKey + (thumbnailVersions[page.pageId] || 0)}
                onSelect={disabled ? undefined : setSelectedPageNumber}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  )
})
