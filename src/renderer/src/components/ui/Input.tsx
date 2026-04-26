import { cn } from '@renderer/lib/utils'
import React from 'react'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'soft-input flex h-11 w-full rounded-lg px-4 py-2 text-sm text-foreground',
        'ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'soft-input flex min-h-[80px] w-full rounded-lg px-4 py-3 text-sm text-foreground',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
