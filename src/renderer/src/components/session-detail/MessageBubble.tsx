import dayjs from 'dayjs'
import { Image as ImageIcon, Video } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { Message } from '@renderer/store/sessionStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { useT } from '@renderer/i18n'

export function MessageBubble({
  message,
  cleanMessageContent
}: {
  message: Message
  cleanMessageContent: (content: string) => string
}): React.JSX.Element {
  const t = useT()
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
  const videoPaths = Array.isArray(message.video_paths)
    ? message.video_paths
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith('./videos/'))
        .slice(0, 10)
    : []
  const mediaPaths = [...imagePaths, ...videoPaths]

  return (
    <div className={cn('flex w-full min-w-0', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 overflow-hidden rounded-[1.15rem] border px-3 py-2 shadow-[0_6px_14px_rgba(74,59,42,0.08)]',
          selectorText ? 'w-full max-w-[238px]' : 'w-fit max-w-[238px]',
          isUser
            ? 'border-[#d6e3c8]/78 bg-[#fbfef6]/90 text-[#34402c]'
            : 'border-[#ded2bd]/78 bg-[#fffaf1]/88 text-[#3f372b]'
        )}
      >
        <div className="space-y-1">
          {isUser && selectorText && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex w-full min-w-0 items-center overflow-hidden rounded-full border border-[#c7d9b4]/62 bg-[#e6f1dc]/72 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#4b5f3b]">
                  <span className="mr-1 shrink-0">{t('sessionDetail.selectorBadge')}</span>
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
          {isUser && mediaPaths.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {mediaPaths.map((mediaPath) => (
                <Tooltip key={mediaPath}>
                  <TooltipTrigger asChild>
                    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#c7d9b4]/62 bg-[#e6f1dc]/72 px-1.5 py-0.5 text-[10px] font-medium text-[#4b5f3b]">
                      {mediaPath.startsWith('./videos/') ? (
                        <Video className="h-3 w-3 shrink-0" />
                      ) : (
                        <ImageIcon className="h-3 w-3 shrink-0" />
                      )}
                      <span className="min-w-0 max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
                        {mediaPath}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="whitespace-pre-wrap break-all">
                    {mediaPath}
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
