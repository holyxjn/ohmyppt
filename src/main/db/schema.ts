import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  topic: text('topic'),
  styleId: text('style_id'),
  pageCount: integer('page_count'),
  referenceDocumentPath: text('reference_document_path'),
  status: text('status').notNull().default('active'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  metadata: text('metadata'),
  designContract: text('design_contract'),
  currentOperationId: text('current_operation_id'),
  currentCommit: text('current_commit')
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  chatScope: text('chat_scope').notNull().default('main'),
  pageId: text('page_id'),
  selector: text('selector'),
  imagePaths: text('image_paths'),
  videoPaths: text('video_paths'),
  role: text('role').notNull(),
  content: text('content').notNull(),
  type: text('type'),
  toolName: text('tool_name'),
  toolCallId: text('tool_call_id'),
  tokenCount: integer('token_count'),
  createdAt: integer('created_at').notNull()
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  title: text('title').notNull(),
  outputPath: text('output_path').notNull(),
  rootPath: text('root_path'),
  fileCount: integer('file_count').default(0),
  totalSize: integer('total_size').default(0),
  status: text('status').notNull().default('draft'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const generationRuns = sqliteTable('generation_runs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('generate'),
  status: text('status').notNull().default('running'),
  totalPages: integer('total_pages').notNull().default(0),
  error: text('error'),
  metadata: text('metadata'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const generationPages = sqliteTable('generation_pages', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => generationRuns.id, { onDelete: 'cascade' }),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  pageId: text('page_id').notNull(),
  pageNumber: integer('page_number').notNull(),
  title: text('title').notNull(),
  contentOutline: text('content_outline'),
  layoutIntent: text('layout_intent'),
  htmlPath: text('html_path'),
  status: text('status').notNull().default('pending'),
  error: text('error'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const sessionPages = sqliteTable(
  'session_pages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    legacyPageId: text('legacy_page_id'),
    fileSlug: text('file_slug').notNull(),
    pageNumber: integer('page_number').notNull(),
    title: text('title').notNull(),
    htmlPath: text('html_path').notNull(),
    status: text('status').notNull().default('pending'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at')
  },
  (table) => ({
    sessionPageNumberIdx: index('idx_session_pages_session_number').on(
      table.sessionId,
      table.pageNumber
    )
  })
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const modelConfigs = sqliteTable('model_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  apiKey: text('api_key').notNull().default(''),
  baseUrl: text('base_url').notNull().default(''),
  active: integer('active').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const memorySummaries = sqliteTable('memory_summaries', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  messageRangeStart: integer('message_range_start').notNull(),
  messageRangeEnd: integer('message_range_end').notNull(),
  summary: text('summary').notNull(),
  tokenCount: integer('token_count'),
  createdAt: integer('created_at').notNull()
})

export const userPreferences = sqliteTable('user_preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  confidence: real('confidence').default(1.0),
  sourceSessions: text('source_sessions'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastUsedAt: integer('last_used_at')
})

export const styles = sqliteTable('styles', {
  id: text('id').primaryKey(),
  style: text('style').notNull().unique(),
  styleName: text('style_name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default(''),
  aliases: text('aliases').notNull().default('[]'),
  source: text('source').notNull().default('custom'),
  styleSkill: text('style_skill').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const sessionOperations = sqliteTable('session_operations', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: text('status').notNull().default('completed'),
  scope: text('scope'),
  prompt: text('prompt'),
  parentOperationId: text('parent_operation_id'),
  beforeCommit: text('before_commit'),
  afterCommit: text('after_commit'),
  targetOperationId: text('target_operation_id'),
  targetCommit: text('target_commit'),
  changedFilesJson: text('changed_files_json').notNull().default('[]'),
  changedPagesJson: text('changed_pages_json').notNull().default('[]'),
  trackedFilesJson: text('tracked_files_json').notNull().default('[]'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at')
})

export const sessionOperationPages = sqliteTable(
  'session_operation_pages',
  {
    id: text('id').primaryKey(),
    operationId: text('operation_id')
      .notNull()
      .references(() => sessionOperations.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    pageId: text('page_id').notNull(),
    legacyPageId: text('legacy_page_id'),
    fileSlug: text('file_slug').notNull(),
    pageNumber: integer('page_number').notNull(),
    title: text('title').notNull(),
    htmlPath: text('html_path').notNull(),
    status: text('status').notNull().default('pending'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (table) => ({
    sessionOperationPagesOrderIdx: index('idx_session_operation_pages_order').on(
      table.operationId,
      table.pageNumber
    ),
    sessionOperationPagesSessionIdx: index('idx_session_operation_pages_session').on(
      table.sessionId,
      table.operationId
    )
  })
)

export type Session = typeof sessions.$inferSelect
export type Message = typeof messages.$inferSelect
export type Project = typeof projects.$inferSelect
export type GenerationRun = typeof generationRuns.$inferSelect
export type GenerationPage = typeof generationPages.$inferSelect
export type SessionPage = typeof sessionPages.$inferSelect
export type ModelConfig = typeof modelConfigs.$inferSelect
export type MemorySummary = typeof memorySummaries.$inferSelect
export type UserPreference = typeof userPreferences.$inferSelect
export type SessionOperation = typeof sessionOperations.$inferSelect
export type SessionOperationPage = typeof sessionOperationPages.$inferSelect

export type SessionStatus = 'active' | 'completed' | 'failed' | 'archived'
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type MessageType = 'text' | 'tool_call' | 'tool_result' | 'stream_chunk'
export type ChatScope = 'main' | 'page'
export type GenerationRunStatus = 'running' | 'completed' | 'failed' | 'partial'
export type GenerationRunMode = 'generate' | 'retry' | 'edit' | 'import' | 'addPage' | 'retrySinglePage'
export type GenerationPageStatus = 'pending' | 'running' | 'completed' | 'failed'
export type SessionPageStatus = 'completed' | 'failed' | 'pending'
export type SessionOperationType =
  | 'generate'
  | 'edit'
  | 'addPage'
  | 'retry'
  | 'import'
  | 'rollback'
  | 'reorder'
  | 'delete'
export type SessionOperationScope = 'session' | 'deck' | 'page' | 'selector' | 'shell'
export type SessionOperationStatus = 'committing' | 'completed' | 'failed' | 'noop'
