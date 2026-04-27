import { memo } from 'react'
import { cn } from '@renderer/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { PreviewIframe } from '../preview/PreviewIframe'
import type { SessionPreviewPage } from './types'

export const PageThumbnail = memo(function PageThumbnail({
  page,
  isSelected,
  previewVersion,
  onSelect
}: {
  page: SessionPreviewPage
  isSelected: boolean
  previewVersion: number
  onSelect: (pageNumber: number) => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(page.pageNumber)}
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
              key={`thumb-${page.pageId}-${previewVersion}`}
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
          <div className="mt-0.5 text-sm font-medium text-[#3e4a32]">{page.title}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
})
