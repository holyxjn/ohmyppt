/** Generation orchestration: LLM planning + DeepAgent execution. */
import pLimit from "p-limit";
import log from "electron-log/main.js";
import type { AgentManager } from "../agent";
import {
  createSessionDeckAgent,
  createSessionEditAgent,
  resolveModel,
} from "../agent";
import {
  buildDesignContractSystemPrompt,
  buildDesignContractUserPrompt,
  buildEditUserPrompt,
  buildPlanningSystemPrompt,
  buildPlanningUserPrompt,
  buildSinglePageGenerationPrompt,
} from "../prompt";
import type { GenerateChunkEvent } from "@shared/generation";
import type { DesignContract, OutlineItem } from "../tools/types";
import { extractModelText, extractJsonBlock, sleep } from "./utils";

// ── Shared agent stream processor ───────────────────────────────────────

interface DeckToolStatusChunk {
  type?: string;
  label?: string;
  detail?: string;
  progress?: number;
  pageId?: string;
  agentName?: string;
}

interface StreamProcessOptions {
  emit?: (chunk: GenerateChunkEvent) => void;
  runId: string;
  stage: string;
  totalPages: number;
  provider: string;
  model: string;
  sessionId: string;
  workerLabel?: string;
  /**
   * Called for each `deck_tool_status` custom chunk.
   * Return `true` to break the stream loop (e.g. all pages written).
   */
  onCustom?: (custom: DeckToolStatusChunk) => boolean | void;
  /** Called when `updates.model` is detected — the model is actively thinking. */
  onModelThinking?: (defaultProgress: number) => void;
  /** Called with the extracted assistant message text. */
  onMessage?: (content: string) => void;
}

/**
 * Iterate an agent stream, dispatching parsed chunks to the provided handlers.
 * Covers the common `custom` / `updates` / `messages` mode triad shared by all three
 * generation paths (single-page, parallel, edit).
 */
async function processAgentStream(
  stream: AsyncIterable<unknown>,
  options: StreamProcessOptions,
): Promise<void> {
  const {
    sessionId, workerLabel,
    onCustom, onModelThinking, onMessage,
  } = options;
  let firstChunkLogged = false;

  for await (const chunk of stream) {
    if (!firstChunkLogged) {
      firstChunkLogged = true;
      log.info("[deepagent] stream first chunk", { sessionId, worker: workerLabel });
    }
    if (!Array.isArray(chunk) || chunk.length < 3) continue;
    const parts = chunk as unknown[];
    const mode = parts[1] as string;
    const data = parts[2];

    if (mode === "custom" && data && typeof data === "object") {
      const custom = data as DeckToolStatusChunk;
      if (custom.type === "deck_tool_status" && custom.label) {
        const shouldBreak = onCustom?.(custom);
        if (shouldBreak) break;
      }
      continue;
    }

    if (mode === "updates" && data && typeof data === "object") {
      const updates = data as Record<string, unknown>;
      if (updates.model) {
        onModelThinking?.(42);
      }
      continue;
    }

    if (mode === "messages" && Array.isArray(data)) {
      const [message] = data as Array<Record<string, unknown>>;
      const content = extractModelText(message);
      if (content) {
        onMessage?.(content);
      }
    }
  }
}

const normalizeOutlineText = (raw: string): string => {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  // Prefer compact clause-style outline to reduce downstream prompt bloat.
  const chunks = text
    .split(/[；;。.!?\n、,，|/]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const compact = (chunks.length > 0 ? chunks.slice(0, 4).join("；") : text).trim();
  if (compact.length <= 96) return compact;
  return `${compact.slice(0, 96).trimEnd()}…`;
};

const normalizeKeyPoints = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .slice(0, 4)
    .map((item) => (item.length > 24 ? `${item.slice(0, 24).trimEnd()}…` : item));
};

