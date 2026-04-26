import { create } from 'zustand'

interface GenerateProgress {
  stage: string
  label: string
  currentPage?: number
  totalPages?: number
  progress: number
}

type GenerateRunStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'failed'

interface GenerateStore {
  status: GenerateRunStatus
  isGenerating: boolean
  progress: GenerateProgress | null
  currentPages: { pageNumber: number; title: string; html: string; htmlPath?: string; pageId?: string; sourceUrl?: string }[]
  error: string | null
  cancelReason: string | null

  startGeneration: () => void
  updateProgress: (progress: Partial<GenerateProgress>) => void
  setPages: (pages: { pageNumber: number; title: string; html: string; htmlPath?: string; pageId?: string; sourceUrl?: string }[]) => void
  addPage: (page: { pageNumber: number; title: string; html: string; htmlPath?: string; pageId?: string; sourceUrl?: string }) => void
  updatePage: (pageId: string, html: string) => void
  finishGeneration: () => void
  cancelGeneration: (reason?: string) => void
  setError: (error: string | null) => void
  reset: () => void
}

export const useGenerateStore = create<GenerateStore>((set) => ({
  status: 'idle',
  isGenerating: false,
  progress: null,
  currentPages: [],
  error: null,
  cancelReason: null,

  startGeneration: () => set({
    status: 'running',
    isGenerating: true,
    progress: null,
    currentPages: [],
    error: null,
    cancelReason: null
  }),

  updateProgress: (progress) => set((state) => ({
    progress: state.progress ? { ...state.progress, ...progress } : progress as GenerateProgress
  })),

  setPages: (pages) => set({ currentPages: pages }),

  addPage: (page) => set((state) => ({
    currentPages: [...state.currentPages, page]
  })),

  updatePage: (pageId, html) => set((state) => ({
    currentPages: state.currentPages.map((page) =>
      page.pageId === pageId ? { ...page, html } : page
    )
  })),

  finishGeneration: () => set({ status: 'completed', isGenerating: false, progress: null, cancelReason: null }),
  cancelGeneration: (reason = '用户取消生成') =>
    set({ status: 'cancelled', isGenerating: false, progress: null, cancelReason: reason }),
  setError: (error) => set({ status: 'failed', error, isGenerating: false }),
  reset: () => set({
    status: 'idle',
    isGenerating: false,
    progress: null,
    currentPages: [],
    error: null,
    cancelReason: null
  }),
}))
