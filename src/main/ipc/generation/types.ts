import type { PPTDatabase } from '../../db/database'
import type { AgentManager } from '../../agent'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import type { DesignContract } from '../../tools/types'
import { loadStyleSkill } from '../../utils/style-skills'

export type GenerateMode = 'generate' | 'edit' | 'retry' | 'addPage'
export type GenerateChatType = 'main' | 'page'

export type GenerationContext = {
  sessionId: string
  userMessage: string
  requestedType?: 'deck' | 'page'
  effectiveMode: GenerateMode
  selectedPageId?: string
  htmlPath?: string
  selector?: string
  elementTag?: string
  elementText?: string
  session: Awaited<ReturnType<PPTDatabase['getSession']>>
  sessionRecord: Record<string, unknown>
  previousSessionStatus: string
  entry: ReturnType<AgentManager['beginRun']> extends infer T ? NonNullable<T> : never
  runId: string
  styleId: string
  styleSkill: ReturnType<typeof loadStyleSkill>
  userProvidedOutlineTitles: string[]
  totalPages: number
  provider: string
  apiKey: string
  model: string
  modelTimeouts: Record<ModelTimeoutProfile, number>
  providerBaseUrl: string
  projectId: string
  messageScope: GenerateChatType
  messagePageId?: string
  imagePaths: string[]
  sourceDocumentPaths: string[]
  topic: string
  deckTitle: string
  appLocale: 'zh' | 'en'
}

export type FinalizeGenerationArgs = {
  context: GenerationContext
  indexPath: string
  totalPages: number
  generatedPages: Array<{
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }>
  designContract?: DesignContract
}

export interface GenerationService {
  resolveGenerationContext: (
    _event: Electron.IpcMainInvokeEvent,
    payload: unknown,
    options?: { persistUserMessage?: boolean; mode?: GenerateMode }
  ) => Promise<GenerationContext>
  finalizeGenerationFailure: (context: GenerationContext, error: unknown) => Promise<void>
  executeGeneration: (context: GenerationContext) => Promise<void>
  executeRetryFailedPages: (context: GenerationContext) => Promise<void>
  executeAddPageGeneration: (context: GenerationContext) => Promise<void>
}

export type EmitAssistantFn = (context: GenerationContext, content: string) => Promise<void>
