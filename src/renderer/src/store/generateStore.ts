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
  currentPages: { id: string; pageNumber: number; title: string; html: string; htmlPath?: string; pageId?: string; sourceUrl?: string; status?: string; error?: string | null }[]
  error: string | null
  cancelReason: string | null

  startGeneration: () => void
  updateProgress: (progress: Partial<GenerateProgress>) => void
  setPages: (pages: { id: string; pageNumber: number; title: string; html: string; htmlPath?: string; pageId?: string; sourceUrl?: string; status?: string; error?: string | null }[]) => void
  addPage: (page: { id: string; pageNumber: number; title: string; html: string; htmlPath?: string; pageId?: string; sourceUrl?: string; status?: string; error?: string | null }) => void
  updatePage: (
    pageId: string,
    html: string,
    patch?: Partial<{
      pageNumber: number
      title: string
      htmlPath?: string
      sourceUrl?: string
      status?: string
      error?: string | null
    }>
  ) => void
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

  addPage: (page) =>
    set((state) => {
      const existingIndex = state.currentPages.findIndex((item) =>
        page.id === item.id ||
        (page.pageId && item.pageId ? item.pageId === page.pageId : item.pageNumber === page.pageNumber)
      )
      if (existingIndex < 0) {
        return { currentPages: [...state.currentPages, page] }
      }
      return {
        currentPages: state.currentPages.map((item, index) =>
          index === existingIndex ? { ...item, ...page } : item
        )
      }
    }),

  updatePage: (pageId, html, patch) => set((state) => ({
    currentPages: state.currentPages.map((page) =>
      page.pageId === pageId ? { ...page, ...patch, html } : page
    )
  })),

  finishGeneration: () => set({ status: 'completed', isGenerating: false, progress: null, cancelReason: null }),
  cancelGeneration: (reason = 'User cancelled generation') =>
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
