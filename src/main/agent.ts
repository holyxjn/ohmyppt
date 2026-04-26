import type { PPTDatabase } from "./db/database";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { FilesystemBackend, createDeepAgent } from "deepagents";
import log from "electron-log/main.js";
import { createSessionBoundDeckTools, type SessionDeckGenerationContext } from "./tools";
import {
  buildDeckAgentSystemPrompt,
  buildEditAgentSystemPrompt,
} from "./prompt";

export { SHARED_PAGE_STYLES_START, SHARED_PAGE_STYLES_END, pageContentStartMarker, pageContentEndMarker } from "./tools";
export type { SessionDeckGenerationContext } from "./tools";
export {
  buildPlanningSystemPrompt,
  buildDeckGenerationPrompt,
  buildSinglePageGenerationPrompt,
} from "./prompt";

// ── Type definitions for DeepAgent ──

export interface DeepAgentStreamResult {
  stream: (...args: any[]) => Promise<AsyncIterable<unknown>>;
}

interface AgentSessionEntry {
  agent: DeepAgentStreamResult | null;
  /** Per-page agents for concurrent generation (keyed by pageId). */
  pageAgents: Map<string, DeepAgentStreamResult>;
  abortController: AbortController;
  projectDir: string;
  provider: string;
  model: string;
  baseUrl?: string;
}

// ── Agent factory ──

export function createSessionEditAgent(args: {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  styleId?: string | null;
  context: SessionDeckGenerationContext;
}): DeepAgentStreamResult {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl);
  const backend = new FilesystemBackend({
    rootDir: args.context.projectDir,
    virtualMode: true,
  });
  const tools = createSessionBoundDeckTools(args.context);
  const systemPrompt = buildEditAgentSystemPrompt(args.styleId, args.context);

  log.info("[deepagent] create session edit agent", {
    sessionId: args.context.sessionId,
    provider: args.provider,
    model: args.model || "",
    styleId: args.styleId || "",
    projectDir: args.context.projectDir,
    indexPath: args.context.indexPath,
    selectedPageId: args.context.selectedPageId,
  });

  return createDeepAgent({
    model: model as any,
    backend,
    systemPrompt,
    tools: tools as any,
  });
}

export function createSessionDeckAgent(args: {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  styleId?: string | null;
  context: SessionDeckGenerationContext;
}): DeepAgentStreamResult {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl);
  const backend = new FilesystemBackend({
    rootDir: args.context.projectDir,
    virtualMode: true,
  });
  const getToolName = (tool: unknown): string => {
    const maybe = tool as { name?: unknown; lc_kwargs?: { name?: unknown } };
    if (typeof maybe.name === "string") return maybe.name;
    if (typeof maybe.lc_kwargs?.name === "string") return maybe.lc_kwargs.name;
    return "";
  };
  const tools = createSessionBoundDeckTools(args.context);
  const systemPrompt = buildDeckAgentSystemPrompt(args.styleId, args.context);

  log.info("[deepagent] create session deck agent", {
    sessionId: args.context.sessionId,
    provider: args.provider,
    model: args.model || "",
    styleId: args.styleId || "",
    projectDir: args.context.projectDir,
    indexPath: args.context.indexPath,
    selectedPageId: args.context.selectedPageId,
    selectedPagePath:
      args.context.selectedPageId && args.context.pageFileMap[args.context.selectedPageId]
        ? args.context.pageFileMap[args.context.selectedPageId]
        : "",
    totalPages: args.context.outlineTitles.length,
    toolNames: tools.map((tool) => getToolName(tool)).filter((name) => name.length > 0),
  });

  return createDeepAgent({
    model: model as any,
    backend,
    systemPrompt,
    tools: tools as any,
  });
}

// ── Model resolution ──

const MODEL_DEFAULTS: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-5-20250929",
  deepseek: "deepseek-chat",
};

