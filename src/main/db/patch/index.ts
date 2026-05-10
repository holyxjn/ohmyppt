import type { createClient } from '@libsql/client'
import type { drizzle } from 'drizzle-orm/libsql'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import * as schema from '../schema'
import type { GenerationPageStatus, GenerationRunStatus } from '../schema'
import { defaultModelTimeoutMs } from '@shared/model-timeout'

type LibSqlClient = ReturnType<typeof createClient>
type DrizzleDb = ReturnType<typeof drizzle>

const SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const MESSAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chat_scope TEXT NOT NULL DEFAULT 'main',
  page_id TEXT,
  selector TEXT,
  image_paths TEXT,
  video_paths TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  token_count INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_scope ON messages(session_id, chat_scope, page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_only ON messages(session_id);
`

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT,
  style_id TEXT,
  page_count INTEGER,
  reference_document_path TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT,
  design_contract TEXT,
  current_operation_id TEXT,
  current_commit TEXT
);

${MESSAGES_TABLE_SQL}

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  output_path TEXT NOT NULL,
  file_count INTEGER DEFAULT 0,
  total_size INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

${SETTINGS_TABLE_SQL}

CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_single_active ON model_configs(active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_model_configs_updated ON model_configs(updated_at);

CREATE TABLE IF NOT EXISTS memory_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_range_start INTEGER NOT NULL,
  message_range_end INTEGER NOT NULL,
  summary TEXT NOT NULL,
  token_count INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_summaries_session ON memory_summaries(session_id, message_range_end);

CREATE INDEX IF NOT EXISTS idx_projects_session ON projects(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_session_id ON memory_summaries(session_id);

CREATE TABLE IF NOT EXISTS generation_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'generate',
  status TEXT NOT NULL DEFAULT 'running',
  total_pages INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generation_runs_session ON generation_runs(session_id, created_at);

CREATE TABLE IF NOT EXISTS generation_pages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_outline TEXT,
  layout_intent TEXT,
  html_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generation_pages_run ON generation_pages(run_id, page_number);
CREATE INDEX IF NOT EXISTS idx_generation_pages_session_status ON generation_pages(session_id, status, page_number);

CREATE TABLE IF NOT EXISTS session_pages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  legacy_page_id TEXT,
  file_slug TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  html_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_session_pages_session_number ON session_pages(session_id, page_number);

CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  source_sessions TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS styles (
  id TEXT PRIMARY KEY,
  style TEXT UNIQUE NOT NULL,
  style_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'custom',
  style_skill TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_styles_style ON styles(style);

CREATE TABLE IF NOT EXISTS session_operations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  scope TEXT,
  prompt TEXT,
  parent_operation_id TEXT,
  before_commit TEXT,
  after_commit TEXT,
  target_operation_id TEXT,
  target_commit TEXT,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  changed_pages_json TEXT NOT NULL DEFAULT '[]',
  tracked_files_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_session_operations_session_created ON session_operations(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_operations_session_status ON session_operations(session_id, status, created_at);

CREATE TABLE IF NOT EXISTS session_operation_pages (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES session_operations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  legacy_page_id TEXT,
  file_slug TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  html_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_operation_pages_order ON session_operation_pages(operation_id, page_number);
CREATE INDEX IF NOT EXISTS idx_session_operation_pages_session ON session_operation_pages(session_id, operation_id);
`

const getRowValue = (row: unknown, key: string): unknown => {
  if (row && typeof row === 'object' && !Array.isArray(row) && key in row) {
    return (row as Record<string, unknown>)[key]
  }
  return undefined
}

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string' || value.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const toPositiveInt = (value: unknown, fallback: number): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

const inferPageNumber = (page: Record<string, unknown>, fallback: number): number => {
  const explicit = toPositiveInt(page.pageNumber ?? page.page_number, 0)
  if (explicit > 0) return explicit
  const rawPageId =
    typeof (page.pageId ?? page.page_id) === 'string'
      ? String(page.pageId ?? page.page_id).trim()
      : ''
  const fromPageId = toPositiveInt(rawPageId.match(/^page-(\d+)$/i)?.[1], 0)
  return fromPageId > 0 ? fromPageId : fallback
}

const resolveLegacyPagePath = (
  page: Record<string, unknown>,
  projectDir: string,
  pageId: string
): string => {
  const rawPath =
    typeof (page.htmlPath ?? page.html_path) === 'string'
      ? String(page.htmlPath ?? page.html_path).trim()
      : ''
  if (!rawPath) return path.join(projectDir, `${pageId}.html`)
  return path.isAbsolute(rawPath) ? rawPath : path.join(projectDir, rawPath)
}

const getTableColumns = async (
  client: LibSqlClient,
  tableName: 'settings' | 'messages' | 'sessions' | 'generation_pages' | 'session_pages'
): Promise<Set<string>> => {
  const result = await client.execute(`PRAGMA table_info(${tableName})`)
  const rows = Array.isArray((result as { rows?: unknown[] }).rows)
    ? ((result as { rows?: unknown[] }).rows as unknown[])
    : []
  const columns = new Set<string>()
  for (const row of rows) {
    if (row && typeof row === 'object' && 'name' in row) {
      const name = (row as { name?: unknown }).name
      if (typeof name === 'string' && name.trim().length > 0) {
        columns.add(name.trim())
      }
      continue
    }
    if (Array.isArray(row) && typeof row[1] === 'string' && row[1].trim().length > 0) {
      columns.add(row[1].trim())
    }
  }
  return columns
}

const enforceSettingsSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(SETTINGS_TABLE_SQL)
  const columns = await getTableColumns(client, 'settings')
  if (!columns.has('value')) {
    await client.execute(`ALTER TABLE settings ADD COLUMN value TEXT NOT NULL DEFAULT '""'`)
  }
  if (!columns.has('updated_at')) {
    await client.execute('ALTER TABLE settings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
  }
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key)')
}

const enforceModelConfigsSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_single_active ON model_configs(active) WHERE active = 1'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_model_configs_updated ON model_configs(updated_at)'
  )
}

const enforceSessionsSchema = async (client: LibSqlClient): Promise<void> => {
  const columns = await getTableColumns(client, 'sessions')
  if (!columns.has('style_id')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN style_id TEXT')
  }
  if (!columns.has('reference_document_path')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN reference_document_path TEXT')
  }
  if (!columns.has('current_operation_id')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN current_operation_id TEXT')
  }
  if (!columns.has('current_commit')) {
    await client.execute('ALTER TABLE sessions ADD COLUMN current_commit TEXT')
  }
}

const enforceSessionOperationsSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS session_operations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      scope TEXT,
      prompt TEXT,
      parent_operation_id TEXT,
      before_commit TEXT,
      after_commit TEXT,
      target_operation_id TEXT,
      target_commit TEXT,
      changed_files_json TEXT NOT NULL DEFAULT '[]',
      changed_pages_json TEXT NOT NULL DEFAULT '[]',
      tracked_files_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `)
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_operations_session_created ON session_operations(session_id, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_operations_session_status ON session_operations(session_id, status, created_at)'
  )
}

const enforceSessionOperationPagesSchema = async (client: LibSqlClient): Promise<void> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS session_operation_pages (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL REFERENCES session_operations(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL,
      legacy_page_id TEXT,
      file_slug TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      html_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_operation_pages_order ON session_operation_pages(operation_id, page_number)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_operation_pages_session ON session_operation_pages(session_id, operation_id)'
  )
}

const enforceMessagesSchema = async (client: LibSqlClient): Promise<void> => {
  await client.executeMultiple(MESSAGES_TABLE_SQL)
  const columns = await getTableColumns(client, 'messages')
  if (!columns.has('chat_scope')) {
    await client.execute(`ALTER TABLE messages ADD COLUMN chat_scope TEXT NOT NULL DEFAULT 'main'`)
  }
  if (!columns.has('page_id')) {
    await client.execute('ALTER TABLE messages ADD COLUMN page_id TEXT')
  }
  if (!columns.has('selector')) {
    await client.execute('ALTER TABLE messages ADD COLUMN selector TEXT')
  }
  if (!columns.has('image_paths')) {
    await client.execute('ALTER TABLE messages ADD COLUMN image_paths TEXT')
  }
  if (!columns.has('video_paths')) {
    await client.execute('ALTER TABLE messages ADD COLUMN video_paths TEXT')
  }
  if (!columns.has('type')) {
    await client.execute('ALTER TABLE messages ADD COLUMN type TEXT')
  }
  if (!columns.has('tool_name')) {
    await client.execute('ALTER TABLE messages ADD COLUMN tool_name TEXT')
  }
  if (!columns.has('tool_call_id')) {
    await client.execute('ALTER TABLE messages ADD COLUMN tool_call_id TEXT')
  }
  if (!columns.has('token_count')) {
    await client.execute('ALTER TABLE messages ADD COLUMN token_count INTEGER')
  }
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_messages_session_scope ON messages(session_id, chat_scope, page_id, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_messages_session_only ON messages(session_id)'
  )
}

const enforceGenerationSchema = async (client: LibSqlClient): Promise<void> => {
  const columns = await getTableColumns(client, 'generation_pages')
  if (!columns.has('content_outline')) {
    await client.execute('ALTER TABLE generation_pages ADD COLUMN content_outline TEXT')
  }
  if (!columns.has('layout_intent')) {
    await client.execute('ALTER TABLE generation_pages ADD COLUMN layout_intent TEXT')
  }
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_generation_runs_session ON generation_runs(session_id, created_at)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_generation_pages_run ON generation_pages(run_id, page_number)'
  )
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_generation_pages_session_status ON generation_pages(session_id, status, page_number)'
  )
}

const enforceSessionPagesSchema = async (client: LibSqlClient): Promise<void> => {
  const columns = await getTableColumns(client, 'session_pages')
  if (!columns.has('legacy_page_id')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN legacy_page_id TEXT')
  }
  if (!columns.has('file_slug')) {
    await client.execute("ALTER TABLE session_pages ADD COLUMN file_slug TEXT NOT NULL DEFAULT ''")
  }
  if (!columns.has('status')) {
    await client.execute(
      "ALTER TABLE session_pages ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"
    )
  }
  if (!columns.has('error')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN error TEXT')
  }
  if (!columns.has('deleted_at')) {
    await client.execute('ALTER TABLE session_pages ADD COLUMN deleted_at INTEGER')
  }
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_session_pages_session_number ON session_pages(session_id, page_number)'
  )
}

const ensureDefaultSettings = async (client: LibSqlClient): Promise<void> => {
  const now = Math.floor(Date.now() / 1000)
  const defaults = [
    { key: 'theme', value: '"light"' },
    { key: 'locale', value: '"zh"' },
    { key: 'timeout_ms_planning', value: JSON.stringify(defaultModelTimeoutMs('planning')) },
    { key: 'timeout_ms_design', value: JSON.stringify(defaultModelTimeoutMs('design')) },
    { key: 'timeout_ms_agent', value: JSON.stringify(defaultModelTimeoutMs('agent')) },
    { key: 'timeout_ms_document', value: JSON.stringify(defaultModelTimeoutMs('document')) }
  ]

  for (const { key, value } of defaults) {
    await client.execute({
      sql: 'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      args: [key, value, now]
    })
  }
}

const resolveLegacyProjectDir = async (
  client: LibSqlClient,
  sessionId: string,
  metadata: Record<string, unknown>,
  resolveStoragePath: () => Promise<string>
): Promise<string> => {
  const projectResult = await client
    .execute({
      sql: 'SELECT output_path FROM projects WHERE session_id = ? LIMIT 1',
      args: [sessionId]
    })
    .catch(() => ({ rows: [] as unknown[] }))
  const outputPath = getRowValue(projectResult.rows?.[0], 'output_path')
  if (typeof outputPath === 'string' && outputPath.trim().length > 0) {
    return outputPath.trim()
  }
  if (typeof metadata.indexPath === 'string' && metadata.indexPath.trim().length > 0) {
    return path.dirname(metadata.indexPath.trim())
  }
  const storagePath = await resolveStoragePath().catch(() => '')
  return path.join(storagePath || process.cwd(), sessionId)
}

const upsertPatchedGenerationPage = async (
  db: DrizzleDb,
  data: {
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
  }
): Promise<void> => {
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
  await db
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

const patchGenerationRecordsFromMetadata = async (args: {
  client: LibSqlClient
  db: DrizzleDb
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, db, resolveStoragePath } = args
  const sessions = await client.execute(`
    SELECT id, page_count, status, metadata, updated_at
    FROM sessions
    WHERE metadata IS NOT NULL
      AND TRIM(metadata) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM generation_runs WHERE generation_runs.session_id = sessions.id
      )
    ORDER BY updated_at DESC
  `)

  for (const row of sessions.rows || []) {
    const sessionId = String(getRowValue(row, 'id') || '')
    if (!sessionId) continue
    const metadata = parseJsonObject(getRowValue(row, 'metadata'))
    const generatedPages = Array.isArray(metadata.generatedPages)
      ? metadata.generatedPages.filter(
          (page): page is Record<string, unknown> =>
            Boolean(page) && typeof page === 'object' && !Array.isArray(page)
        )
      : []
    const failedPages = Array.isArray(metadata.failedPages)
      ? metadata.failedPages.filter(
          (page): page is Record<string, unknown> =>
            Boolean(page) && typeof page === 'object' && !Array.isArray(page)
        )
      : []
    if (generatedPages.length === 0 && failedPages.length === 0) continue

    const projectDir = await resolveLegacyProjectDir(
      client,
      sessionId,
      metadata,
      resolveStoragePath
    )
    const pageMap = new Map<
      string,
      {
        pageId: string
        pageNumber: number
        title: string
        contentOutline: string
        layoutIntent: string | null
        htmlPath: string
        status: GenerationPageStatus
        error: string | null
        retryCount: number
      }
    >()

    generatedPages.forEach((page, index) => {
      const pageNumber = inferPageNumber(page, index + 1)
      const rawPageId =
        typeof (page.pageId ?? page.page_id) === 'string'
          ? String(page.pageId ?? page.page_id).trim()
          : ''
      const pageId = rawPageId || `page-${pageNumber}`
      pageMap.set(pageId, {
        pageId,
        pageNumber,
        title: String(page.title || `第 ${pageNumber} 页`),
        contentOutline: String(page.contentOutline ?? page.content_outline ?? ''),
        layoutIntent:
          typeof (page.layoutIntent ?? page.layout_intent) === 'string'
            ? String(page.layoutIntent ?? page.layout_intent)
            : null,
        htmlPath: resolveLegacyPagePath(page, projectDir, pageId),
        status: 'completed',
        error: null,
        retryCount: toPositiveInt(page.retryCount ?? page.retry_count, 0)
      })
    })

    failedPages.forEach((page, index) => {
      const pageNumber = inferPageNumber(page, generatedPages.length + index + 1)
      const rawPageId =
        typeof (page.pageId ?? page.page_id) === 'string'
          ? String(page.pageId ?? page.page_id).trim()
          : ''
      const pageId = rawPageId || `page-${pageNumber}`
      pageMap.set(pageId, {
        pageId,
        pageNumber,
        title: String(page.title || `第 ${pageNumber} 页`),
        contentOutline: String(page.contentOutline ?? page.content_outline ?? ''),
        layoutIntent:
          typeof (page.layoutIntent ?? page.layout_intent) === 'string'
            ? String(page.layoutIntent ?? page.layout_intent)
            : null,
        htmlPath: resolveLegacyPagePath(page, projectDir, pageId),
        status: 'failed',
        error: String(page.reason || page.error || '旧 metadata 记录的失败页'),
        retryCount: toPositiveInt(page.retryCount ?? page.retry_count, 0)
      })
    })

    const pages = Array.from(pageMap.values()).sort((a, b) => a.pageNumber - b.pageNumber)
    if (pages.length === 0) continue

    const generatedCount = pages.filter((page) => page.status === 'completed').length
    const failedCount = pages.filter((page) => page.status === 'failed').length
    const totalPages = Math.max(toPositiveInt(getRowValue(row, 'page_count'), 0), pages.length)
    const runStatus: GenerationRunStatus =
      failedCount > 0 ? (generatedCount > 0 ? 'partial' : 'failed') : 'completed'
    const runId = `patch-${sessionId}`
    const updatedAt = toPositiveInt(getRowValue(row, 'updated_at'), Math.floor(Date.now() / 1000))

    await db
      .insert(schema.generationRuns)
      .values({
        id: runId,
        sessionId,
        mode: 'generate',
        status: runStatus,
        totalPages,
        error: failedCount > 0 ? `${failedCount} page(s) failed in legacy metadata` : null,
        metadata: JSON.stringify({
          source: 'metadata_patch',
          generatedCount,
          failedCount,
          patchedAt: new Date().toISOString()
        }),
        createdAt: updatedAt,
        updatedAt: Math.floor(Date.now() / 1000)
      })
      .onConflictDoNothing()
      .run()

    for (const page of pages) {
      await upsertPatchedGenerationPage(db, {
        runId,
        sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent,
        htmlPath: page.htmlPath,
        status: page.status,
        error: page.error,
        retryCount: page.retryCount
      })
    }
  }
}

const patchSessionPagesFromLegacy = async (args: {
  client: LibSqlClient
  db: DrizzleDb
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, db, resolveStoragePath } = args
  const sessions = await client.execute(`
    SELECT id, metadata, updated_at
    FROM sessions
    WHERE metadata IS NOT NULL
      AND TRIM(metadata) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM session_pages WHERE session_pages.session_id = sessions.id
      )
    ORDER BY updated_at DESC
  `)

  for (const row of sessions.rows || []) {
    const sessionId = String(getRowValue(row, 'id') || '')
    if (!sessionId) continue
    const metadata = parseJsonObject(getRowValue(row, 'metadata'))
    const generatedPages = Array.isArray(metadata.generatedPages)
      ? metadata.generatedPages.filter(
          (page): page is Record<string, unknown> =>
            Boolean(page) && typeof page === 'object' && !Array.isArray(page)
        )
      : []
    const failedPages = Array.isArray(metadata.failedPages)
      ? metadata.failedPages.filter(
          (page): page is Record<string, unknown> =>
            Boolean(page) && typeof page === 'object' && !Array.isArray(page)
        )
      : []
    if (generatedPages.length === 0 && failedPages.length === 0) continue

    const pageMap = new Map<
      string,
      {
        pageNumber: number
        fileSlug: string
        title: string
        htmlPath: string
        status: 'completed' | 'failed'
        error: string | null
      }
    >()
    const failedById = new Map<string, string>()
    for (const failed of failedPages) {
      const pageNumber = inferPageNumber(failed, generatedPages.length + failedById.size + 1)
      const failedPageId =
        typeof (failed.pageId ?? failed.page_id) === 'string'
          ? String(failed.pageId ?? failed.page_id).trim()
          : ''
      const fileSlug = failedPageId || `page-${pageNumber}`
      failedById.set(fileSlug, String(failed.reason || failed.error || '页面生成失败'))
      pageMap.set(fileSlug, {
        pageNumber,
        fileSlug,
        title: String(failed.title || `第 ${pageNumber} 页`),
        htmlPath: '',
        status: 'failed',
        error: String(failed.reason || failed.error || '页面生成失败')
      })
    }

    const projectDir = await resolveLegacyProjectDir(
      client,
      sessionId,
      metadata,
      resolveStoragePath
    )
    const now = Math.floor(Date.now() / 1000)

    for (let index = 0; index < generatedPages.length; index += 1) {
      const page = generatedPages[index]
      const pageNumber = inferPageNumber(page, index + 1)
      const rawPageId =
        typeof (page.pageId ?? page.page_id) === 'string'
          ? String(page.pageId ?? page.page_id).trim()
          : ''
      const fileSlug = rawPageId || `page-${pageNumber}`
      const htmlPath = resolveLegacyPagePath(page, projectDir, fileSlug)
      const title = String(page.title || `第 ${pageNumber} 页`)
      const failedReason = failedById.get(fileSlug)
      const status = failedReason
        ? ('failed' as const)
        : fsExistsSafe(htmlPath)
          ? ('completed' as const)
          : ('failed' as const)
      const error = failedReason || (status === 'failed' ? '页面文件不存在' : null)
      pageMap.set(fileSlug, {
        pageNumber,
        fileSlug,
        title,
        htmlPath,
        status,
        error
      })
    }

    for (const page of pageMap.values()) {
      if (!page.htmlPath) {
        page.htmlPath = path.join(projectDir, `${page.fileSlug}.html`)
      }
      await db
        .insert(schema.sessionPages)
        .values({
          id: nanoid(),
          sessionId,
          legacyPageId: /^page-\d+$/i.test(page.fileSlug) ? page.fileSlug : null,
          fileSlug: page.fileSlug,
          pageNumber: page.pageNumber,
          title: page.title,
          htmlPath: page.htmlPath,
          status: page.status,
          error: page.error,
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        })
        .onConflictDoNothing()
        .run()
    }
  }
}

const patchSessionPagesFromGenerationPages = async (args: {
  client: LibSqlClient
  db: DrizzleDb
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, db, resolveStoragePath } = args
  const rows = await client.execute(`
    SELECT
      sessions.id AS session_id,
      sessions.metadata AS metadata,
      sessions.updated_at AS session_updated_at,
      generation_pages.page_id AS page_id,
      generation_pages.page_number AS page_number,
      generation_pages.title AS title,
      generation_pages.html_path AS html_path,
      generation_pages.status AS status,
      generation_pages.error AS error,
      generation_pages.created_at AS created_at,
      generation_pages.updated_at AS updated_at
    FROM sessions
    INNER JOIN generation_pages ON generation_pages.session_id = sessions.id
    WHERE NOT EXISTS (
      SELECT 1 FROM session_pages WHERE session_pages.session_id = sessions.id
    )
    ORDER BY sessions.updated_at DESC, generation_pages.page_number ASC, generation_pages.updated_at DESC
  `)

  const bySession = new Map<string, unknown[]>()
  for (const row of rows.rows || []) {
    const sessionId = String(getRowValue(row, 'session_id') || '')
    if (!sessionId) continue
    const list = bySession.get(sessionId) || []
    list.push(row)
    bySession.set(sessionId, list)
  }

  for (const [sessionId, sessionRows] of bySession.entries()) {
    const firstRow = sessionRows[0]
    const metadata = parseJsonObject(getRowValue(firstRow, 'metadata'))
    const projectDir = await resolveLegacyProjectDir(
      client,
      sessionId,
      metadata,
      resolveStoragePath
    )
    const latestBySlug = new Map<string, Record<string, unknown>>()
    for (const row of sessionRows) {
      const pageId = String(getRowValue(row, 'page_id') || '').trim()
      if (!pageId || latestBySlug.has(pageId)) continue
      latestBySlug.set(pageId, row as Record<string, unknown>)
    }

    const now = Math.floor(Date.now() / 1000)
    const pages = Array.from(latestBySlug.values()).sort((a, b) => {
      const aNumber = toPositiveInt(getRowValue(a, 'page_number'), 0)
      const bNumber = toPositiveInt(getRowValue(b, 'page_number'), 0)
      return aNumber - bNumber
    })

    for (let index = 0; index < pages.length; index += 1) {
      const row = pages[index]
      const fileSlug = String(getRowValue(row, 'page_id') || `page-${index + 1}`).trim()
      const pageNumber = toPositiveInt(getRowValue(row, 'page_number'), index + 1)
      const rawHtmlPath = String(getRowValue(row, 'html_path') || '').trim()
      const htmlPath = rawHtmlPath
        ? path.isAbsolute(rawHtmlPath)
          ? rawHtmlPath
          : path.join(projectDir, rawHtmlPath)
        : path.join(projectDir, `${fileSlug}.html`)
      const rawStatus = String(getRowValue(row, 'status') || '').trim()
      const status =
        rawStatus === 'completed' && fsExistsSafe(htmlPath)
          ? ('completed' as const)
          : ('failed' as const)
      const error =
        status === 'failed'
          ? String(getRowValue(row, 'error') || (fsExistsSafe(htmlPath) ? '页面生成失败' : '页面文件不存在'))
          : null

      await db
        .insert(schema.sessionPages)
        .values({
          id: nanoid(),
          sessionId,
          legacyPageId: /^page-\d+$/i.test(fileSlug) ? fileSlug : null,
          fileSlug,
          pageNumber,
          title: String(getRowValue(row, 'title') || `第 ${pageNumber} 页`),
          htmlPath,
          status,
          error,
          createdAt: toPositiveInt(getRowValue(row, 'created_at'), now),
          updatedAt: now,
          deletedAt: null
        })
        .onConflictDoNothing()
        .run()
    }
  }
}

const fsExistsSafe = (filePath: string): boolean => {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

export const runDatabasePatches = async (args: {
  client: LibSqlClient
  db: DrizzleDb
  resolveStoragePath: () => Promise<string>
}): Promise<void> => {
  const { client, db, resolveStoragePath } = args
  await client.executeMultiple(INIT_SQL)
  await enforceSessionsSchema(client)
  await enforceSettingsSchema(client)
  await enforceModelConfigsSchema(client)
  await enforceMessagesSchema(client)
  await enforceGenerationSchema(client)
  await enforceSessionPagesSchema(client)
  await enforceSessionOperationsSchema(client)
  await enforceSessionOperationPagesSchema(client)
  await client.execute('PRAGMA foreign_keys = ON;')
  await ensureDefaultSettings(client)
  await patchGenerationRecordsFromMetadata({ client, db, resolveStoragePath })
  await patchSessionPagesFromLegacy({ client, db, resolveStoragePath })
  await patchSessionPagesFromGenerationPages({ client, db, resolveStoragePath })
}