const DEFAULT_DESIGN_CONTRACT: DesignContract = {
  theme: "cohesive editorial presentation",
  background: "root uses a consistent full-canvas background with no exposed white edges",
  palette: ["#f8fafc", "#334155", "#64748b", "#94a3b8"],
  titleStyle: "text-5xl font-semibold text-slate-800",
  layoutMotif: "spacious 16:9 grids with clear title and content regions",
  chartStyle: "readable Chart.js v4 charts with restrained colors and stable canvas height",
  shapeLanguage: "8px radius, light borders, subtle shadows",
};

const normalizeDesignContract = (value: unknown): DesignContract => {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const readText = (key: keyof Omit<DesignContract, "palette">): string => {
    const text = String(record[key] ?? "").replace(/\s+/g, " ").trim();
    const fallback = DEFAULT_DESIGN_CONTRACT[key];
    const resolved = text || fallback;
    return resolved.length > 120 ? `${resolved.slice(0, 120).trimEnd()}…` : resolved;
  };
  const paletteRaw = Array.isArray(record.palette) ? record.palette : [];
  const palette = paletteRaw
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .slice(0, 6);
  const resolvedPalette = Array.from(new Set([...palette, ...DEFAULT_DESIGN_CONTRACT.palette])).slice(0, 6);
  return {
    theme: readText("theme"),
    background: readText("background"),
    palette: resolvedPalette,
    titleStyle: readText("titleStyle"),
    layoutMotif: readText("layoutMotif"),
    chartStyle: readText("chartStyle"),
    shapeLanguage: readText("shapeLanguage"),
  };
};

const parseModelJson = (responseText: string): unknown => {
  let source = responseText.trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidates = [source, extractJsonBlock(source)];
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (typeof parsed !== "string") {
          return parsed;
        }
        source = parsed.trim();
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError === null) {
      continue;
    }

    const preview = source.length > 200 ? `${source.slice(0, 200)}…` : source;
    throw new Error(
      `LLM 返回的 JSON 解析失败: ${lastError instanceof Error ? lastError.message : String(lastError)}. 原始文本预览: ${preview}`
    );
  }

  try {
    return JSON.parse(extractJsonBlock(source)) as unknown;
  } catch (err) {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (typeof parsed !== "string") return parsed;
    } catch {
      // The detailed error below uses the first parse failure.
    }
    const preview = source.length > 200 ? `${source.slice(0, 200)}…` : source;
    throw new Error(
      `LLM 返回的 JSON 解析失败: ${err instanceof Error ? err.message : String(err)}. 原始文本预览: ${preview}`
    );
  }
};

