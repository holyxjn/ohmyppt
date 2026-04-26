import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, ne, gt, lte, count, max, asc, desc, sql, and } from "drizzle-orm";
import * as schema from "./schema";
import path from "path";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import fs from "fs";
import crypto from "crypto";

type SessionStatus = "active" | "completed" | "failed" | "archived";
type MessageRole = "user" | "assistant" | "system" | "tool";
type MessageType = "text" | "tool_call" | "tool_result" | "stream_chunk";
type ChatScope = "main" | "page";
type StyleSource = "builtin" | "custom" | "override";

export interface Session {
  id: string;
  title: string;
  topic: string | null;
  styleId: string | null;
  page_count: number | null;
  status: SessionStatus;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

export interface Message {
  id: string;
  session_id: string;
  chat_scope: ChatScope;
  page_id: string | null;
  selector: string | null;
  image_paths: string[] | null;
  role: MessageRole;
  content: string;
  type: MessageType;
  tool_name: string | null;
  tool_call_id: string | null;
  token_count: number | null;
  created_at: number;
}

interface MemorySummary {
  id: string;
  session_id: string;
  message_range_start: number;
  message_range_end: number;
  summary: string;
  token_count: number | null;
  created_at: number;
}

interface UserPreference {
  key: string;
  value: unknown;
  confidence: number;
  source_sessions: string[];
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

interface Project {
  id: string;
  session_id: string;
  title: string;
  output_path: string;
  file_count: number;
  total_size: number;
  status: "draft" | "published" | "exported";
  created_at: number;
  updated_at: number;
}

export interface StyleRow {
  id: string;
  style: string;
  styleName: string;
  description: string;
  category: string;
  aliases: string;      // JSON array
  source: StyleSource;
  styleSkill: string;   // plain markdown
  createdAt: number;
  updatedAt: number;
}

const SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const MESSAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chat_scope TEXT NOT NULL DEFAULT 'main',
  page_id TEXT,
  selector TEXT,
  image_paths TEXT,
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
`;

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT,
  style_id TEXT,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT,
  design_contract TEXT
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
`;

export class PPTDatabase {
  private db: ReturnType<typeof drizzle>;
  private client: ReturnType<typeof createClient>;
  private _storagePath: string | null = null;
  private _initialized = false;
  private _stylesCache: StyleRow[] = [];

  constructor(dbPath?: string) {
    const defaultPath = is.dev
      ? path.join(process.cwd(), "ohmyppt.dev.db")
      : path.join(app.getPath("userData"), "ohmyppt.db");
    const resolvedPath = dbPath || defaultPath;

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const url = resolvedPath.startsWith("file:") ? resolvedPath : `file:${resolvedPath}`;

    this.client = createClient({ url });
    this.db = drizzle(this.client, { schema });
    this._storagePath = null;
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    await this.client.executeMultiple(INIT_SQL);
    await this._enforceSessionsSchema();
    await this._enforceSettingsSchema();
    await this._enforceMessagesSchema();
    await this.client.execute("PRAGMA foreign_keys = ON;");
    await this._ensureDefaultSettings();
    await this.seedStylesFromResources();
    this._initialized = true;
  }

  private async _getTableColumns(tableName: "settings" | "messages" | "sessions"): Promise<Set<string>> {
    const result = await this.client.execute(`PRAGMA table_info(${tableName})`);
    const rows = Array.isArray((result as { rows?: unknown[] }).rows)
      ? ((result as { rows?: unknown[] }).rows as unknown[])
      : [];
    const columns = new Set<string>();
    for (const row of rows) {
      if (row && typeof row === "object" && "name" in row) {
        const name = (row as { name?: unknown }).name;
        if (typeof name === "string" && name.trim().length > 0) {
          columns.add(name.trim());
        }
        continue;
      }
      if (Array.isArray(row) && typeof row[1] === "string" && row[1].trim().length > 0) {
        columns.add(row[1].trim());
      }
    }
    return columns;
  }

  private async _enforceSettingsSchema(): Promise<void> {
    await this.client.execute(SETTINGS_TABLE_SQL);
    const columns = await this._getTableColumns("settings");
    if (!columns.has("value")) {
      await this.client.execute(`ALTER TABLE settings ADD COLUMN value TEXT NOT NULL DEFAULT '""'`);
    }
    if (!columns.has("updated_at")) {
      await this.client.execute("ALTER TABLE settings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
    }
    await this.client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key)");
  }

