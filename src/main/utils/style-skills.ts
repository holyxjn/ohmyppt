import type { PPTDatabase, StyleRow } from "../db/database";
import fs from "fs";
import path from "path";
import { is } from "@electron-toolkit/utils";

// ── Types ──

export type StyleSource = "builtin" | "custom" | "override";

export interface StylePreset {
  id: string;
  label: string;
  aliases: string[];
  description: string;
  fallbackPrompt: string;
}

export interface LoadStyleSkillOptions {}

export interface StyleCatalogItem {
  id: string;
  styleKey: string;
  label: string;
  description: string;
  category: string;
  source: StyleSource;
  editable: boolean;
}

// ── Module-level DB injection ──

let _db: PPTDatabase | null = null;
let _builtinSeedMap: Map<string, BuiltinStyleSeedItem> | null = null;

export function setStyleDb(db: PPTDatabase): void {
  _db = db;
}

function getDb(): PPTDatabase {
  if (!_db) throw new Error("Style DB not initialized. Call setStyleDb() first.");
  return _db;
}

interface BuiltinStyleSeedItem {
  style: string;
  styleName: string;
  description?: string;
  category?: string;
  aliases?: string[];
  source?: string;
  styleSkill?: string;
}

function getBuiltinSeedPath(): string {
  return is.dev
    ? path.join(process.cwd(), "resources", "styles.json")
    : path.join(process.resourcesPath, "app.asar.unpacked", "resources", "styles.json");
}

function getBuiltinSeedMap(): Map<string, BuiltinStyleSeedItem> {
  if (_builtinSeedMap) return _builtinSeedMap;
  const seedPath = getBuiltinSeedPath();
  if (!fs.existsSync(seedPath)) {
    throw new Error(`内置风格资源不存在：${seedPath}`);
  }
  const raw = fs.readFileSync(seedPath, "utf-8");
  const items = JSON.parse(raw) as BuiltinStyleSeedItem[];
  _builtinSeedMap = new Map(
    items
      .filter((item) => typeof item.style === "string" && item.style.trim().length > 0)
      .map((item) => [item.style.trim(), item])
  );
  return _builtinSeedMap;
}

// ── Helpers ──

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

function normalizeAlias(alias: string): string {
  return normalize(alias).replace(/\s+/g, "-");
}

function normalizeStyleId(styleId: string): string {
  const normalized = normalize(styleId);
  if (!/^[a-z0-9-]{3,40}$/.test(normalized)) {
    throw new Error("styleId 仅允许小写字母/数字/连字符，长度 3-40。");
  }
  return normalized;
}

function rowToPreset(row: StyleRow): StylePreset {
  return {
    id: row.id,
    label: row.styleName,
    aliases: JSON.parse(row.aliases || "[]"),
    description: row.description,
    fallbackPrompt: row.description
      ? `Use ${row.style} style: ${row.description}`
      : `Use ${row.style} style.`,
  };
}

// ── Core functions (sync via cache) ──

export function resolveStylePreset(styleId?: string | null): StylePreset {
  const db = _db;
  const rows = db ? db.listStyleRowsSync() : [];
  if (rows.length === 0) {
    return {
      id: "minimal-white",
      label: "极简白",
      aliases: ["minimal", "light"],
      description: "极简白",
      fallbackPrompt: "Use minimal-white style.",
    };
  }

  if (!styleId) {
    const found = rows.find((r) => r.style === "minimal-white");
    return found ? rowToPreset(found) : rowToPreset(rows[0]);
  }

  const normalized = normalize(styleId);
  const exact = rows.find((r) => r.id === normalized);
  if (exact) return rowToPreset(exact);

  const fallback = rows.find((r) => r.style === "minimal-white");
  return fallback ? rowToPreset(fallback) : rowToPreset(rows[0]);
}

export function loadStyleSkill(
  styleId?: string | null,
): { preset: StylePreset; prompt: string } {
  const db = getDb();
  const preset = resolveStylePreset(styleId);
  const row = db.getStyleRowSync(preset.id);
  const prompt = row?.styleSkill?.trim() || preset.fallbackPrompt;
  return { preset, prompt };
}

// ── Catalog & Detail ──

