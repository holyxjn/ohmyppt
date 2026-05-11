import type { GeneratedPage } from '@renderer/store/sessionStore'
import type { SessionDetailChatType } from '@renderer/store/sessionDetailStore'

export type ChatType = SessionDetailChatType

export type SessionPreviewPage = GeneratedPage & {
  id: string
  pageId: string
}
