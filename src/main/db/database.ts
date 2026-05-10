import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq, ne, gt, lte, count, max, asc, desc, sql, and, isNull, inArray } from 'drizzle-orm'
import * as schema from './schema'
import path from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import fs from 'fs'
import crypto from 'crypto'
import { runDatabasePatches } from './patch'

type SessionStatus = 'active' | 'completed' | 'failed' | 'archived'
type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
type MessageType = 'text' | 'tool_call' | 'tool_result' | 'stream_chunk'
type ChatScope = 'main' | 'page'
type StyleSource = 'builtin' | 'custom' | 'override'
type GenerationRunMode = 'generate' | 'retry' | 'edit' | 'import' | 'addPage' | 'retrySinglePage'
type GenerationRunStatus = 'running' | 'completed' | 'failed' | 'partial'
type GenerationPageStatus = 'pending' | 'running' | 'completed' | 'failed'
type SessionPageStatus = schema.SessionPageStatus
type SessionOperationType = 'generate' | 'edit' | 'addPage' | 'retry' | 'import' | 'rollback'
type SessionOperationScope = 'session' | 'deck' | 'page' | 'selector' | 'shell'
type SessionOperationStatus = 'committing' | 'completed' | 'failed' | 'noop'

export interface Session {
  id: string
  title: string
  topic: string | null
  styleId: string | null
  page_count: number | null
  reference_document_path: string | null
  referenceDocumentPath?: string | null
  status: SessionStatus
  provider: string
  model: string
  created_at: number
  updated_at: number
  metadata: string | null
  designContract?: string | null
  currentOperationId?: string | null
  currentCommit?: string | null
}

export interface Message {
  id: string
  session_id: string
  chat_scope: ChatScope
  page_id: string | null
  selector: string | null
  image_paths: string[] | null
  video_paths: string[] | null
  role: MessageRole
  content: string
  type: MessageType
  tool_name: string | null
  tool_call_id: string | null
  token_count: number | null
  created_at: number
}

interface MemorySummary {
  id: string
  session_id: string
  message_range_start: number
  message_range_end: number
  summary: string
  token_count: number | null
  created_at: number
}

interface UserPreference {
  key: string
  value: unknown
  confidence: number
  source_sessions: string[]
  created_at: number
  updated_at: number
  last_used_at: number | null
}

interface Project {
  id: string
  session_id: string
  title: string
  output_path: string
  file_count: number
  total_size: number
  status: 'draft' | 'published' | 'exported'
  created_at: number
  updated_at: number
}

export interface GenerationRunRecord {
  id: string
  session_id: string
  mode: GenerationRunMode
  status: GenerationRunStatus
  total_pages: number
  error: string | null
  metadata: string | null
  created_at: number
  updated_at: number
}

export interface GenerationPageRecord {
  id: string
  run_id: string
  session_id: string
  page_id: string
  page_number: number
  title: string
  content_outline: string | null
  layout_intent: string | null
  html_path: string | null
  status: GenerationPageStatus
  error: string | null
  retry_count: number
  created_at: number
  updated_at: number
}

export interface SessionPageRecord {
  id: string
  session_id: string
  legacy_page_id: string | null
  file_slug: string
  page_number: number
  title: string
  html_path: string
  status: SessionPageStatus
  error: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface SessionPageInput {
  id: string
  sessionId: string
  legacyPageId?: string | null
  fileSlug: string
  pageNumber: number
  title: string
  htmlPath: string
  status?: SessionPageStatus
  error?: string | null
}

export const sessionPageRecordToInput = (page: SessionPageRecord): SessionPageInput => ({
  id: page.id,
  sessionId: page.session_id,
  legacyPageId: page.legacy_page_id,
  fileSlug: page.file_slug,
  pageNumber: page.page_number,
  title: page.title,
  htmlPath: page.html_path,
  status: page.status,
  error: page.error
})

export interface StyleRow {
  id: string
  style: string
  styleName: string
  description: string
  category: string
  aliases: string // JSON array
  source: StyleSource
  styleSkill: string // plain markdown
  createdAt: number
  updatedAt: number
}

export interface ModelConfigRow {
  id: string
  name: string
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  active: number
  createdAt: number
  updatedAt: number
}

export interface SessionOperationRecord {
  id: string
  session_id: string
  type: SessionOperationType
  status: SessionOperationStatus
  scope: SessionOperationScope | null
  prompt: string | null
  parent_operation_id: string | null
  before_commit: string | null
  after_commit: string | null
  target_operation_id: string | null
  target_commit: string | null
  changed_files_json: string
  changed_pages_json: string
  tracked_files_json: string
  metadata_json: string
  created_at: number
  completed_at: number | null
}

export interface SessionOperationPageRecord {
  id: string
  operation_id: string
  session_id: string
  page_id: string
  legacy_page_id: string | null
  file_slug: string
  page_number: number
  title: string
  html_path: string
  status: SessionPageStatus
  error: string | null
  created_at: number
  updated_at: number
}

export class PPTDatabase {
  private db: ReturnType<typeof drizzle>
  private client: ReturnType<typeof createClient>
  private _storagePath: string | null = null
  private _initialized = false
  private _stylesCache: StyleRow[] = []

  constructor(dbPath?: string) {
    const defaultPath = is.dev
      ? path.join(process.cwd(), 'ohmyppt.dev.db')
      : path.join(app.getPath('userData'), 'ohmyppt.db')
    const resolvedPath = dbPath || defaultPath

    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const url = resolvedPath.startsWith('file:') ? resolvedPath : `file:${resolvedPath}`

    this.client = createClient({ url })
    this.db = drizzle(this.client, { schema })
    this._storagePath = null
  }