  private async _enforceSessionsSchema(): Promise<void> {
    const columns = await this._getTableColumns("sessions");
    if (!columns.has("style_id")) {
      await this.client.execute("ALTER TABLE sessions ADD COLUMN style_id TEXT");
    }
  }

  private async _enforceMessagesSchema(): Promise<void> {
    await this.client.executeMultiple(MESSAGES_TABLE_SQL);
    const columns = await this._getTableColumns("messages");
    if (!columns.has("chat_scope")) {
      await this.client.execute(`ALTER TABLE messages ADD COLUMN chat_scope TEXT NOT NULL DEFAULT 'main'`);
    }
    if (!columns.has("page_id")) {
      await this.client.execute("ALTER TABLE messages ADD COLUMN page_id TEXT");
    }
    if (!columns.has("selector")) {
      await this.client.execute("ALTER TABLE messages ADD COLUMN selector TEXT");
    }
    if (!columns.has("image_paths")) {
      await this.client.execute("ALTER TABLE messages ADD COLUMN image_paths TEXT");
    }
    if (!columns.has("type")) {
      await this.client.execute("ALTER TABLE messages ADD COLUMN type TEXT");
    }
    if (!columns.has("tool_name")) {
      await this.client.execute("ALTER TABLE messages ADD COLUMN tool_name TEXT");
    }
    if (!columns.has("tool_call_id")) {
      await this.client.execute("ALTER TABLE messages ADD COLUMN tool_call_id TEXT");
    }
    if (!columns.has("token_count")) {
      await this.client.execute("ALTER TABLE messages ADD COLUMN token_count INTEGER");
    }
    await this.client.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)");
    await this.client.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_scope ON messages(session_id, chat_scope, page_id, created_at)");
    await this.client.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_only ON messages(session_id)");
  }

  private async _ensureDefaultSettings(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const defaults = [
      { key: "provider", value: '"openai"' },
      { key: "theme", value: '"light"' },
      { key: "auto_save", value: "true" },
    ];

    for (const { key, value } of defaults) {
      await this.client.execute({
        sql: "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
        args: [key, value, now],
      });
    }
  }

  getStoragePath(): string {
    return this._storagePath || "";
  }

  async setStoragePath(storagePath: string): Promise<void> {
    await this.setSetting("storage_path", storagePath);
    this._storagePath = storagePath;
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  }

  async close(): Promise<void> {
    await this.client.close();
    this._initialized = false;
  }

  // ========== Session ==========

  async createSession(data: {
    id?: string;
    title: string;
    topic?: string;
    styleId?: string;
    pageCount?: number;
    provider: string;
    model: string;
  }): Promise<string> {
    const id = data.id || crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await this.db.insert(schema.sessions).values({
      id,
      title: data.title,
      topic: data.topic || null,
      styleId: data.styleId || null,
      pageCount: data.pageCount || null,
      status: "active",
      provider: data.provider,
      model: data.model,
      createdAt: now,
      updatedAt: now,
      metadata: null,
    }).run();

    return id;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const result = await this.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
    return result as unknown as Session | undefined;
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db.update(schema.sessions).set({ status, updatedAt: now }).where(eq(schema.sessions.id, sessionId)).run();
  }

  async updateSessionMetadata(sessionId: string, metadata: object): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ metadata: JSON.stringify(metadata), updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  async updateSessionDesignContract(sessionId: string, designContract: unknown): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ designContract: designContract ? JSON.stringify(designContract) : null, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  async listSessions(limit = 50, offset = 0): Promise<Session[]> {
    const results = await this.db
      .select()
      .from(schema.sessions)
      .where(ne(schema.sessions.status, "archived"))
      .orderBy(desc(schema.sessions.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();

    return results as unknown as Session[];
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
  }

  // ========== Messages ==========

  async getSessionMessages(
    sessionId: string,
    options?: {
      chatScope?: ChatScope;
      pageId?: string;
    }
  ): Promise<Message[]> {
    const chatScope = options?.chatScope ?? "main";
    const normalizedPageId = typeof options?.pageId === "string" && options.pageId.trim().length > 0
      ? options.pageId.trim()
      : null;
    if (chatScope === "page" && !normalizedPageId) {
      return [];
    }
    const whereClause = chatScope === "page" && normalizedPageId
      ? and(
        eq(schema.messages.sessionId, sessionId),
        eq(schema.messages.chatScope, "page"),
        eq(schema.messages.pageId, normalizedPageId)
      )
      : and(
        eq(schema.messages.sessionId, sessionId),
        eq(schema.messages.chatScope, "main")
      );
    const results = await this.db
      .select()
      .from(schema.messages)
      .where(whereClause)
      .orderBy(asc(schema.messages.createdAt))
      .all();

    return results.map((message) => this.normalizeMessageRow(message as Record<string, unknown>));
  }

  private normalizeImagePaths(value: unknown): string[] | null {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) return null;
      const valid = parsed
        .map((item) => String(item || "").trim())
        .filter((item) => item.startsWith("./images/"))
        .slice(0, 10);
      return valid.length > 0 ? valid : null;
    } catch {
      return null;
    }
  }

