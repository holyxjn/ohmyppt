import type { IpcContext } from '../context'
import type { GenerationContext, GenerationService } from './types'
import { resolveGenerationContext } from './context-resolver'
import { finalizeGenerationFailure } from './finalize'
import { executeDeckGeneration } from './deck-flow'
import { executeEditGeneration } from './edit-flow'
import { executeRetryFailedPages } from './retry-flow'
import { executeAddPageGeneration } from './add-page-flow'
import { createEmitAssistantMessage } from './helpers'

export type { GenerationContext, GenerationService } from './types'

export function createGenerationService(ctx: IpcContext): GenerationService {
  const emitAssistant = createEmitAssistantMessage(ctx.db, ctx.emitGenerateChunk)

  const executeGeneration = async (context: GenerationContext): Promise<void> => {
    if (context.effectiveMode === 'edit') {
      await executeEditGeneration(ctx, emitAssistant, context)
      return
    }
    await executeDeckGeneration(ctx, emitAssistant, context)
  }

  return {
    resolveGenerationContext: (_event, payload, options) =>
      resolveGenerationContext(ctx, _event, payload, options),
    finalizeGenerationFailure: (context, error) => finalizeGenerationFailure(ctx, context, error),
    executeGeneration,
    executeRetryFailedPages: (context) => executeRetryFailedPages(ctx, emitAssistant, context),
    executeAddPageGeneration: (context) => executeAddPageGeneration(ctx, emitAssistant, context)
  }
}
