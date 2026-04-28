import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  topic: text("topic"),
  styleId: text("style_id"),
  pageCount: integer("page_count"),
  referenceDocumentPath: text("reference_document_path"),
  status: text("status").notNull().default("active"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  metadata: text("metadata"),
  designContract: text("design_contract"),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  chatScope: text("chat_scope").notNull().default("main"),
  pageId: text("page_id"),
  selector: text("selector"),
  imagePaths: text("image_paths"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  type: text("type"),
  toolName: text("tool_name"),
  toolCallId: text("tool_call_id"),
  tokenCount: integer("token_count"),
  createdAt: integer("created_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  title: text("title").notNull(),
  outputPath: text("output_path").notNull(),
  fileCount: integer("file_count").default(0),
  totalSize: integer("total_size").default(0),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const generationRuns = sqliteTable("generation_runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("generate"),
  status: text("status").notNull().default("running"),
  totalPages: integer("total_pages").notNull().default(0),
  error: text("error"),
  metadata: text("metadata"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const generationPages = sqliteTable("generation_pages", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => generationRuns.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  pageId: text("page_id").notNull(),
  pageNumber: integer("page_number").notNull(),
  title: text("title").notNull(),
  contentOutline: text("content_outline"),
  htmlPath: text("html_path"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const memorySummaries = sqliteTable("memory_summaries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  messageRangeStart: integer("message_range_start").notNull(),
  messageRangeEnd: integer("message_range_end").notNull(),
  summary: text("summary").notNull(),
  tokenCount: integer("token_count"),
  createdAt: integer("created_at").notNull(),
});

export const userPreferences = sqliteTable("user_preferences", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  confidence: real("confidence").default(1.0),
  sourceSessions: text("source_sessions"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});

export const styles = sqliteTable("styles", {
  id: text("id").primaryKey(),
  style: text("style").notNull().unique(),
  styleName: text("style_name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default(""),
  aliases: text("aliases").notNull().default("[]"),
  source: text("source").notNull().default("custom"),
  styleSkill: text("style_skill").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type GenerationRun = typeof generationRuns.$inferSelect;
export type GenerationPage = typeof generationPages.$inferSelect;
export type MemorySummary = typeof memorySummaries.$inferSelect;
export type UserPreference = typeof userPreferences.$inferSelect;

export type SessionStatus = "active" | "completed" | "failed" | "archived";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type MessageType = "text" | "tool_call" | "tool_result" | "stream_chunk";
export type ChatScope = "main" | "page";
export type GenerationRunStatus = "running" | "completed" | "failed" | "partial";
export type GenerationPageStatus = "pending" | "running" | "completed" | "failed";