  private normalizeMessageRow(message: Record<string, unknown>): Message {
    const rawImagePaths = message.imagePaths ?? message.image_paths ?? null;
    const imagePaths = this.normalizeImagePaths(rawImagePaths);
    return {
      id: String(message.id || ""),
      session_id: String(message.sessionId ?? message.session_id ?? ""),
      chat_scope: (message.chatScope === "page" || message.chat_scope === "page" ? "page" : "main"),
      page_id:
        typeof (message.pageId ?? message.page_id) === "string"
          ? String(message.pageId ?? message.page_id)
          : null,
      selector:
        typeof message.selector === "string" && message.selector.trim().length > 0
          ? message.selector.trim()
          : null,
      image_paths: imagePaths,
      role: String(message.role || "system") as MessageRole,
      content: String(message.content || ""),
      type: String(message.type || "text") as MessageType,
      tool_name:
        typeof (message.toolName ?? message.tool_name) === "string"
          ? String(message.toolName ?? message.tool_name)
          : null,
      tool_call_id:
        typeof (message.toolCallId ?? message.tool_call_id) === "string"
          ? String(message.toolCallId ?? message.tool_call_id)
          : null,
      token_count:
        typeof (message.tokenCount ?? message.token_count) === "number"
          ? Number(message.tokenCount ?? message.token_count)
          : null,
      created_at:
        typeof (message.createdAt ?? message.created_at) === "number"
          ? Number(message.createdAt ?? message.created_at)
          : Math.floor(Date.now() / 1000),
    };
  }

  async addMessage(
    sessionId: string,
    message: {
      role: MessageRole;
      content: string;
      type?: MessageType;
      tool_name?: string | null;
      tool_call_id?: string | null;
      token_count?: number | null;
      chat_scope?: ChatScope;
      page_id?: string | null;
      selector?: string | null;
      image_paths?: string[] | null;
    }
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const chatScope = message.chat_scope === "page" ? "page" : "main";
    const pageId = chatScope === "page" && typeof message.page_id === "string" && message.page_id.trim().length > 0
      ? message.page_id.trim()
      : null;
    const selector =
      chatScope === "page" && typeof message.selector === "string" && message.selector.trim().length > 0
        ? message.selector.trim()
        : null;
    const imagePathsRaw = Array.isArray(message.image_paths) ? message.image_paths : [];
    const imagePaths =
      imagePathsRaw.length > 0
        ? imagePathsRaw
            .map((item) => String(item || "").trim())
            .filter((item) => item.startsWith("./images/"))
            .slice(0, 10)
        : [];
    const imagePathsJson = imagePaths.length > 0 ? JSON.stringify(imagePaths) : null;
    if (chatScope === "page" && !pageId) {
      throw new Error("page chat message requires page_id");
    }

    await this.db.insert(schema.messages).values({
      id,
      sessionId,
      chatScope,
      pageId,
      selector,
      imagePaths: imagePathsJson,
      role: message.role,
      content: message.content,
      type: message.type || "text",
      toolName: message.tool_name || null,
      toolCallId: message.tool_call_id || null,
      tokenCount: message.token_count || null,
      createdAt: now,
    }).run();

    await this.db.update(schema.sessions).set({ updatedAt: now }).where(eq(schema.sessions.id, sessionId)).run();

    return id;
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .get();
    return result?.count ?? 0;
  }

  async getRecentMessages(sessionId: string, count: number): Promise<Message[]> {
    const results = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(count)
      .all();

    return results.map((message) => this.normalizeMessageRow(message as Record<string, unknown>));
  }

  // ========== Memory ==========

  async getLastSummary(sessionId: string): Promise<MemorySummary | undefined> {
    const result = await this.db
      .select()
      .from(schema.memorySummaries)
      .where(eq(schema.memorySummaries.sessionId, sessionId))
      .orderBy(desc(schema.memorySummaries.messageRangeEnd))
      .limit(1)
      .get();

    return result as MemorySummary | undefined;
  }

