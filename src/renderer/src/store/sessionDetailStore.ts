import { create } from 'zustand'
import type { UploadedAsset } from '@shared/generation.js'

export type SessionDetailChatType = 'main' | 'page'
export type InteractionMode = 'preview' | 'ai-inspect' | 'edit'
export type EditSubMode = 'layout' | 'text'

interface SessionDetailUiStore {
  input: string
  chatType: SessionDetailChatType
  selectedPageNumber: number | null
  consoleOpen: boolean
  previewKey: number
  isExportingPdf: boolean
  isExportingPng: boolean
  isExportingPptx: boolean
  interactionMode: InteractionMode
  editSubMode: EditSubMode
  thumbnailVersions: Record<string, number>
  selectedSelector: string | null
  selectorLabel: string
  elementTag: string
  elementText: string
  pendingAssets: UploadedAsset[]
  assetDragActive: boolean
  isUploadingAssets: boolean
  addPageDialogOpen: boolean
  isAddingPage: boolean
  isRetryingSinglePage: boolean

  setInput: (input: string) => void
  setChatType: (chatType: SessionDetailChatType) => void
  setSelectedPageNumber: (pageNumber: number | null) => void
  setConsoleOpen: (open: boolean | ((open: boolean) => boolean)) => void
  bumpPreviewKey: () => void
  setIsExportingPdf: (isExporting: boolean) => void
  setIsExportingPng: (isExporting: boolean) => void
  setIsExportingPptx: (isExporting: boolean) => void
  setInteractionMode: (mode: InteractionMode) => void
  setEditSubMode: (sub: EditSubMode) => void
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
  setAddPageDialogOpen: (open: boolean) => void
  setIsAddingPage: (adding: boolean) => void
  setIsRetryingSinglePage: (retrying: boolean) => void
  finishAddPage: (selectedPageNumber?: number | null) => void
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
  interactionMode: 'preview' as InteractionMode,
  editSubMode: 'layout' as EditSubMode,
  thumbnailVersions: {},
  selectedSelector: null,
  selectorLabel: '',
  elementTag: '',
  elementText: '',
  pendingAssets: [],
  assetDragActive: false,
  isUploadingAssets: false,
  addPageDialogOpen: false,
  isAddingPage: false,
  isRetryingSinglePage: false,

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
  setInteractionMode: (interactionMode) => set({ interactionMode }),
  setEditSubMode: (editSubMode) => set({ editSubMode }),
  setSelectedElement: (selectedSelector, selectorLabel, elementTag = '', elementText = '') =>
    set((state) => ({
      selectedSelector,
      selectorLabel,
      elementTag,
      elementText,
      interactionMode: state.interactionMode === 'ai-inspect'
        ? 'ai-inspect'
        : ('preview' as InteractionMode)
    })),
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
  setAddPageDialogOpen: (addPageDialogOpen) => set({ addPageDialogOpen }),
  setIsAddingPage: (isAddingPage) => set({ isAddingPage }),
  setIsRetryingSinglePage: (isRetryingSinglePage) => set({ isRetryingSinglePage }),
  finishAddPage: (selectedPageNumber) =>
    set((state) => ({
      isAddingPage: false,
      selectedPageNumber:
        typeof selectedPageNumber === 'undefined' ? state.selectedPageNumber : selectedPageNumber
    })),
  resetForPageChange: () =>
    set({
      interactionMode: 'preview' as InteractionMode,
      editSubMode: 'layout' as EditSubMode,
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
      interactionMode: 'preview' as InteractionMode,
      editSubMode: 'layout' as EditSubMode,
      selectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: '',
      pendingAssets: [],
      assetDragActive: false,
      isUploadingAssets: false,
      thumbnailVersions: {},
      addPageDialogOpen: false,
      isAddingPage: false,
      isRetryingSinglePage: false
    })
}))
