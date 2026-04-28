import dayjs from 'dayjs'
import { Image as ImageIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { Message } from '@renderer/store/sessionStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'

export function MessageBubble({
  message,
  cleanMessageContent
}: {
  message: Message
  cleanMessageContent: (content: string) => string
}): React.JSX.Element {
  const isUser = message.role === 'user'
  const selectorText =
    typeof message.selector === 'string' && message.selector.trim().length > 0
      ? message.selector.trim()
      : ''
  const imagePaths = Array.isArray(message.image_paths)
    ? message.image_paths
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith('./images/'))
        .slice(0, 10)
    : []

  return (
    <div className={cn('flex w-full min-w-0', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 overflow-hidden rounded-[1.15rem] px-3 py-2 shadow-[0_8px_18px_rgba(93,107,77,0.1)]',
          selectorText ? 'w-full max-w-[238px]' : 'w-fit max-w-[238px]',
          isUser ? 'bg-[#f5f1e8]/82 text-[#3f4b35]' : 'bg-[#e8e0d0]/76 text-[#3f4b35]'
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
            {cleanMessageContent(message.content)}
          </p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {dayjs(message.created_at * 1000).format('YYYY-MM-DD HH:mm:ss')}
          </p>
        </div>
      </div>
    </div>
  )
}