  async saveSummary(
    sessionId: string,
    data: {
      rangeStart: number;
      rangeEnd: number;
      summary: string;
      tokenCount?: number;
    }
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await this.db.insert(schema.memorySummaries).values({
      id,
      sessionId,
      messageRangeStart: data.rangeStart,
      messageRangeEnd: data.rangeEnd,
      summary: data.summary,
      tokenCount: data.tokenCount || null,
      createdAt: now,
    }).run();

    return id;
  }

  async getLastCompressedIndex(sessionId: string): Promise<number> {
    const result = await this.db
      .select({ maxIndex: max(schema.memorySummaries.messageRangeEnd) })
      .from(schema.memorySummaries)
      .where(eq(schema.memorySummaries.sessionId, sessionId))
      .get();
    return result?.maxIndex ?? 0;
  }

  async getMessagesForCompression(sessionId: string, batchSize: number): Promise<(Message & { idx: number })[]> {
    const lastCompressedIndex = await this.getLastCompressedIndex(sessionId);

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
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(and(eq(schema.messages.sessionId, sessionId), gt(schema.messages.createdAt, lastCompressedIndex)))
      .orderBy(asc(schema.messages.createdAt))
      .limit(batchSize)
      .all();

    let idx = lastCompressedIndex + 1;
    return results.map((r) => ({
      ...r,
      idx: idx++,
    })) as unknown as (Message & { idx: number })[];
  }

  // ========== Settings ==========