export function listStyleCatalog(): StyleCatalogItem[] {
  const db = getDb();
  const rows = db.listStyleRowsSync();
  return rows.map((row) => ({
    id: row.id,
    styleKey: row.style,
    label: row.styleName,
    description: row.description,
    category: row.category || (row.source === "builtin" ? "内置" : "自定义"),
    source: row.source as StyleSource,
    editable: row.source !== "builtin",
  }));
}

export function getStyleDetail(styleId: string): {
  id: string;
  styleKey: string;
  label: string;
  description: string;
  aliases: string[];
  styleSkill: string;
  source: StyleSource;
  editable: boolean;
  category: string;
} {
  const db = getDb();
  const normalizedId = normalizeStyleId(styleId);
  const row = db.getStyleRowSync(normalizedId);
  if (row) {
    return {
      id: row.id,
      styleKey: row.style,
      label: row.styleName,
      description: row.description,
      aliases: JSON.parse(row.aliases || "[]"),
      styleSkill: row.styleSkill,
      source: row.source as StyleSource,
      editable: row.source !== "builtin",
      category: row.category || (row.source === "builtin" ? "内置" : "自定义"),
    };
  }
  throw new Error(`风格不存在：${styleId}`);
}

// ── CRUD ──

export function hasStyleSkill(styleId: string): boolean {
  const db = getDb();
  const id = normalizeStyleId(styleId);
  return Boolean(db.getStyleRowSync(id));
}

export async function upsertStyleSkill(input: {
  id: string;
  label: string;
  description: string;
  category?: string;
  aliases?: string[];
  prompt: string;
}): Promise<{ id: string; source: StyleSource }> {
  const db = getDb();
  const id = normalizeStyleId(input.id);
  const existing = db.getStyleRowSync(id);

  const nextSource: StyleSource = existing
    ? existing.source === "builtin"
      ? "override"
      : (existing.source as StyleSource)
    : "custom";

  if (existing) {
    await db.updateStyleRow(id, {
      styleName: input.label.trim() || id,
      description: input.description.trim(),
      category: (input.category || "").trim() || (nextSource === "builtin" ? "内置" : "自定义"),
      aliases: (input.aliases || [])
        .map((alias) => normalizeAlias(alias))
        .filter((alias) => alias.length > 0 && alias !== id),
      source: nextSource,
      styleSkill: input.prompt.trim(),
    });
  } else {
    await db.createStyleRow({
      id,
      style: id,
      styleName: input.label.trim() || id,
      description: input.description.trim(),
      category: (input.category || "").trim() || "自定义",
      aliases: (input.aliases || [])
        .map((alias) => normalizeAlias(alias))
        .filter((alias) => alias.length > 0 && alias !== id),
      source: nextSource,
      styleSkill: input.prompt.trim(),
    });
  }
  return { id, source: nextSource };
}

export async function createStyleSkill(input: {
  id: string;
  label: string;
  description: string;
  category?: string;
  aliases?: string[];
  prompt: string;
}): Promise<{ id: string; source: StyleSource }> {
  const id = normalizeStyleId(input.id);
  if (hasStyleSkill(id)) {
    throw new Error(`style 已存在：${id}`);
  }
  return upsertStyleSkill(input);
}

export async function updateStyleSkill(input: {
  id: string;
  label: string;
  description: string;
  category?: string;
  aliases?: string[];
  prompt: string;
}): Promise<{ id: string; source: StyleSource }> {
  const id = normalizeStyleId(input.id);
  if (!hasStyleSkill(id)) {
    throw new Error(`style 不存在：${id}`);
  }
  return upsertStyleSkill(input);
}

export async function deleteStyleSkill(styleId: string): Promise<{ deleted: boolean }> {
  const db = getDb();
  const id = normalizeStyleId(styleId);
  const existing = db.getStyleRowSync(id);
  if (!existing) return { deleted: false };
  if (existing.source === "builtin") return { deleted: false };
  if (existing.source === "override") {
    const builtin = getBuiltinSeedMap().get(id);
    if (builtin) {
      await db.updateStyleRow(id, {
        styleName: builtin.styleName || id,
        description: builtin.description || "",
        category: builtin.category || "",
        aliases: builtin.aliases || [],
        source: "builtin",
        styleSkill: builtin.styleSkill || "",
      });
      return { deleted: true };
    }
  }
  await db.deleteStyleRow(id);
  return { deleted: true };
}
