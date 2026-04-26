export interface UploadedAsset {
  id: string
  fileName: string
  originalName: string
  relativePath: string
  absolutePath?: string
  mimeType: string
  size: number
  createdAt: number
}

export interface GenerateStartPayload {
  sessionId: string
  userMessage: string
  type?: 'deck' | 'page'
  chatType?: 'main' | 'page'
  chatPageId?: string
  selectedPageId?: string
  htmlPath?: string
  selector?: string
  elementTag?: string
  elementText?: string
  imagePaths?: string[]
  docPaths?: string[]
}

export interface GeneratedPagePayload {
  pageNumber: number
  title: string
  html: string
  htmlPath?: string
  pageId?: string
  sourceUrl?: string
}

export interface GenerateStagePayload {
  runId: string
  sessionId?: string
  stage: string
  label: string
  progress?: number
  currentPage?: number
  totalPages?: number
  timestamp?: string
}

export type GenerateChunkEvent =
  | {
      type: 'stage_started' | 'stage_progress'
      payload: GenerateStagePayload
    }
  | {
      type: 'llm_status'
      payload: GenerateStagePayload & {
        provider?: string
        model?: string
        detail?: string
      }
    }
  | {
      type: 'assistant_message'
      payload: {
        runId: string
        sessionId?: string
        content: string
        chatType?: 'main' | 'page'
        pageId?: string
        timestamp?: string
      }
    }
  | {
      type: 'page_generated'
      payload: GenerateStagePayload & GeneratedPagePayload
    }
  | {
      type: 'page_updated'
      payload: GenerateStagePayload & GeneratedPagePayload
    }
  | {
      type: 'run_completed'
      payload: {
        runId: string
        sessionId?: string
        totalPages: number
        timestamp?: string
      }
    }
  | {
      type: 'run_error'
      payload: {
        runId: string
        sessionId?: string
        message: string
        timestamp?: string
      }
    }