const SUMMARY_PUNCT_ONLY_RE = /^[\s.。!！?？,，;；:：、~\-—_`'"“”‘’()（）\[\]【】]+$/;

const isMeaningfulSummary = (value: string): boolean => {
  const text = value.trim();
  if (!text) return false;
  if (SUMMARY_PUNCT_ONLY_RE.test(text)) return false;
  if (text.length <= 2 && !/[\p{L}\p{N}\u4e00-\u9fff]/u.test(text)) return false;
  return true;
};

const normalizePageSummary = (raw: string, pageTitle: string): string => {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  const withoutPrefix = trimmed.replace(/^第\s*\d+\s*页\s*[:：]\s*/u, "").trim();
  const candidate = withoutPrefix || trimmed;
  if (!isMeaningfulSummary(candidate)) {
    return `已完成《${pageTitle}》页面生成`;
  }
  if (candidate.length <= 120) return candidate;
  return `${candidate.slice(0, 120).trimEnd()}…`;
};

export const planDeckWithLLM = async (args: {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  styleId: string | null | undefined;
  totalPages: number;
  topic: string;
  userMessage: string;
  emit?: (chunk: GenerateChunkEvent) => void;
  runId?: string;
  signal?: AbortSignal;
}): Promise<OutlineItem[]> => {
  const client = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl);
  const systemPrompt = buildPlanningSystemPrompt(args.totalPages);
  const userPrompt = buildPlanningUserPrompt({
    topic: args.topic,
    totalPages: args.totalPages,
    userMessage: args.userMessage,
  });

  args.emit?.({
    type: "llm_status",
    payload: {
      runId: args.runId || "",
      stage: "planning",
      label: "正在整理演示大纲",
      progress: 4,
      totalPages: args.totalPages,
      provider: args.provider,
      model: args.model,
      detail: `正在生成 ${args.totalPages} 页的标题与要点`,
    },
  });
  log.info("[llm] invoke plan_deck", {
    provider: args.provider,
    model: args.model,
    styleId: args.styleId || "",
    totalPages: args.totalPages,
    topic: args.topic,
  });
  const timeoutSignal = AbortSignal.timeout(60_000);
  const combinedSignal = args.signal
    ? AbortSignal.any([timeoutSignal, args.signal])
    : timeoutSignal;
  const response = await client.invoke(
    [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ],
    { signal: combinedSignal }
  );
  const responseText = extractModelText(response);
  args.emit?.({
    type: "llm_status",
    payload: {
      runId: args.runId || "",
      stage: "planning",
      label: "大纲草案已生成",
      progress: 9,
      totalPages: args.totalPages,
      provider: args.provider,
      model: args.model,
      detail: "正在整理成可执行页面计划",
    },
  });
  log.info("[llm] plan_deck response", {
    textLength: responseText.length,
    preview: JSON.stringify(responseText.length > 240 ? `${responseText.slice(0, 240)}…` : responseText),
  });
  const parsed = parseModelJson(responseText);
  if (!Array.isArray(parsed)) {
    throw new Error("LLM plan_deck 返回格式不正确，期望 [{title, keyPoints[]}] 数组。");
  }
  if (parsed.length === 0 || typeof parsed[0] !== "object" || parsed[0] === null) {
    throw new Error("LLM plan_deck pages 返回格式不正确，期望 [{title, keyPoints[]}] 数组。");
  }
  const items: OutlineItem[] = (parsed as Array<Record<string, unknown>>).map((item, index) => {
    const title = String(item.title ?? "").trim();
    const keyPoints = normalizeKeyPoints(item.keyPoints);
    if (!title) {
      throw new Error(`LLM plan_deck 第 ${index + 1} 项缺少 title，期望格式: { title, keyPoints[] }`);
    }
    if (keyPoints.length < 2 || keyPoints.length > 4) {
      throw new Error(
        `LLM plan_deck 第 ${index + 1} 项 keyPoints 数量非法（当前 ${keyPoints.length}），要求 2-4 条。`
      );
    }
    return {
      title,
      contentOutline: normalizeOutlineText(keyPoints.join("；")),
    };
  });
  if (items.length === 0) {
    throw new Error("LLM plan_deck returned an empty outline.");
  }
  // Pad if LLM returned fewer pages than requested
  while (items.length < args.totalPages) {
    items.push({
      title: `第 ${items.length + 1} 页`,
      contentOutline: "",
    });
  }
  return items.slice(0, args.totalPages);
};

export const buildDesignContractWithLLM = async (args: {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  styleId: string | null | undefined;
  styleSkillPrompt: string;
  totalPages: number;
  emit?: (chunk: GenerateChunkEvent) => void;
  runId?: string;
  signal?: AbortSignal;
}): Promise<DesignContract> => {
  const client = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl);
  const totalPages = Math.max(1, args.totalPages);
  args.emit?.({
    type: "llm_status",
    payload: {
      runId: args.runId || "",
      stage: "planning",
      label: "正在统一视觉方向",
      progress: 9,
      totalPages,
      provider: args.provider,
      model: args.model,
      detail: "正在生成独立设计契约",
    },
  });
  try {
    const timeoutSignal = AbortSignal.timeout(45_000);
    const combinedSignal = args.signal
      ? AbortSignal.any([timeoutSignal, args.signal])
      : timeoutSignal;
    const response = await client.invoke(
      [
        { role: "system" as const, content: buildDesignContractSystemPrompt(args.styleSkillPrompt) },
        {
          role: "user" as const,
          content: buildDesignContractUserPrompt(),
        },
      ],
      { signal: combinedSignal }
    );
    const responseText = extractModelText(response);
    log.info("[llm] design_contract response", {
      textLength: responseText.length,
      preview: JSON.stringify(responseText.length > 240 ? `${responseText.slice(0, 240)}…` : responseText),
    });
    const parsed = parseModelJson(responseText);
    const contract = normalizeDesignContract(parsed);
    args.emit?.({
      type: "llm_status",
      payload: {
        runId: args.runId || "",
        stage: "planning",
        label: "视觉方向已统一",
        progress: 10,
        totalPages,
        provider: args.provider,
        model: args.model,
        detail: contract.theme,
      },
    });
    return contract;
  } catch (error) {
    if (args.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
    log.warn("[llm] design_contract fallback", {
      provider: args.provider,
      model: args.model,
      styleId: args.styleId || "",
      message: error instanceof Error ? error.message : String(error),
    });
    return normalizeDesignContract(null);
  }
};

export const runDeepAgentDeckGeneration = async (args: {
  sessionId: string;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  styleId: string | null | undefined;
  styleSkillPrompt: string;
  topic: string;
  deckTitle: string;
  userMessage: string;
  outlineTitles: string[];
  outlineItems: OutlineItem[];
  designContract: DesignContract;
  projectDir: string;
  indexPath: string;
  pageFileMap: Record<string, string>;
  agentManager: AgentManager;
  emit?: (chunk: GenerateChunkEvent) => void;
  runId?: string;
  signal?: AbortSignal;
}): Promise<{
  summary: string;
  failedPages: Array<{ pageId: string; title: string; reason: string }>;
}> => {
  const totalPages = args.outlineTitles.length;
  const clampProgress = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
  const pageRefs = args.outlineTitles.map((title, index) => ({
    pageNumber: index + 1,
    pageId: `page-${index + 1}`,
    title,
    outline: args.outlineItems[index]?.contentOutline || "",
  }));
  const pageSummaryMap = new Map<number, string>();
  const useDualWorkerQueue = totalPages >= 3;
  const pageProgressMap = new Map<string, number>();
  let renderingProgress = 0;
  const toRenderingProgress = (target: number): number => {
    const capped = clampProgress(Math.min(90, target));
    renderingProgress = Math.max(renderingProgress, capped);
    return renderingProgress;
  };
  const emitRenderingStatus = (input: { label: string; detail?: string; progress: number }) => {
    args.emit?.({
      type: "llm_status",
      payload: {
        runId: args.runId || "",
        stage: "rendering",
        label: input.label,
        detail: input.detail,
        progress: toRenderingProgress(input.progress),
        totalPages,
        provider: args.provider,
        model: args.model,
      },
    });
  };

  const setPageProgress = (pageId: string, rawProgress: number): number => {
    const prev = pageProgressMap.get(pageId) ?? 0;
    const bounded = Math.max(0, Math.min(100, Math.round(rawProgress)));
    const next = Math.max(prev, bounded);
    pageProgressMap.set(pageId, next);
    return next;
  };

  const getCompletedPageCount = (): number =>
    pageRefs.reduce((count, page) => count + ((pageProgressMap.get(page.pageId) ?? 0) >= 100 ? 1 : 0), 0);

  const getOverallRenderProgress = (): number => {
    const sum = pageRefs.reduce((acc, page) => acc + (pageProgressMap.get(page.pageId) ?? 0), 0);
    const ratio = sum / Math.max(1, totalPages * 100);
    return 10 + ratio * 80;
  };

  const resolvePageProgressFromCustomStatus = (custom: DeckToolStatusChunk): number => {
    const label = custom.label || "";
    if (/读取会话上下文/.test(label)) return 25;
    if (/更新\s*page-\d+|更新单页\s*page-\d+/.test(label)) return 60;
    if (/验证完成状态/.test(label)) return 85;
    if (/所有页面已填充|当前页面已填充/.test(label)) return 95;
    if (/生成完成|修改完成/.test(label)) return 100;
    if (Number.isFinite(custom.progress)) {
      const raw = Number(custom.progress);
      return Math.max(12, Math.min(96, raw));
    }
    return 50;
  };

  const emitPageStatus = (args: {
    pageId: string;
    label: string;
    detail?: string;
    pageProgress: number;
  }) => {
    setPageProgress(args.pageId, args.pageProgress);
    emitRenderingStatus({
      label: args.label,
      detail: args.detail,
      progress: getOverallRenderProgress(),
    });
  };

  emitRenderingStatus({
    label: "创意引擎已启动",
    progress: 12,
    detail: useDualWorkerQueue
      ? "已启用双通道并发生成每一页"
      : "将按顺序细致生成每一页",
  });

  log.info("[deepagent] invoke deck generation", {
    sessionId: args.sessionId,
    provider: args.provider,
    model: args.model,
    styleId: args.styleId || "",
    projectDir: args.projectDir,
    indexPath: args.indexPath,
    totalPages,
    fixedConcurrency: useDualWorkerQueue ? 2 : 1,
    designContract: {
      theme: args.designContract.theme,
      background: args.designContract.background,
      palette: args.designContract.palette,
      titleStyle: args.designContract.titleStyle,
    },
  });

  const generateSinglePage = async (
    page: {
      pageNumber: number;
      pageId: string;
      title: string;
      outline: string;
    },
    workerLabel: string,
    retryContext?: {
      attempt: number;
      maxRetries: number;
      previousError: string;
    }
  ): Promise<string> => {
    if (args.signal?.aborted) {
      throw new Error("生成已取消");
    }
    const pageStartedAt = Date.now();

    emitPageStatus({
      pageId: page.pageId,
      label: `开始生成第 ${page.pageNumber} 页`,
      detail: `${page.pageId} · ${page.title}`,
      pageProgress: 5,
    });

    const currentPagePath = args.pageFileMap[page.pageId];
    if (!currentPagePath) {
      throw new Error(`pageFileMap 缺少 ${page.pageId} 对应文件路径`);
    }
    log.info("[deepagent] page generation context", {
      sessionId: args.sessionId,
      worker: workerLabel,
      styleId: args.styleId || "",
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      pagePath: currentPagePath,
      outline: page.outline || "",
      outlineLength: (page.outline || "").length,
    });

    const deepAgent = createSessionDeckAgent({
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      styleId: args.styleId,
      context: {
        sessionId: args.sessionId,
        projectDir: args.projectDir,
        indexPath: args.indexPath,
        topic: args.topic,
        deckTitle: args.deckTitle,
        styleId: args.styleId,
        styleSkillPrompt: args.styleSkillPrompt,
        designContract: args.designContract,
        userMessage: args.userMessage,
        outlineTitles: [page.title],
        outlineItems: [{ title: page.title, contentOutline: page.outline }],
        pageFileMap: { [page.pageId]: currentPagePath },
        selectedPageId: page.pageId,
        selectedPageNumber: page.pageNumber,
        existingPageIds: [page.pageId],
        allowedPageIds: [page.pageId],
      },
    });
    args.agentManager.setPageAgent(args.sessionId, page.pageId, deepAgent);

    try {
      const timeoutSignal = AbortSignal.timeout(5 * 60_000);
      const combinedSignal = args.signal
        ? AbortSignal.any([timeoutSignal, args.signal])
        : timeoutSignal;
      const stream = await deepAgent.stream(
        {
          messages: [
            {
              role: "user",
              content: buildSinglePageGenerationPrompt({
                topic: args.topic,
                deckTitle: args.deckTitle,
                pageId: page.pageId,
                pageNumber: page.pageNumber,
                pageTitle: page.title,
                pageOutline: page.outline,
                designContract: args.designContract,
                retryContext,
              }),
            },
          ],
        },
        {
          streamMode: ["updates", "messages", "custom"],
          subgraphs: true,
          signal: combinedSignal,
        }
      );

      let pageSummaryFromStatus = "";
      let pageSummaryFromMessage = "";
      await processAgentStream(stream, {
        emit: args.emit,
        runId: args.runId || "",
        stage: "rendering",
        totalPages,
        provider: args.provider,
        model: args.model,
        sessionId: args.sessionId,
        workerLabel,
        onCustom: (custom) => {
          const mappedPageProgress = resolvePageProgressFromCustomStatus(custom);
          const normalizedLabel =
            custom.label === "生成完成"
              ? `第 ${page.pageNumber} 页内容生成完成`
              : custom.label === "所有页面已填充" || custom.label === "当前页面已填充"
                ? `第 ${page.pageNumber} 页验证通过`
                : (custom.label || "");
          const normalizedDetail =
            custom.label === "所有页面已填充" || custom.label === "当前页面已填充"
              ? `${page.title} · 页面内容已写入`
              : custom.detail;
          if (
            typeof custom.label === "string" &&
            /生成完成|修改完成/.test(custom.label) &&
            typeof custom.detail === "string" &&
            isMeaningfulSummary(custom.detail)
          ) {
            pageSummaryFromStatus = custom.detail.trim();
          }
          emitPageStatus({
            pageId: page.pageId,
            label: normalizedLabel,
            detail: normalizedDetail,
            pageProgress: mappedPageProgress,
          });
        },
        onModelThinking: (defaultProgress) => {
          const mappedPageProgress = Math.max(12, Math.min(96, defaultProgress));
          emitPageStatus({
            pageId: page.pageId,
            label: `模型正在构思第 ${page.pageNumber} 页`,
            detail: page.title,
            pageProgress: mappedPageProgress,
          });
        },
        onMessage: (content) => {
          if (!isMeaningfulSummary(content)) return;
          pageSummaryFromMessage = content.trim();
        },
      });

      setPageProgress(page.pageId, 100);
      const completedCount = getCompletedPageCount();
      emitRenderingStatus({
        label: `第 ${page.pageNumber} 页完成`,
        detail: `${page.title} · 已完成 ${completedCount}/${totalPages} 页`,
        progress: getOverallRenderProgress(),
      });

      log.info("[deepagent] page generation finished", {
        sessionId: args.sessionId,
        worker: workerLabel,
        styleId: args.styleId || "",
        pageId: page.pageId,
        retryAttempt: retryContext?.attempt || 0,
        elapsedMs: Date.now() - pageStartedAt,
        pagePath: currentPagePath,
      });

      const rawSummary = pageSummaryFromMessage || pageSummaryFromStatus;
      return normalizePageSummary(rawSummary, page.title);
    } finally {
      args.agentManager.removePageAgent(args.sessionId, page.pageId);
    }
  };

  // 仅重试失败页面，避免影响已成功页面。
  // MAX_PAGE_RETRIES=3 表示首轮失败后最多再重试 3 次。
  const MAX_PAGE_RETRIES = 3;
  const RETRY_DELAY_BASE_MS = 1_000;
  const generateSinglePageWithRetry = async (
    page: {
      pageNumber: number;
      pageId: string;
      title: string;
      outline: string;
    },
    workerLabel: string
  ): Promise<string> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_PAGE_RETRIES; attempt++) {
      try {
        const retryContext =
          attempt > 0 && lastError
            ? {
                attempt,
                maxRetries: MAX_PAGE_RETRIES,
                previousError: lastError instanceof Error ? lastError.message : String(lastError),
              }
            : undefined;
        return await generateSinglePage(page, workerLabel, retryContext);
      } catch (error) {
        lastError = error;
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt >= MAX_PAGE_RETRIES) break;
        const retryAttempt = attempt + 1;
        const retryDelayMs = RETRY_DELAY_BASE_MS * retryAttempt;
        emitPageStatus({
          pageId: page.pageId,
          label: `第 ${page.pageNumber} 页重试中（${retryAttempt}/${MAX_PAGE_RETRIES}）`,
          detail: `仅重试失败页：上次失败原因 ${reason}`,
          pageProgress: 12,
        });
        log.warn("[deepagent] page generation retry scheduled", {
          sessionId: args.sessionId,
          styleId: args.styleId || "",
          pageId: page.pageId,
          worker: workerLabel,
          attempt: retryAttempt,
          maxRetries: MAX_PAGE_RETRIES,
          retryDelayMs,
          lastErrorReason: reason,
          reason,
        });
        await sleep(retryDelayMs, args.signal);
      }
    }
    throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? "页面生成失败")));
  };

  const workerCount = useDualWorkerQueue ? 2 : 1;
  const PAGE_GENERATION_STAGGER_MS = 500;
  if (useDualWorkerQueue) {
    emitRenderingStatus({
      label: "正在加速生成流程",
      progress: 14,
      detail: "创意即将正式生成..",
    });
  }
  const limit = pLimit(workerCount);
  const settled = await Promise.allSettled(
    pageRefs.map((page, index) =>
      limit(async () => {
        if (args.signal?.aborted) throw new Error("生成已取消");
        const workerLabel = useDualWorkerQueue ? "limit-worker" : "single-worker";
        const launchDelayMs = useDualWorkerQueue ? (index % workerCount) * PAGE_GENERATION_STAGGER_MS : 0;
        if (launchDelayMs > 0) {
          log.info("[deepagent] queue stagger delay", {
            sessionId: args.sessionId,
            worker: workerLabel,
            styleId: args.styleId || "",
            pageId: page.pageId,
            pageNumber: page.pageNumber,
            delayMs: launchDelayMs,
          });
          await sleep(launchDelayMs, args.signal);
        }
        if (args.signal?.aborted) throw new Error("生成已取消");
        log.info("[deepagent] queue dispatch", {
          sessionId: args.sessionId,
          worker: workerLabel,
          styleId: args.styleId || "",
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
        });
        const summary = await generateSinglePageWithRetry(page, workerLabel);
        if (summary) {
          pageSummaryMap.set(page.pageNumber, `第 ${page.pageNumber} 页：${summary}`);
        }
      })
    )
  );
  const failedPages: Array<{ pageId: string; title: string; reason: string }> = [];
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      const page = pageRefs[index];
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failedPages.push({
        pageId: page.pageId,
        title: page.title,
        reason,
      });
      log.warn("[deepagent] page generation failed", {
        sessionId: args.sessionId,
        styleId: args.styleId || "",
        pageId: page.pageId,
        reason,
      });
    }
  });
  const finalAssistantText = pageRefs
    .map((page) => pageSummaryMap.get(page.pageNumber))
    .filter((item): item is string => Boolean(item))
    .join("\n");
  log.info("[deepagent] host worker queue generation completed", {
    sessionId: args.sessionId,
    styleId: args.styleId || "",
    totalPages,
    workerCount,
    finalAssistantPreview: finalAssistantText.slice(0, 200),
  });
  return {
    summary: finalAssistantText,
    failedPages,
  };
};

export const runDeepAgentEdit = async (args: {
  sessionId: string;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  styleId: string | null | undefined;
  styleSkillPrompt: string;
  topic: string;
  deckTitle: string;
  userMessage: string;
  outlineTitles: string[];
  outlineItems: OutlineItem[];
  projectDir: string;
  indexPath: string;
  pageFileMap: Record<string, string>;
  designContract?: DesignContract;
  editScope: "main" | "page";
  selectedPageId?: string;
  selectedPageNumber?: number;
  selectedSelector?: string;
  elementTag?: string;
  elementText?: string;
  existingPageIds?: string[];
  agentManager: AgentManager;
  emit?: (chunk: GenerateChunkEvent) => void;
  runId?: string;
  signal?: AbortSignal;
}): Promise<string> => {
  const editAgent = createSessionEditAgent({
    provider: args.provider,
    apiKey: args.apiKey,
    model: args.model,
    baseUrl: args.baseUrl,
    styleId: args.styleId,
    context: {
      mode: "edit",
      editScope: args.editScope,
      sessionId: args.sessionId,
      projectDir: args.projectDir,
      indexPath: args.indexPath,
      topic: args.topic,
      deckTitle: args.deckTitle,
      styleId: args.styleId,
      styleSkillPrompt: args.styleSkillPrompt,
      designContract: args.designContract,
      userMessage: args.userMessage,
      outlineTitles: args.outlineTitles,
      outlineItems: args.outlineItems,
      pageFileMap: args.pageFileMap,
      selectedPageId: args.selectedPageId,
      selectedPageNumber: args.selectedPageNumber,
      selectedSelector: args.selectedSelector,
      elementTag: args.elementTag,
      elementText: args.elementText,
      existingPageIds: args.existingPageIds,
      allowedPageIds: args.editScope === "page" && args.selectedPageId ? [args.selectedPageId] : undefined,
    },
  });
  args.agentManager.setAgent(args.sessionId, editAgent);

  args.emit?.({
    type: "llm_status",
    payload: {
      runId: args.runId || "",
      stage: "editing",
      label: args.editScope === "main" ? "正在微调总览壳交互" : "正在温和调整页面内容",
      progress: 40,
      totalPages: args.outlineTitles.length,
      provider: args.provider,
      model: args.model,
      detail:
        args.editScope === "main"
          ? "仅修改 index.html 总览壳，不会改动 page 页面内容"
          : "仅修改目标页面，不会重排整套内容",
    },
  });

  log.info("[deepagent] invoke edit agent", {
    sessionId: args.sessionId,
    provider: args.provider,
    model: args.model,
    styleId: args.styleId || "",
    projectDir: args.projectDir,
    indexPath: args.indexPath,
    editScope: args.editScope,
    selectedPageId: args.selectedPageId,
    selectedPageNumber: args.selectedPageNumber,
    selectedSelector: args.selectedSelector || "",
    elementTag: args.elementTag || "",
    elementText: args.elementText || "",
  });

  let finalAssistantText = "";
  const totalPages = args.outlineTitles.length;
  let editProgress = 40;
  const emitEditStatus = (payload: {
    label: string;
    detail?: string;
    progress?: number;
  }) => {
    const bounded = Math.max(0, Math.min(100, Math.round(payload.progress ?? editProgress)));
    editProgress = Math.max(editProgress, bounded);
    args.emit?.({
      type: "llm_status",
      payload: {
        runId: args.runId || "",
        stage: "editing",
        label: payload.label,
        detail: payload.detail,
        progress: editProgress,
        totalPages,
        provider: args.provider,
        model: args.model,
      },
    });
  };

  try {
    const editTimeoutSignal = AbortSignal.timeout(5 * 60_000);
    const editCombinedSignal = args.signal
      ? AbortSignal.any([editTimeoutSignal, args.signal])
      : editTimeoutSignal;
    const stream = await editAgent.stream(
      {
        messages: [{
          role: "user",
          content: buildEditUserPrompt({
            userMessage: args.userMessage,
            editScope: args.editScope,
            selectedPageId: args.selectedPageId,
            selectedPageNumber: args.selectedPageNumber,
            selectedSelector: args.selectedSelector,
            elementTag: args.elementTag,
            elementText: args.elementText,
            existingPageIds: args.existingPageIds,
          }),
        }],
      },
      {
        streamMode: ["updates", "messages", "custom"],
        subgraphs: true,
        signal: editCombinedSignal,
      }
    );

    await processAgentStream(stream, {
      emit: args.emit,
      runId: args.runId || "",
      stage: "editing",
      totalPages,
      provider: args.provider,
      model: args.model,
      sessionId: args.sessionId,
      onCustom: (custom) => {
        emitEditStatus({
          label: custom.label || "",
          detail: custom.detail,
          progress: custom.progress ?? 50,
        });
      },
      onModelThinking: (defaultProgress) => {
        emitEditStatus({
          label: "模型正在分析修改需求",
          detail: "正在规划最小改动路径",
          progress: defaultProgress,
        });
      },
      onMessage: (content) => { finalAssistantText = content; },
    });
  } finally {
    args.agentManager.clearAgent(args.sessionId);
  }

  log.info("[deepagent] edit agent completed", {
    sessionId: args.sessionId,
    styleId: args.styleId || "",
    finalAssistantPreview: finalAssistantText.slice(0, 200),
  });

  return finalAssistantText;
};
