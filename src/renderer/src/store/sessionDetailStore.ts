import { create } from 'zustand'
import type { UploadedAsset } from '@shared/generation.js'

export type SessionDetailChatType = 'main' | 'page'

interface SessionDetailUiStore {
  input: string
  chatType: SessionDetailChatType
  selectedPageNumber: number | null
  consoleOpen: boolean
  previewKey: number
  isExportingPdf: boolean
  isExportingPng: boolean
  isExportingPptx: boolean
  inspecting: boolean
  dragEditing: boolean
  thumbnailVersions: Record<string, number>
  selectedSelector: string | null
  selectorLabel: string
  elementTag: string
  elementText: string
  pendingAssets: UploadedAsset[]
  assetDragActive: boolean
  isUploadingAssets: boolean

  setInput: (input: string) => void
  setChatType: (chatType: SessionDetailChatType) => void
  setSelectedPageNumber: (pageNumber: number | null) => void
  setConsoleOpen: (open: boolean | ((open: boolean) => boolean)) => void
  bumpPreviewKey: () => void
  setIsExportingPdf: (isExporting: boolean) => void
  setIsExportingPng: (isExporting: boolean) => void
  setIsExportingPptx: (isExporting: boolean) => void
  setInspecting: (inspecting: boolean) => void
  setDragEditing: (dragEditing: boolean) => void
  setSelectedElement: (
    selector: string,
    label: string,
    elementTag?: string,
    elementText?: string
  ) => void
  clearSelectedElement: () => void
  addPendingAssets: (assets: UploadedAsset[]) => void
  removePendingAsset: (assetId: string) => void
  clearPendingAssets: () => void
  setAssetDragActive: (active: boolean) => void
  setIsUploadingAssets: (isUploading: boolean) => void
  bumpThumbnailVersion: (pageId: string) => void
  resetForPageChange: () => void
  resetForSessionChange: () => void
}

export const useSessionDetailUiStore = create<SessionDetailUiStore>((set) => ({
  input: '',
  chatType: 'page',
  selectedPageNumber: null,
  consoleOpen: true,
  previewKey: 0,
  isExportingPdf: false,
  isExportingPng: false,
  isExportingPptx: false,
  inspecting: false,
  dragEditing: false,
  thumbnailVersions: {},
  selectedSelector: null,
  selectorLabel: '',
  elementTag: '',
  elementText: '',
  pendingAssets: [],
  assetDragActive: false,
  isUploadingAssets: false,

  setInput: (input) => set({ input }),
  setChatType: (chatType) => set({ chatType }),
  setSelectedPageNumber: (selectedPageNumber) => set({ selectedPageNumber }),
  setConsoleOpen: (open) =>
    set((state) => ({
      consoleOpen: typeof open === 'function' ? open(state.consoleOpen) : open
    })),
  bumpPreviewKey: () => set((state) => ({ previewKey: state.previewKey + 1 })),
  setIsExportingPdf: (isExportingPdf) => set({ isExportingPdf }),
  setIsExportingPng: (isExportingPng) => set({ isExportingPng }),
  setIsExportingPptx: (isExportingPptx) => set({ isExportingPptx }),
  setInspecting: (inspecting) => set({ inspecting }),
  setDragEditing: (dragEditing) => set({ dragEditing }),
  setSelectedElement: (selectedSelector, selectorLabel, elementTag = '', elementText = '') =>
    set({
      selectedSelector,
      selectorLabel,
      elementTag,
      elementText,
      inspecting: false
    }),
  clearSelectedElement: () =>
    set({
      selectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: ''
    }),
  addPendingAssets: (assets) =>
    set((state) => ({
      pendingAssets: [...state.pendingAssets, ...assets]
    })),
  removePendingAsset: (assetId) =>
    set((state) => ({
      pendingAssets: state.pendingAssets.filter((asset) => asset.id !== assetId)
    })),
  clearPendingAssets: () => set({ pendingAssets: [] }),
  setAssetDragActive: (assetDragActive) => set({ assetDragActive }),
  setIsUploadingAssets: (isUploadingAssets) => set({ isUploadingAssets }),
  bumpThumbnailVersion: (pageId) =>
    set((state) => ({
      thumbnailVersions: {
        ...state.thumbnailVersions,
        [pageId]: (state.thumbnailVersions[pageId] || 0) + 1
      }
    })),
  resetForPageChange: () =>
    set({
      inspecting: false,
      dragEditing: false,
      selectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: ''
    }),
  resetForSessionChange: () =>
    set({
      input: '',
      chatType: 'page',
      selectedPageNumber: null,
      inspecting: false,
      dragEditing: false,
      selectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: '',
      pendingAssets: [],
      assetDragActive: false,
      isUploadingAssets: false,
      thumbnailVersions: {}
    })
}))
