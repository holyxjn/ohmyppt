import { create } from 'zustand'
import { toast } from 'sonner'

interface ToastOptions {
  description?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

interface ToastState {
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  warning: (message: string, options?: ToastOptions) => void
  promise: <T>(
    input: Promise<T>,
    messages: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: Error) => string)
    }
  ) => Promise<T>
  dismiss: (toastId?: string) => void
}

export const useToastStore = create<ToastState>(() => ({
  success: (message, options) => toast.success(message, options),
  error: (message, options) => toast.error(message, options),
  info: (message, options) => toast(message, options),
  warning: (message, options) => toast.warning(message, options),
  promise: (input, messages) => {
    toast.promise(input, messages)
    return input
  },
  dismiss: (toastId) => {
    if (toastId) {
      toast.dismiss(toastId)
      return
    }
    toast.dismiss()
  },
}))
