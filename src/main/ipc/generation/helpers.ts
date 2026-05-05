import type { PPTDatabase } from '../../db/database'
import type { GenerationContext, EmitAssistantFn } from './types'

export const uiText = (locale: 'zh' | 'en', zh: string, en: string): string =>
  locale === 'en' ? en : zh

export function createEmitAssistantMessage(
  db: PPTDatabase,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitGenerateChunk: (sessionId: string, chunk: any) => void
): EmitAssistantFn {
  return async (context: GenerationContext, content: string): Promise<void> => {
    if (!content.trim()) return
    const messageId = await db.addMessage(context.sessionId, {
      role: 'assistant',
      content: content.trim(),
      type: 'text',
      chat_scope: context.messageScope,
      page_id: context.messagePageId
    })
    emitGenerateChunk(context.sessionId, {
      type: 'assistant_message',
      payload: {
        id: messageId,
        runId: context.runId,
        content: content.trim(),
        chatType: context.messageScope,
        pageId: context.messagePageId
      }
    })
  }
}