  async init(): Promise<void> {
    if (this._initialized) return
    await runDatabasePatches({
      client: this.client,
      db: this.db,
      resolveStoragePath: async () =>
        (await this.getSetting<string>('storage_path').catch(() => '')) || ''
    })
    await this.seedStylesFromResources()
    this._initialized = true
  }

  getStoragePath(): string {
    return this._storagePath || ''
  }

  async setStoragePath(storagePath: string): Promise<void> {
    await this.setSetting('storage_path', storagePath)
    this._storagePath = storagePath
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true })
    }
  }

  async close(): Promise<void> {
    await this.client.close()
    this._initialized = false
  }

  // ========== Session ==========

  async createSession(data: {
    id?: string
    title: string
    topic?: string
    styleId?: string
    pageCount?: number
    referenceDocumentPath?: string | null
    provider: string
    model: string
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)

    await this.db
      .insert(schema.sessions)
      .values({
        id,
        title: data.title,
        topic: data.topic || null,
        styleId: data.styleId || null,
        pageCount: data.pageCount || null,
        referenceDocumentPath: data.referenceDocumentPath || null,
        status: 'active',
        provider: data.provider,
        model: data.model,
        createdAt: now,
        updatedAt: now,
        metadata: null
      })
      .run()

    return id
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const result = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get()
    return result as unknown as Session | undefined
  }

  async updateSessionHistoryPointer(args: {
    sessionId: string
    operationId: string | null
    commit: string | null
  }): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({
        currentOperationId: args.operationId,
        currentCommit: args.commit,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(schema.sessions.id, args.sessionId))
      .run()
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.sessions)
      .set({ status, updatedAt: now })
      .where(eq(schema.sessions.id, sessionId))
      .run()
  }

  async updateSessionMetadata(sessionId: string, metadata: object): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ metadata: JSON.stringify(metadata), updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(schema.sessions.id, sessionId))
      .run()
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    const updatedAt = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.sessions)
      .set({ title, updatedAt })
      .where(eq(schema.sessions.id, sessionId))
      .run()
    await this.db
      .update(schema.projects)
      .set({ title, updatedAt })
      .where(eq(schema.projects.sessionId, sessionId))
      .run()
  }

  async updateSessionStyleId(sessionId: string, styleId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.sessions)
      .set({ styleId, updatedAt: now })
      .where(eq(schema.sessions.id, sessionId))
      .run()
  }

  async updateSessionDesignContract(sessionId: string, designContract: unknown): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({
        designContract: designContract ? JSON.stringify(designContract) : null,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(schema.sessions.id, sessionId))
      .run()
  }

  async listSessions(limit = 50, offset = 0): Promise<Session[]> {
    const results = await this.db
      .select()
      .from(schema.sessions)
      .where(ne(schema.sessions.status, 'archived'))
      .orderBy(desc(schema.sessions.updatedAt))
      .limit(limit)
      .offset(offset)
      .all()

    return results as unknown as Session[]
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db
      .delete(schema.generationPages)
      .where(eq(schema.generationPages.sessionId, sessionId))
      .run()
    await this.db
      .delete(schema.generationRuns)
      .where(eq(schema.generationRuns.sessionId, sessionId))
      .run()
    await this.db.delete(schema.projects).where(eq(schema.projects.sessionId, sessionId)).run()
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run()
  }

  // ========== Generation Records ==========

  private normalizeGenerationRunRow(row: Record<string, unknown>): GenerationRunRecord {
    return {
      id: String(row.id || ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      mode: String(row.mode || 'generate') as GenerationRunMode,
      status: String(row.status || 'running') as GenerationRunStatus,
      total_pages: Number(row.totalPages ?? row.total_pages ?? 0) || 0,
      error: typeof row.error === 'string' ? String(row.error) : null,
      metadata: typeof row.metadata === 'string' ? String(row.metadata) : null,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0
    }
  }

  private normalizeGenerationPageRow(row: Record<string, unknown>): GenerationPageRecord {
    return {
      id: String(row.id || ''),
      run_id: String(row.runId ?? row.run_id ?? ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      page_id: String(row.pageId ?? row.page_id ?? ''),
      page_number: Number(row.pageNumber ?? row.page_number ?? 0) || 0,
      title: String(row.title || ''),
      content_outline:
        typeof (row.contentOutline ?? row.content_outline) === 'string'
          ? String(row.contentOutline ?? row.content_outline)
          : null,
      layout_intent:
        typeof (row.layoutIntent ?? row.layout_intent) === 'string'
          ? String(row.layoutIntent ?? row.layout_intent)
          : null,
      html_path:
        typeof (row.htmlPath ?? row.html_path) === 'string'
          ? String(row.htmlPath ?? row.html_path)
          : null,
      status: String(row.status || 'pending') as GenerationPageStatus,
      error: typeof row.error === 'string' ? String(row.error) : null,
      retry_count: Number(row.retryCount ?? row.retry_count ?? 0) || 0,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0
    }
  }

  private normalizeSessionPageRow(row: Record<string, unknown>): SessionPageRecord {
    return {
      id: String(row.id || ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      legacy_page_id:
        typeof (row.legacyPageId ?? row.legacy_page_id) === 'string'
          ? String(row.legacyPageId ?? row.legacy_page_id)
          : null,
      file_slug: String(row.fileSlug ?? row.file_slug ?? ''),
      page_number: Number(row.pageNumber ?? row.page_number ?? 0) || 0,
      title: String(row.title || ''),
      html_path: String(row.htmlPath ?? row.html_path ?? ''),
      status: String(row.status || 'pending') as SessionPageStatus,
      error: typeof row.error === 'string' ? row.error : null,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0,
      deleted_at:
        typeof (row.deletedAt ?? row.deleted_at) === 'number'
          ? Number(row.deletedAt ?? row.deleted_at)
          : null
    }
  }

  async createGenerationRun(data: {
    id?: string
    sessionId: string
    mode: GenerationRunMode
    totalPages: number
    metadata?: unknown
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.generationRuns)
      .values({
        id,
        sessionId: data.sessionId,
        mode: data.mode,
        status: 'running',
        totalPages: Math.max(0, Math.floor(data.totalPages || 0)),
        error: null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return id
  }

  async updateGenerationRunStatus(
    runId: string,
    status: GenerationRunStatus,
    error?: string | null
  ): Promise<void> {
    await this.db
      .update(schema.generationRuns)
      .set({
        status,
        error: error || null,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(schema.generationRuns.id, runId))
      .run()
  }

  async getGenerationRun(runId: string): Promise<GenerationRunRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.id, runId))
      .get()
    return row ? this.normalizeGenerationRunRow(row as Record<string, unknown>) : undefined
  }

  async getLatestGenerationRun(sessionId: string): Promise<GenerationRunRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.sessionId, sessionId))
      .orderBy(desc(schema.generationRuns.createdAt))
      .limit(1)
      .get()
    return row ? this.normalizeGenerationRunRow(row as Record<string, unknown>) : undefined
  }

  async upsertGenerationPage(data: {
    runId: string
    sessionId: string
    pageId: string
    pageNumber: number
    title: string
    contentOutline?: string | null
    layoutIntent?: string | null
    htmlPath?: string | null
    status: GenerationPageStatus
    error?: string | null
    retryCount?: number
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const id = `${data.runId}:${data.pageId}`
    const values = {
      id,
      runId: data.runId,
      sessionId: data.sessionId,
      pageId: data.pageId,
      pageNumber: data.pageNumber,
      title: data.title,
      contentOutline: data.contentOutline || null,
      layoutIntent: data.layoutIntent || null,
      htmlPath: data.htmlPath || null,
      status: data.status,
      error: data.error || null,
      retryCount: Math.max(0, Math.floor(data.retryCount || 0)),
      createdAt: now,
      updatedAt: now
    }
    await this.db
      .insert(schema.generationPages)
      .values(values)
      .onConflictDoUpdate({
        target: schema.generationPages.id,
        set: {
          pageNumber: values.pageNumber,
          title: values.title,
          contentOutline: values.contentOutline,
          layoutIntent: values.layoutIntent,
          htmlPath: values.htmlPath,
          status: values.status,
          error: values.error,
          retryCount: values.retryCount,
          updatedAt: now
        }
      })
      .run()
  }

  async listGenerationPages(runId: string): Promise<GenerationPageRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.generationPages)
      .where(eq(schema.generationPages.runId, runId))
      .orderBy(asc(schema.generationPages.pageNumber))
      .all()
    return rows.map((row) => this.normalizeGenerationPageRow(row as Record<string, unknown>))
  }

  async listLatestFailedGenerationPages(sessionId: string): Promise<GenerationPageRecord[]> {
    const run = await this.getLatestGenerationRun(sessionId)
    if (!run) return []
    return (await this.listGenerationPages(run.id)).filter((page) => page.status === 'failed')
  }

  async listLatestGenerationPageSnapshot(sessionId: string): Promise<GenerationPageRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.generationPages)
      .where(eq(schema.generationPages.sessionId, sessionId))
      .orderBy(asc(schema.generationPages.pageNumber), desc(schema.generationPages.updatedAt))
      .all()
    const latestByPageId = new Map<string, GenerationPageRecord>()
    for (const row of rows) {
      const page = this.normalizeGenerationPageRow(row as Record<string, unknown>)
      if (!page.page_id || latestByPageId.has(page.page_id)) continue
      latestByPageId.set(page.page_id, page)
    }
    return Array.from(latestByPageId.values()).sort((a, b) => a.page_number - b.page_number)
  }

  async listSessionPages(
    sessionId: string,
    options?: { includeDeleted?: boolean }
  ): Promise<SessionPageRecord[]> {
    const conditions = [eq(schema.sessionPages.sessionId, sessionId)]
    if (!options?.includeDeleted) {
      conditions.push(isNull(schema.sessionPages.deletedAt))
    }
    const rows = await this.db
      .select()
      .from(schema.sessionPages)
      .where(and(...conditions))
      .orderBy(asc(schema.sessionPages.pageNumber))
      .all()
    return rows.map((row) => this.normalizeSessionPageRow(row as Record<string, unknown>))
  }

  async upsertSessionPage(page: SessionPageInput): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.sessionPages)
      .values({
        id: page.id,
        sessionId: page.sessionId,
        legacyPageId: page.legacyPageId || null,
        fileSlug: page.fileSlug,
        pageNumber: page.pageNumber,
        title: page.title,
        htmlPath: page.htmlPath,
        status: page.status || 'pending',
        error: page.error || null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null
      })
      .onConflictDoUpdate({
        target: schema.sessionPages.id,
        set: {
          legacyPageId: page.legacyPageId || null,
          fileSlug: page.fileSlug,
          pageNumber: page.pageNumber,
          title: page.title,
          htmlPath: page.htmlPath,
          status: page.status || 'pending',
          error: page.error || null,
          deletedAt: null,
          updatedAt: now
        }
      })
      .run()
  }

  async replaceSessionPageOrder(
    sessionId: string,
    pages: Array<{ id: string; pageNumber: number }>
  ): Promise<void> {
    if (pages.length === 0) return
    const now = Math.floor(Date.now() / 1000)
    const pageIds = pages.map((page) => page.id)
    const caseWhenFragments = pages.map(
      (page) => sql`WHEN ${schema.sessionPages.id} = ${page.id} THEN ${page.pageNumber}`
    )
    const pageNumberExpr = sql<number>`CASE ${sql.join(caseWhenFragments, sql` `)} ELSE ${schema.sessionPages.pageNumber} END`
    await this.db
      .update(schema.sessionPages)
      .set({
        pageNumber: pageNumberExpr,
        updatedAt: now
      })
      .where(and(eq(schema.sessionPages.sessionId, sessionId), inArray(schema.sessionPages.id, pageIds)))
      .run()
  }

  async softDeleteSessionPages(sessionId: string, ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length === 0) return
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.sessionPages)
      .set({
        deletedAt: now,
        updatedAt: now
      })
      .where(and(eq(schema.sessionPages.sessionId, sessionId), inArray(schema.sessionPages.id, ids)))
      .run()
  }

  // ========== Session History ==========

  private normalizeSessionOperationRow(row: Record<string, unknown>): SessionOperationRecord {
    return {
      id: String(row.id || ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      type: String(row.type || 'edit') as SessionOperationType,
      status: String(row.status || 'completed') as SessionOperationStatus,
      scope:
        typeof (row.scope ?? row.scope) === 'string'
          ? (String(row.scope) as SessionOperationScope)
          : null,
      prompt:
        typeof row.prompt === 'string' && row.prompt.trim().length > 0
          ? String(row.prompt)
          : null,
      parent_operation_id:
        typeof (row.parentOperationId ?? row.parent_operation_id) === 'string'
          ? String(row.parentOperationId ?? row.parent_operation_id)
          : null,
      before_commit:
        typeof (row.beforeCommit ?? row.before_commit) === 'string'
          ? String(row.beforeCommit ?? row.before_commit)
          : null,
      after_commit:
        typeof (row.afterCommit ?? row.after_commit) === 'string'
          ? String(row.afterCommit ?? row.after_commit)
          : null,
      target_operation_id:
        typeof (row.targetOperationId ?? row.target_operation_id) === 'string'
          ? String(row.targetOperationId ?? row.target_operation_id)
          : null,
      target_commit:
        typeof (row.targetCommit ?? row.target_commit) === 'string'
          ? String(row.targetCommit ?? row.target_commit)
          : null,
      changed_files_json: String(row.changedFilesJson ?? row.changed_files_json ?? '[]'),
      changed_pages_json: String(row.changedPagesJson ?? row.changed_pages_json ?? '[]'),
      tracked_files_json: String(row.trackedFilesJson ?? row.tracked_files_json ?? '[]'),
      metadata_json: String(row.metadataJson ?? row.metadata_json ?? '{}'),
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      completed_at:
        typeof (row.completedAt ?? row.completed_at) === 'number'
          ? Number(row.completedAt ?? row.completed_at)
          : null
    }
  }

  private normalizeSessionOperationPageRow(row: Record<string, unknown>): SessionOperationPageRecord {
    return {
      id: String(row.id || ''),
      operation_id: String(row.operationId ?? row.operation_id ?? ''),
      session_id: String(row.sessionId ?? row.session_id ?? ''),
      page_id: String(row.pageId ?? row.page_id ?? ''),
      legacy_page_id:
        typeof (row.legacyPageId ?? row.legacy_page_id) === 'string'
          ? String(row.legacyPageId ?? row.legacy_page_id)
          : null,
      file_slug: String(row.fileSlug ?? row.file_slug ?? ''),
      page_number: Number(row.pageNumber ?? row.page_number ?? 0) || 0,
      title: String(row.title || ''),
      html_path: String(row.htmlPath ?? row.html_path ?? ''),
      status: String(row.status || 'pending') as SessionPageStatus,
      error: typeof row.error === 'string' ? String(row.error) : null,
      created_at: Number(row.createdAt ?? row.created_at ?? 0) || 0,
      updated_at: Number(row.updatedAt ?? row.updated_at ?? 0) || 0
    }
  }

  async createSessionOperation(data: {
    id: string
    sessionId: string
    type: SessionOperationType
    status?: SessionOperationStatus
    scope?: SessionOperationScope | null
    prompt?: string | null
    parentOperationId?: string | null
    beforeCommit?: string | null
    targetOperationId?: string | null
    targetCommit?: string | null
    metadata?: unknown
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.sessionOperations)
      .values({
        id: data.id,
        sessionId: data.sessionId,
        type: data.type,
        status: data.status || 'committing',
        scope: data.scope || null,
        prompt: data.prompt || null,
        parentOperationId: data.parentOperationId || null,
        beforeCommit: data.beforeCommit || null,
        afterCommit: null,
        targetOperationId: data.targetOperationId || null,
        targetCommit: data.targetCommit || null,
        changedFilesJson: '[]',
        changedPagesJson: '[]',
        trackedFilesJson: '[]',
        metadataJson: data.metadata ? JSON.stringify(data.metadata) : '{}',
        createdAt: now,
        completedAt: null
      })
      .run()
  }

  async completeSessionOperation(data: {
    id: string
    status: 'completed' | 'noop' | 'failed'
    afterCommit?: string | null
    changedFiles?: unknown[]
    changedPages?: unknown[]
    trackedFiles?: string[]
    metadata?: unknown
  }): Promise<void> {
    await this.db
      .update(schema.sessionOperations)
      .set({
        status: data.status,
        afterCommit: data.afterCommit || null,
        changedFilesJson: JSON.stringify(data.changedFiles || []),
        changedPagesJson: JSON.stringify(data.changedPages || []),
        trackedFilesJson: JSON.stringify(data.trackedFiles || []),
        metadataJson: JSON.stringify(data.metadata || {}),
        completedAt: Math.floor(Date.now() / 1000)
      })
      .where(eq(schema.sessionOperations.id, data.id))
      .run()
  }

  async getSessionOperation(operationId: string): Promise<SessionOperationRecord | undefined> {
    const row = await this.db
      .select()
      .from(schema.sessionOperations)
      .where(eq(schema.sessionOperations.id, operationId))
      .get()
    return row ? this.normalizeSessionOperationRow(row as Record<string, unknown>) : undefined
  }

  async listSessionOperations(
    sessionId: string,
    options?: { limit?: number; includeNoop?: boolean }
  ): Promise<SessionOperationRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.sessionOperations)
      .where(eq(schema.sessionOperations.sessionId, sessionId))
      .orderBy(desc(schema.sessionOperations.createdAt))
      .limit(Math.max(1, Math.min(200, Math.floor(options?.limit || 50))))
      .all()
    return rows
      .map((row) => this.normalizeSessionOperationRow(row as Record<string, unknown>))
      .filter((row) =>
        options?.includeNoop
          ? row.status === 'completed' || row.status === 'noop'
          : row.status === 'completed'
      )
  }

  async replaceSessionOperationPages(
    operationId: string,
    sessionId: string,
    pages: Array<{
      pageId: string
      legacyPageId?: string | null
      fileSlug: string
      pageNumber: number
      title: string
      htmlPath: string
      status?: SessionPageStatus
      error?: string | null
    }>
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .delete(schema.sessionOperationPages)
      .where(eq(schema.sessionOperationPages.operationId, operationId))
      .run()
    for (const page of pages) {
      await this.db
        .insert(schema.sessionOperationPages)
        .values({
          id: `${operationId}:${page.pageId}`,
          operationId,
          sessionId,
          pageId: page.pageId,
          legacyPageId: page.legacyPageId || null,
          fileSlug: page.fileSlug,
          pageNumber: page.pageNumber,
          title: page.title,
          htmlPath: page.htmlPath,
          status: page.status || 'pending',
          error: page.error || null,
          createdAt: now,
          updatedAt: now
        })
        .run()
    }
  }

  async listSessionOperationPages(operationId: string): Promise<SessionOperationPageRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.sessionOperationPages)
      .where(eq(schema.sessionOperationPages.operationId, operationId))
      .orderBy(asc(schema.sessionOperationPages.pageNumber))
      .all()
    return rows.map((row) => this.normalizeSessionOperationPageRow(row as Record<string, unknown>))
  }

  // ========== Messages ==========

  async getSessionMessages(
    sessionId: string,
    options?: {
      chatScope?: ChatScope
      pageId?: string
    }
  ): Promise<Message[]> {
    const chatScope = options?.chatScope ?? 'main'
    const normalizedPageId =
      typeof options?.pageId === 'string' && options.pageId.trim().length > 0
        ? options.pageId.trim()
        : null
    if (chatScope === 'page' && !normalizedPageId) {
      return []
    }
    const whereClause =
      chatScope === 'page' && normalizedPageId
        ? and(
            eq(schema.messages.sessionId, sessionId),
            eq(schema.messages.chatScope, 'page'),
            eq(schema.messages.pageId, normalizedPageId)
          )
        : and(eq(schema.messages.sessionId, sessionId), eq(schema.messages.chatScope, 'main'))
    const results = await this.db
      .select()
      .from(schema.messages)
      .where(whereClause)
      .orderBy(asc(schema.messages.createdAt))
      .all()

    return results.map((message) => this.normalizeMessageRow(message as Record<string, unknown>))
  }

  private normalizeAssetPaths(value: unknown, prefix: './images/' | './videos/'): string[] | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null
    try {
      const parsed = JSON.parse(value) as unknown
      if (!Array.isArray(parsed)) return null
      const valid = parsed
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith(prefix))
        .slice(0, 10)
      return valid.length > 0 ? valid : null
    } catch {
      return null
    }
  }

  private normalizeMessageRow(message: Record<string, unknown>): Message {
    const rawImagePaths = message.imagePaths ?? message.image_paths ?? null
    const rawVideoPaths = message.videoPaths ?? message.video_paths ?? null
    const imagePaths = this.normalizeAssetPaths(rawImagePaths, './images/')
    const videoPaths = this.normalizeAssetPaths(rawVideoPaths, './videos/')
    return {
      id: String(message.id || ''),
      session_id: String(message.sessionId ?? message.session_id ?? ''),
      chat_scope: message.chatScope === 'page' || message.chat_scope === 'page' ? 'page' : 'main',
      page_id:
        typeof (message.pageId ?? message.page_id) === 'string'
          ? String(message.pageId ?? message.page_id)
          : null,
      selector:
        typeof message.selector === 'string' && message.selector.trim().length > 0
          ? message.selector.trim()
          : null,
      image_paths: imagePaths,
      video_paths: videoPaths,
      role: String(message.role || 'system') as MessageRole,
      content: String(message.content || ''),
      type: String(message.type || 'text') as MessageType,
      tool_name:
        typeof (message.toolName ?? message.tool_name) === 'string'
          ? String(message.toolName ?? message.tool_name)
          : null,
      tool_call_id:
        typeof (message.toolCallId ?? message.tool_call_id) === 'string'
          ? String(message.toolCallId ?? message.tool_call_id)
          : null,
      token_count:
        typeof (message.tokenCount ?? message.token_count) === 'number'
          ? Number(message.tokenCount ?? message.token_count)
          : null,
      created_at:
        typeof (message.createdAt ?? message.created_at) === 'number'
          ? Number(message.createdAt ?? message.created_at)
          : Math.floor(Date.now() / 1000)
    }
  }

  async addMessage(
    sessionId: string,
    message: {
      role: MessageRole
      content: string
      type?: MessageType
      tool_name?: string | null
      tool_call_id?: string | null
      token_count?: number | null
      chat_scope?: ChatScope
      page_id?: string | null
      selector?: string | null
      image_paths?: string[] | null
      video_paths?: string[] | null
    }
  ): Promise<string> {
    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const chatScope = message.chat_scope === 'page' ? 'page' : 'main'
    const pageId =
      chatScope === 'page' &&
      typeof message.page_id === 'string' &&
      message.page_id.trim().length > 0
        ? message.page_id.trim()
        : null
    const selector =
      chatScope === 'page' &&
      typeof message.selector === 'string' &&
      message.selector.trim().length > 0
        ? message.selector.trim()
        : null
    const imagePathsRaw = Array.isArray(message.image_paths) ? message.image_paths : []
    const imagePaths =
      imagePathsRaw.length > 0
        ? imagePathsRaw
            .map((item) => String(item || '').trim())
            .filter((item) => item.startsWith('./images/'))
            .slice(0, 10)
        : []
    const videoPathsRaw = Array.isArray(message.video_paths) ? message.video_paths : []
    const videoPaths =
      videoPathsRaw.length > 0
        ? videoPathsRaw
            .map((item) => String(item || '').trim())
            .filter((item) => item.startsWith('./videos/'))
            .slice(0, 10)
        : []
    const imagePathsJson = imagePaths.length > 0 ? JSON.stringify(imagePaths) : null
    const videoPathsJson = videoPaths.length > 0 ? JSON.stringify(videoPaths) : null
    if (chatScope === 'page' && !pageId) {
      throw new Error('page chat message requires page_id')
    }

    await this.db
      .insert(schema.messages)
      .values({
        id,
        sessionId,
        chatScope,
        pageId,
        selector,
        imagePaths: imagePathsJson,
        videoPaths: videoPathsJson,
        role: message.role,
        content: message.content,
        type: message.type || 'text',
        toolName: message.tool_name || null,
        toolCallId: message.tool_call_id || null,
        tokenCount: message.token_count || null,
        createdAt: now
      })
      .run()

    await this.db
      .update(schema.sessions)
      .set({ updatedAt: now })
      .where(eq(schema.sessions.id, sessionId))
      .run()

    return id
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .get()
    return result?.count ?? 0
  }

  async getRecentMessages(sessionId: string, count: number): Promise<Message[]> {
    const results = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(count)
      .all()

    return results.map((message) => this.normalizeMessageRow(message as Record<string, unknown>))
  }

  // ========== Memory ==========

  async getLastSummary(sessionId: string): Promise<MemorySummary | undefined> {
    const result = await this.db
      .select()
      .from(schema.memorySummaries)
      .where(eq(schema.memorySummaries.sessionId, sessionId))
      .orderBy(desc(schema.memorySummaries.messageRangeEnd))
      .limit(1)
      .get()

    return result as MemorySummary | undefined
  }

  async saveSummary(
    sessionId: string,
    data: {
      rangeStart: number
      rangeEnd: number
      summary: string
      tokenCount?: number
    }
  ): Promise<string> {
    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)

    await this.db
      .insert(schema.memorySummaries)
      .values({
        id,
        sessionId,
        messageRangeStart: data.rangeStart,
        messageRangeEnd: data.rangeEnd,
        summary: data.summary,
        tokenCount: data.tokenCount || null,
        createdAt: now
      })
      .run()

    return id
  }

  async getLastCompressedIndex(sessionId: string): Promise<number> {
    const result = await this.db
      .select({ maxIndex: max(schema.memorySummaries.messageRangeEnd) })
      .from(schema.memorySummaries)
      .where(eq(schema.memorySummaries.sessionId, sessionId))
      .get()
    return result?.maxIndex ?? 0
  }

  async getMessagesForCompression(
    sessionId: string,
    batchSize: number
  ): Promise<(Message & { idx: number })[]> {
    const lastCompressedIndex = await this.getLastCompressedIndex(sessionId)

    const results = await this.db
      .select({
        id: schema.messages.id,
        sessionId: schema.messages.sessionId,
        chatScope: schema.messages.chatScope,
        pageId: schema.messages.pageId,
        role: schema.messages.role,
        content: schema.messages.content,
        type: schema.messages.type,
        toolName: schema.messages.toolName,
        toolCallId: schema.messages.toolCallId,
        tokenCount: schema.messages.tokenCount,
        createdAt: schema.messages.createdAt
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.sessionId, sessionId),
          gt(schema.messages.createdAt, lastCompressedIndex)
        )
      )
      .orderBy(asc(schema.messages.createdAt))
      .limit(batchSize)
      .all()

    let idx = lastCompressedIndex + 1
    return results.map((r) => ({
      ...r,
      idx: idx++
    })) as unknown as (Message & { idx: number })[]
  }

  // ========== Settings ==========

  async getSetting<T>(key: string): Promise<T | undefined> {
    const result = await this.db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .get()
    if (!result) return undefined
    try {
      return JSON.parse(result.value) as T
    } catch {
      return result.value as T
    }
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.settings)
      .values({ key, value: JSON.stringify(value), updatedAt: now })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: JSON.stringify(value), updatedAt: now }
      })
      .run()
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const results = await this.db.select().from(schema.settings).all()
    const result: Record<string, unknown> = {}
    for (const row of results) {
      try {
        result[row.key] = JSON.parse(row.value)
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  }

  // ========== Model Configs ==========

  async listModelConfigs(): Promise<ModelConfigRow[]> {
    const results = await this.db
      .select()
      .from(schema.modelConfigs)
      .orderBy(desc(schema.modelConfigs.active), desc(schema.modelConfigs.updatedAt))
      .all()
    return results as unknown as ModelConfigRow[]
  }

  async getActiveModelConfig(): Promise<ModelConfigRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.active, 1))
      .limit(1)
      .get()
    return result as unknown as ModelConfigRow | undefined
  }

  async upsertModelConfig(data: {
    id?: string
    name: string
    provider: string
    model: string
    apiKey: string
    baseUrl: string
    active?: boolean
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    if (data.active) {
      await this.db
        .update(schema.modelConfigs)
        .set({ active: 0, updatedAt: now })
        .where(eq(schema.modelConfigs.active, 1))
        .run()
    }
    await this.db
      .insert(schema.modelConfigs)
      .values({
        id,
        name: data.name,
        provider: data.provider,
        model: data.model,
        apiKey: data.apiKey,
        baseUrl: data.baseUrl,
        active: data.active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: schema.modelConfigs.id,
        set: {
          name: data.name,
          provider: data.provider,
          model: data.model,
          apiKey: data.apiKey,
          baseUrl: data.baseUrl,
          active: data.active ? 1 : 0,
          updatedAt: now
        }
      })
      .run()
    return id
  }

  async setActiveModelConfig(id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const existing = await this.db
      .select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, id))
      .get()
    if (!existing) throw new Error('Model config does not exist')
    await this.db
      .update(schema.modelConfigs)
      .set({ active: 0, updatedAt: now })
      .where(eq(schema.modelConfigs.active, 1))
      .run()
    await this.db
      .update(schema.modelConfigs)
      .set({ active: 1, updatedAt: now })
      .where(eq(schema.modelConfigs.id, id))
      .run()
  }

  async deleteModelConfig(id: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, id))
      .get()
    if (!existing) throw new Error('Model config does not exist')
    await this.db.delete(schema.modelConfigs).where(eq(schema.modelConfigs.id, id)).run()
  }

  // ========== Preferences ==========

  async getActiveUserPreferences(): Promise<UserPreference[]> {
    const results = await this.db
      .select()
      .from(schema.userPreferences)
      .where(gt(schema.userPreferences.confidence, 0.3))
      .orderBy(desc(schema.userPreferences.confidence), desc(schema.userPreferences.lastUsedAt))
      .limit(10)
      .all()

    return results.map((r) => ({
      key: r.key,
      value: JSON.parse(r.value),
      confidence: r.confidence,
      source_sessions: r.sourceSessions ? JSON.parse(r.sourceSessions) : [],
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      last_used_at: r.lastUsedAt
    })) as unknown as UserPreference[]
  }

  async upsertPreference(
    key: string,
    data: { value: unknown; confidence?: number; sourceSessions?: string[] }
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const existing = await this.db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.key, key))
      .get()

    if (existing) {
      const existingSources = existing.sourceSessions ? JSON.parse(existing.sourceSessions) : []
      const newSources = data.sourceSessions
        ? [...new Set([...existingSources, ...data.sourceSessions])]
        : existingSources
      const baseConfidence = existing.confidence ?? 0.5
      const increment = (data.confidence ?? 0.5) * 0.3
      const newConfidence = Math.min(1.0, baseConfidence + increment)

      await this.db
        .update(schema.userPreferences)
        .set({
          value: JSON.stringify(data.value),
          confidence: newConfidence,
          sourceSessions: JSON.stringify(newSources),
          updatedAt: now,
          lastUsedAt: now
        })
        .where(eq(schema.userPreferences.key, key))
        .run()
    } else {
      await this.db
        .insert(schema.userPreferences)
        .values({
          key,
          value: JSON.stringify(data.value),
          confidence: data.confidence || 0.5,
          sourceSessions: JSON.stringify(data.sourceSessions || []),
          createdAt: now,
          updatedAt: now,
          lastUsedAt: now
        })
        .run()
    }
  }

  async decayPreferences(): Promise<void> {
    await this.db
      .update(schema.userPreferences)
      .set({ confidence: sql`${schema.userPreferences.confidence} * 0.95` })
      .where(gt(schema.userPreferences.confidence, 0.1))
      .run()

    await this.db
      .delete(schema.userPreferences)
      .where(lte(schema.userPreferences.confidence, 0.1))
      .run()
  }

  // ========== Projects ==========

  async createProject(data: {
    session_id: string
    title: string
    output_path: string
  }): Promise<string> {
    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)

    await this.db
      .insert(schema.projects)
      .values({
        id,
        sessionId: data.session_id,
        title: data.title,
        outputPath: data.output_path,
        fileCount: 0,
        totalSize: 0,
        status: 'draft',
        createdAt: now,
        updatedAt: now
      })
      .run()

    return id
  }

  async getProject(sessionId: string): Promise<Project | undefined> {
    const result = await this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.sessionId, sessionId))
      .orderBy(desc(schema.projects.createdAt))
      .limit(1)
      .get()

    return result as Project | undefined
  }

  async updateProjectStatus(
    projectId: string,
    status: 'draft' | 'published' | 'exported'
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .update(schema.projects)
      .set({ status, updatedAt: now })
      .where(eq(schema.projects.id, projectId))
      .run()
  }

  // ========== Styles ==========

  async countStyles(): Promise<number> {
    const result = await this.db.select({ count: count() }).from(schema.styles).get()
    return result?.count ?? 0
  }

  async seedStylesFromResources(): Promise<void> {
    const rowCount = await this.countStyles()
    if (rowCount > 0) {
      await this._refreshStylesCache()
      return
    }

    const stylesPath = is.dev
      ? path.join(process.cwd(), 'resources', 'styles.json')
      : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'styles.json')

    if (!fs.existsSync(stylesPath)) {
      console.warn('[db] styles.json not found at', stylesPath)
      return
    }

    const raw = fs.readFileSync(stylesPath, 'utf-8')
    const items: Array<{
      style: string
      styleName: string
      description?: string
      category?: string
      aliases?: string[]
      source?: string
      styleSkill?: string
    }> = JSON.parse(raw)

    const now = Math.floor(Date.now() / 1000)
    for (const item of items) {
      const id = crypto.randomUUID()
      await this.db
        .insert(schema.styles)
        .values({
          id,
          style: item.style,
          styleName: item.styleName,
          description: item.description || '',
          category: item.category || '',
          aliases: JSON.stringify(item.aliases || []),
          source: (item.source as StyleSource) || 'builtin',
          styleSkill: item.styleSkill || '',
          createdAt: now,
          updatedAt: now
        })
        .run()
    }
    await this._refreshStylesCache()
  }

  private async _refreshStylesCache(): Promise<void> {
    const results = await this.db
      .select()
      .from(schema.styles)
      .orderBy(asc(schema.styles.style))
      .all()
    this._stylesCache = results as unknown as StyleRow[]
  }

  /** Synchronous read from in-memory cache. Used by prompt builders. */
  listStyleRowsSync(): StyleRow[] {
    return this._stylesCache
  }

  /** Synchronous cache lookup. */
  getStyleRowSync(styleId: string): StyleRow | undefined {
    return this._stylesCache.find((r) => r.id === styleId)
  }

  /** Synchronous cache lookup by style key. */
  getStyleRowByStyleSync(style: string): StyleRow | undefined {
    return this._stylesCache.find((r) => r.style === style)
  }

  async listStyleRows(): Promise<StyleRow[]> {
    const results = await this.db
      .select()
      .from(schema.styles)
      .orderBy(asc(schema.styles.style))
      .all()
    return results as unknown as StyleRow[]
  }

  async getStyleRow(styleId: string): Promise<StyleRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.styles)
      .where(eq(schema.styles.id, styleId))
      .get()
    return result as unknown as StyleRow | undefined
  }

  async createStyleRow(data: {
    id?: string
    style: string
    styleName: string
    description?: string
    category?: string
    aliases?: string[]
    source?: StyleSource
    styleSkill?: string
  }): Promise<string> {
    const id = data.id || crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    await this.db
      .insert(schema.styles)
      .values({
        id,
        style: data.style,
        styleName: data.styleName,
        description: data.description || '',
        category: data.category || '',
        aliases: JSON.stringify(data.aliases || []),
        source: data.source || 'custom',
        styleSkill: data.styleSkill || '',
        createdAt: now,
        updatedAt: now
      })
      .run()
    await this._refreshStylesCache()
    return id
  }

  async updateStyleRow(
    styleId: string,
    data: {
      styleName?: string
      description?: string
      category?: string
      aliases?: string[]
      source?: StyleSource
      styleSkill?: string
    }
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const set: Record<string, unknown> = { updatedAt: now }
    if (data.styleName !== undefined) set.styleName = data.styleName
    if (data.description !== undefined) set.description = data.description
    if (data.category !== undefined) set.category = data.category
    if (data.aliases !== undefined) set.aliases = JSON.stringify(data.aliases)
    if (data.source !== undefined) set.source = data.source
    if (data.styleSkill !== undefined) set.styleSkill = data.styleSkill
    await this.db.update(schema.styles).set(set).where(eq(schema.styles.id, styleId)).run()
    await this._refreshStylesCache()
  }

  async deleteStyleRow(styleId: string): Promise<boolean> {
    const existing = await this.getStyleRow(styleId)
    if (!existing) return false
    await this.db.delete(schema.styles).where(eq(schema.styles.id, styleId)).run()
    await this._refreshStylesCache()
    return true
  }
}