  async getSetting<T>(key: string): Promise<T | undefined> {
    const result = await this.db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .get();
    if (!result) return undefined;
    try {
      return JSON.parse(result.value) as T;
    } catch {
      return result.value as T;
    }
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .insert(schema.settings)
      .values({ key, value: JSON.stringify(value), updatedAt: now })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(value), updatedAt: now } })
      .run();
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const results = await this.db.select().from(schema.settings).all();
    const result: Record<string, unknown> = {};
    for (const row of results) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  // ========== Preferences ==========

  async getActiveUserPreferences(): Promise<UserPreference[]> {
    const results = await this.db
      .select()
      .from(schema.userPreferences)
      .where(gt(schema.userPreferences.confidence, 0.3))
      .orderBy(desc(schema.userPreferences.confidence), desc(schema.userPreferences.lastUsedAt))
      .limit(10)
      .all();

    return results.map((r) => ({
      key: r.key,
      value: JSON.parse(r.value),
      confidence: r.confidence,
      source_sessions: r.sourceSessions ? JSON.parse(r.sourceSessions) : [],
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      last_used_at: r.lastUsedAt,
    })) as unknown as UserPreference[];
  }

  async upsertPreference(key: string, data: { value: unknown; confidence?: number; sourceSessions?: string[] }): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const existing = await this.db.select().from(schema.userPreferences).where(eq(schema.userPreferences.key, key)).get();

    if (existing) {
      const existingSources = existing.sourceSessions ? JSON.parse(existing.sourceSessions) : [];
      const newSources = data.sourceSessions ? [...new Set([...existingSources, ...data.sourceSessions])] : existingSources;
      const baseConfidence = existing.confidence ?? 0.5;
      const increment = (data.confidence ?? 0.5) * 0.3;
      const newConfidence = Math.min(1.0, baseConfidence + increment);

      await this.db
        .update(schema.userPreferences)
        .set({
          value: JSON.stringify(data.value),
          confidence: newConfidence,
          sourceSessions: JSON.stringify(newSources),
          updatedAt: now,
          lastUsedAt: now,
        })
        .where(eq(schema.userPreferences.key, key))
        .run();
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
          lastUsedAt: now,
        })
        .run();
    }
  }

  async decayPreferences(): Promise<void> {
    await this.db
      .update(schema.userPreferences)
      .set({ confidence: sql`${schema.userPreferences.confidence} * 0.95` })
      .where(gt(schema.userPreferences.confidence, 0.1))
      .run();

    await this.db.delete(schema.userPreferences).where(lte(schema.userPreferences.confidence, 0.1)).run();
  }

  // ========== Projects ==========

  async createProject(data: { session_id: string; title: string; output_path: string }): Promise<string> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await this.db.insert(schema.projects).values({
      id,
      sessionId: data.session_id,
      title: data.title,
      outputPath: data.output_path,
      fileCount: 0,
      totalSize: 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    }).run();

    return id;
  }

  async getProject(sessionId: string): Promise<Project | undefined> {
    const result = await this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.sessionId, sessionId))
      .orderBy(desc(schema.projects.createdAt))
      .limit(1)
      .get();

    return result as Project | undefined;
  }

  async updateProjectStatus(projectId: string, status: "draft" | "published" | "exported"): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db.update(schema.projects).set({ status, updatedAt: now }).where(eq(schema.projects.id, projectId)).run();
  }

  // ========== Styles ==========

  async countStyles(): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(schema.styles)
      .get();
    return result?.count ?? 0;
  }

  async seedStylesFromResources(): Promise<void> {
    const rowCount = await this.countStyles();
    if (rowCount > 0) {
      await this._refreshStylesCache();
      return;
    }

    const stylesPath = is.dev
      ? path.join(process.cwd(), "resources", "styles.json")
      : path.join(process.resourcesPath, "app.asar.unpacked", "resources", "styles.json");

    if (!fs.existsSync(stylesPath)) {
      console.warn("[db] styles.json not found at", stylesPath);
      return;
    }

    const raw = fs.readFileSync(stylesPath, "utf-8");
    const items: Array<{
      style: string;
      styleName: string;
      description?: string;
      category?: string;
      aliases?: string[];
      source?: string;
      styleSkill?: string;
    }> = JSON.parse(raw);

    const now = Math.floor(Date.now() / 1000);
    for (const item of items) {
      const id = crypto.randomUUID();
      await this.db.insert(schema.styles).values({
        id,
        style: item.style,
        styleName: item.styleName,
        description: item.description || "",
        category: item.category || "",
        aliases: JSON.stringify(item.aliases || []),
        source: (item.source as StyleSource) || "builtin",
        styleSkill: item.styleSkill || "",
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    await this._refreshStylesCache();
  }

  private async _refreshStylesCache(): Promise<void> {
    const results = await this.db
      .select()
      .from(schema.styles)
      .orderBy(asc(schema.styles.style))
      .all();
    this._stylesCache = results as unknown as StyleRow[];
  }

  /** Synchronous read from in-memory cache. Used by prompt builders. */
  listStyleRowsSync(): StyleRow[] {
    return this._stylesCache;
  }

  /** Synchronous cache lookup. */
  getStyleRowSync(styleId: string): StyleRow | undefined {
    return this._stylesCache.find((r) => r.id === styleId);
  }

  /** Synchronous cache lookup by style key. */
  getStyleRowByStyleSync(style: string): StyleRow | undefined {
    return this._stylesCache.find((r) => r.style === style);
  }

  async listStyleRows(): Promise<StyleRow[]> {
    const results = await this.db
      .select()
      .from(schema.styles)
      .orderBy(asc(schema.styles.style))
      .all();
    return results as unknown as StyleRow[];
  }

  async getStyleRow(styleId: string): Promise<StyleRow | undefined> {
    const result = await this.db
      .select()
      .from(schema.styles)
      .where(eq(schema.styles.id, styleId))
      .get();
    return result as unknown as StyleRow | undefined;
  }

  async createStyleRow(data: {
    id?: string;
    style: string;
    styleName: string;
    description?: string;
    category?: string;
    aliases?: string[];
    source?: StyleSource;
    styleSkill?: string;
  }): Promise<string> {
    const id = data.id || crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.db.insert(schema.styles).values({
      id,
      style: data.style,
      styleName: data.styleName,
      description: data.description || "",
      category: data.category || "",
      aliases: JSON.stringify(data.aliases || []),
      source: data.source || "custom",
      styleSkill: data.styleSkill || "",
      createdAt: now,
      updatedAt: now,
    }).run();
    await this._refreshStylesCache();
    return id;
  }

  async updateStyleRow(styleId: string, data: {
    styleName?: string;
    description?: string;
    category?: string;
    aliases?: string[];
    source?: StyleSource;
    styleSkill?: string;
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.styleName !== undefined) set.styleName = data.styleName;
    if (data.description !== undefined) set.description = data.description;
    if (data.category !== undefined) set.category = data.category;
    if (data.aliases !== undefined) set.aliases = JSON.stringify(data.aliases);
    if (data.source !== undefined) set.source = data.source;
    if (data.styleSkill !== undefined) set.styleSkill = data.styleSkill;
    await this.db
      .update(schema.styles)
      .set(set)
      .where(eq(schema.styles.id, styleId))
      .run();
    await this._refreshStylesCache();
  }

  async deleteStyleRow(styleId: string): Promise<boolean> {
    const existing = await this.getStyleRow(styleId);
    if (!existing) return false;
    await this.db
      .delete(schema.styles)
      .where(eq(schema.styles.id, styleId))
      .run();
    await this._refreshStylesCache();
    return true;
  }
}
