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
  temperature?: number;
}

// ── Agent factory ──

export function createSessionEditAgent(args: {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  styleId?: string | null;
  context: SessionDeckGenerationContext;
}): DeepAgentStreamResult {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, args.temperature);
  const backend = new FilesystemBackend({
    rootDir: args.context.projectDir,
    virtualMode: true,
  });
  const tools = createSessionBoundDeckTools(args.context);
  const systemPrompt = buildEditAgentSystemPrompt(args.styleId, args.context);

  log.info("[deepagent] create session edit agent", {
    sessionId: args.context.sessionId,
    provider: args.provider,
    model: args.model,
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
  model: string;
  baseUrl?: string;
  temperature?: number;
  styleId?: string | null;
  context: SessionDeckGenerationContext;
}): DeepAgentStreamResult {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, args.temperature);
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
    model: args.model,
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

export const DEFAULT_MODEL_TEMPERATURE = 0.7;

const resolveOpenAICompatibilityModelKwargs = (
  baseUrl?: string
): { modelKwargs: Record<string, unknown>; compatibilityFlags: string[] } => {
  if (!baseUrl) {
    return { modelKwargs: {}, compatibilityFlags: [] };
  }

  return {
    modelKwargs: { thinking: { type: "disabled" } },
    compatibilityFlags: ["thinking.type=disabled"],
  };
};

export function resolveModel(
  provider: string,
  apiKey: string,
  model: string,
  baseUrl?: string,
  temperature?: number
): BaseLanguageModel {
  const resolvedModel = model.trim();
  if (!resolvedModel) {
    throw new Error("model 不能为空，请先在系统设置中配置模型。");
  }
  const resolvedTemperature =
    Number.isFinite(temperature) && typeof temperature === "number"
      ? Math.max(0, Math.min(2, temperature))
      : DEFAULT_MODEL_TEMPERATURE;
  const resolvedBaseUrl = typeof baseUrl === "string" ? baseUrl.trim() : "";
  const { modelKwargs, compatibilityFlags } = resolveOpenAICompatibilityModelKwargs(resolvedBaseUrl);

  log.info("[llm] resolveModel", {
    provider,
    model: resolvedModel,
    baseUrl: resolvedBaseUrl,
    temperature: resolvedTemperature ?? null,
    openAICompatibility: compatibilityFlags,
  });

  switch (provider) {
    case "openai":
      return new ChatOpenAI({
        model: resolvedModel,
        apiKey,
        temperature: resolvedTemperature,
        configuration: resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : undefined,
        modelKwargs,
      });
    case "anthropic":
      return new ChatAnthropic({
        model: resolvedModel,
        apiKey,
        temperature: resolvedTemperature,
        anthropicApiUrl: resolvedBaseUrl || undefined,
      });
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Session management ──

export interface AgentSessionConfig {
  sessionId: string;
  provider: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  projectDir: string;
}

export class AgentManager {
  private agents = new Map<string, AgentSessionEntry>();

  constructor(private db: PPTDatabase) {}

  async createSession(
    config: AgentSessionConfig & {
      topic?: string
      styleId?: string
      pageCount?: number
      referenceDocumentPath?: string | null
    }
  ): Promise<string> {
    const model = config.model.trim();
    if (!model) {
      throw new Error("创建会话失败：model 不能为空。");
    }
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
      referenceDocumentPath: config.referenceDocumentPath,
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
      temperature: config.temperature,
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
    model: string
    baseUrl?: string
    temperature?: number
    projectDir: string
  }) {
    const existing = this.agents.get(config.sessionId);
    if (existing) {
      existing.provider = config.provider;
      existing.model = config.model;
      existing.baseUrl = config.baseUrl;
      existing.temperature = config.temperature;
      existing.projectDir = config.projectDir;
      log.info("[agent] ensureSession hit existing", {
        sessionId: config.sessionId,
        provider: existing.provider,
        model: existing.model,
        baseUrl: existing.baseUrl || "",
        temperature: existing.temperature ?? null,
        projectDir: existing.projectDir,
      });
      return existing;
    }

    const model = config.model.trim();
    if (!model) {
      throw new Error("恢复会话失败：model 不能为空。");
    }
    const entry = {
      agent: null,
      pageAgents: new Map<string, DeepAgentStreamResult>(),
      abortController: new AbortController(),
      projectDir: config.projectDir,
      provider: config.provider,
      model,
      baseUrl: config.baseUrl,
      temperature: config.temperature,
    };

    log.info("[agent] ensureSession create entry", {
      sessionId: config.sessionId,
      provider: entry.provider,
      model,
      baseUrl: entry.baseUrl || "",
      temperature: entry.temperature ?? null,
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