export function resolveModel(
  provider: string,
  apiKey: string,
  model?: string,
  baseUrl?: string
): BaseLanguageModel {
  const resolvedModel = model || MODEL_DEFAULTS[provider] || MODEL_DEFAULTS.anthropic;

  log.info("[llm] resolveModel", { provider, model: resolvedModel, baseUrl: baseUrl || "" });

  switch (provider) {
    case "openai":
      return new ChatOpenAI({
        model: resolvedModel,
        apiKey,
        configuration: baseUrl ? { baseURL: baseUrl } : undefined,
      });
    case "anthropic":
      return new ChatAnthropic({
        model: resolvedModel,
        apiKey,
        anthropicApiUrl: baseUrl || undefined,
      });
    case "deepseek":
      return new ChatOpenAI({
        model: resolvedModel,
        apiKey,
        configuration: { baseURL: baseUrl || "https://api.deepseek.com/v1" },
      });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Session management ──

export interface AgentSessionConfig {
  sessionId: string;
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  projectDir: string;
  db: PPTDatabase;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export class AgentManager {
  private agents = new Map<string, AgentSessionEntry>();

  constructor(private db: PPTDatabase) {}

  async createSession(
    config: AgentSessionConfig & {
      topic?: string
      styleId?: string
      pageCount?: number
    }
  ): Promise<string> {
    const model = config.model || DEFAULT_MODEL;
    log.info("[agent] createSession", {
      sessionId: config.sessionId,
      provider: config.provider,
      model,
      topic: config.topic || "",
      styleId: config.styleId || "",
      pageCount: config.pageCount || null,
      projectDir: config.projectDir,
    });

    const sessionId = await this.db.createSession({
      id: config.sessionId,
      title: `PPT: ${config.topic || "Untitled"}`,
      topic: config.topic,
      styleId: config.styleId,
      pageCount: config.pageCount,
      provider: config.provider,
      model,
    });

    this.agents.set(sessionId, {
      agent: null,
      pageAgents: new Map(),
      abortController: new AbortController(),
      projectDir: config.projectDir,
      provider: config.provider,
      model,
      baseUrl: config.baseUrl,
    });

    return sessionId;
  }

  getAgent(sessionId: string) {
    return this.agents.get(sessionId);
  }

  setAgent(sessionId: string, agent: DeepAgentStreamResult) {
    const entry = this.agents.get(sessionId);
    if (!entry) return;
    entry.agent = agent;
  }

  clearAgent(sessionId: string) {
    const entry = this.agents.get(sessionId);
    if (!entry) return;
    entry.agent = null;
  }

  /** Store a per-page agent for concurrent generation. Does not overwrite the main agent. */
  setPageAgent(sessionId: string, pageId: string, agent: DeepAgentStreamResult) {
    const entry = this.agents.get(sessionId);
    if (!entry) return;
    entry.pageAgents.set(pageId, agent);
  }

  removePageAgent(sessionId: string, pageId: string) {
    const entry = this.agents.get(sessionId);
    if (!entry) return;
    entry.pageAgents.delete(pageId);
  }

  ensureSession(config: {
    sessionId: string
    provider: string
    model?: string
    baseUrl?: string
    projectDir: string
  }) {
    const existing = this.agents.get(config.sessionId);
    if (existing) {
      log.info("[agent] ensureSession hit existing", {
        sessionId: config.sessionId,
        provider: existing.provider,
        model: existing.model,
        projectDir: existing.projectDir,
      });
      return existing;
    }

    const model = config.model || DEFAULT_MODEL;
    const entry = {
      agent: null,
      pageAgents: new Map<string, DeepAgentStreamResult>(),
      abortController: new AbortController(),
      projectDir: config.projectDir,
      provider: config.provider,
      model,
      baseUrl: config.baseUrl,
    };

    log.info("[agent] ensureSession create entry", {
      sessionId: config.sessionId,
      provider: entry.provider,
      model,
      baseUrl: entry.baseUrl || "",
      projectDir: entry.projectDir,
    });

    this.agents.set(config.sessionId, entry);
    return entry;
  }

  beginRun(sessionId: string) {
    const entry = this.agents.get(sessionId);
    if (!entry) {
      log.warn("[agent] beginRun missing session", { sessionId });
      return null;
    }
    entry.abortController = new AbortController();
    log.info("[agent] beginRun", {
      sessionId,
      provider: entry.provider,
      model: entry.model,
      projectDir: entry.projectDir,
    });
    return entry;
  }

  cancelSession(sessionId: string): boolean {
    const entry = this.agents.get(sessionId);
    if (entry) {
      entry.abortController.abort();
      entry.agent = null;
      entry.pageAgents.clear();
      log.info("[agent] cancelSession", { sessionId });
      return true;
    }
    log.warn("[agent] cancelSession missing session", { sessionId });
    return false;
  }

  removeSession(sessionId: string): void {
    const entry = this.agents.get(sessionId);
    if (entry) {
      entry.abortController.abort();
      entry.agent = null;
      entry.pageAgents.clear();
    }
    this.agents.delete(sessionId);
    log.info("[agent] removeSession", { sessionId });
  }
}
