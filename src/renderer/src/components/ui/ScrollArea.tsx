import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '@renderer/lib/utils'

interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string
  viewportRef?: React.Ref<HTMLDivElement>
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>
  scrollbars?: 'vertical' | 'horizontal' | 'both'
}

export function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportRef,
  onViewportScroll,
  scrollbars = 'vertical',
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        onScroll={onViewportScroll}
        className={cn('h-full w-full rounded-[inherit]', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {(scrollbars === 'vertical' || scrollbars === 'both') && <ScrollBar orientation="vertical" />}
      {(scrollbars === 'horizontal' || scrollbars === 'both') && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner className="bg-transparent" />
    </ScrollAreaPrimitive.Root>
  )
}

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none p-0.5 transition-colors',
      orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
      orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-[#8ca66e]/70 transition-colors before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-8 before:w-full before:min-w-8 before:-translate-x-1/2 before:-translate-y-1/2 hover:bg-[#6f8159]/82" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName
