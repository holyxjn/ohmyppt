import { cn } from '@renderer/lib/utils'
import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({ className, variant = 'default', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        'cursor-pointer',
        {
          'bg-gradient-to-r from-[#6f8159] to-[#4f613f] text-white shadow-lg shadow-[#5d6b4d]/30 hover:shadow-xl hover:shadow-[#5d6b4d]/40': variant === 'default',
          'bg-gradient-to-r from-[#8fbc8f] to-[#6f8f64] text-[#2f3b28] shadow-lg shadow-[#7da77f]/30 hover:shadow-xl hover:shadow-[#7da77f]/40': variant === 'secondary',
          'bg-gradient-to-r from-[#c97a64] to-[#b15a58] text-white shadow-lg shadow-[#b15a58]/30 hover:shadow-xl hover:shadow-[#b15a58]/40': variant === 'destructive',
          'soft-btn text-foreground': variant === 'outline',
          'bg-transparent text-muted-foreground hover:bg-[#ebe4d6]/80 hover:text-accent-foreground shadow-none': variant === 'ghost',
        },
        {
          'h-9 px-4 text-sm': size === 'sm',
          'h-11 px-5 text-sm': size === 'md',
          'h-12 px-7 text-base': size === 'lg',
        },
        className
      )}
      {...props}
    />
  )
}
