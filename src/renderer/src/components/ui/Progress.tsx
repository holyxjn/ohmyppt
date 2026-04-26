import { cn } from '@renderer/lib/utils'
import React from 'react'

export function Progress({ className, value = 0, ...props }: React.HTMLAttributes<HTMLDivElement> & { value?: number }) {
  return (
    <div className={cn('soft-inset relative h-3.5 w-full overflow-hidden rounded-full', className)} {...props}>
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,#8fbc8f_0%,#6f8159_55%,#4f613f_100%)] transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
