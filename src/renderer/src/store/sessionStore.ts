import { create } from 'zustand'
import { ipc } from '@renderer/lib/ipc'

export interface Session {
  id: string
  title: string
  topic: string | null
  styleId: string | null
  page_count: number | null
  referenceDocumentPath?: string | null
  reference_document_path?: string | null
  status: string
  provider: string
  model: string
  created_at: number
  updated_at: number
  metadata: string | null
}

export interface Message {
  id: string
  session_id: string
  chat_scope: 'main' | 'page'
  page_id: string | null
  selector?: string | null
  image_paths?: string[] | null
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  type: string
  tool_name: string | null
  tool_call_id: string | null
  token_count: number | null
  created_at: number
}

export interface GeneratedPage {
  pageNumber: number
  title: string
  html: string
  htmlPath?: string
  pageId?: string
  sourceUrl?: string
  status?: string
  error?: string | null
}

interface SessionStore {
  sessions: Session[]
  currentSession: Session | null
  currentMessages: Message[]
  currentGeneratedPages: GeneratedPage[]
  loading: boolean
  error: string | null

  fetchSessions: () => Promise<void>
  createSession: (payload: {
    topic: string
    styleId: string
    pageCount?: number
    referenceDocumentPath?: string
  }) => Promise<string>
  loadSession: (sessionId: string) => Promise<void>
  loadMessages: (payload: { sessionId: string; chatType: 'main' | 'page'; pageId?: string }) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  updateSessionTitle: (payload: { sessionId: string; title: string }) => Promise<void>
  setCurrentSession: (session: Session | null) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  currentSession: null,
  currentMessages: [],
  currentGeneratedPages: [],
  loading: false,
  error: null,

  fetchSessions: async () => {
    try {
      const sessions = await ipc.listSessions()
      set({ sessions: sessions as unknown as Session[] })
    } catch (e) {
      set({ error: 'Failed to fetch sessions' })
    }
  },

  createSession: async (payload) => {
    const { sessionId } = await ipc.createSession(payload)
    await get().fetchSessions()
    return sessionId
  },

  loadSession: async (sessionId) => {
    set({ loading: true })
    try {
      const { session, generatedPages } = await ipc.getSession(sessionId)
      set({
        currentSession: ((session as unknown as Session | null | undefined) ?? null),
        // 消息由页面上下文决定（main/page），这里不做默认回填，避免覆盖当前页消息。
        currentMessages: [],
        currentGeneratedPages: generatedPages,
        loading: false,
      })
    } catch (e) {
      set({ error: 'Failed to load session', loading: false })
    }
  },

  loadMessages: async ({ sessionId, chatType, pageId }) => {
    try {
      const messages = await ipc.getSessionMessages({ sessionId, chatType, pageId })
      set({ currentMessages: messages as unknown as Message[] })
    } catch (e) {
      set({ error: 'Failed to load messages' })
    }
  },

  deleteSession: async (sessionId) => {
    await ipc.deleteSession(sessionId)
    await get().fetchSessions()
    if (get().currentSession?.id === sessionId) {
      set({ currentSession: null, currentMessages: [], currentGeneratedPages: [] })
    }
  },

  updateSessionTitle: async ({ sessionId, title }) => {
    await ipc.updateSessionTitle({ sessionId, title })
    await get().fetchSessions()
    const currentSession = get().currentSession
    if (currentSession?.id === sessionId) {
      set({ currentSession: { ...currentSession, title } })
    }
  },

  setCurrentSession: (session) => set({ currentSession: session }),
  setMessages: (messages) => set({ currentMessages: messages }),
  addMessage: (message) => set((state) => ({ currentMessages: [...state.currentMessages, message] })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))
