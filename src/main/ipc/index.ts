import { ipcMain, BrowserWindow, dialog, shell, safeStorage } from "electron";
import { is } from "@electron-toolkit/utils";
import log from "electron-log/main.js";
import type { PPTDatabase } from "../db/database";
import type { AgentManager } from "../agent";
import { resolveModel } from "../agent";
import type { GenerateChunkEvent, GenerateStartPayload, GeneratedPagePayload } from "@shared/generation";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import {
  loadStyleSkill,
  listStyleCatalog,
  getStyleDetail,
  createStyleSkill,
  updateStyleSkill,
  hasStyleSkill,
  deleteStyleSkill,
} from "../utils/style-skills";
import { pathToFileURL } from "url";
import { normalizeSession, normalizeMessage, sleep, extractOutlineTitles } from "./utils";
import { validatePersistedPageHtml } from "../tools/html-utils";
import type { DesignContract } from "../tools/types";
import {
  buildPageScaffoldHtml,
  buildProjectIndexHtml,
  extractPagesDataFromIndex,
  SESSION_ASSET_FILE_NAMES,
  type DeckPageFile,
} from "./template";
import { buildDesignContractWithLLM, planDeckWithLLM, runDeepAgentDeckGeneration, runDeepAgentEdit } from "./generate";

export function setupIPC(mainWindow: BrowserWindow, db: PPTDatabase, agentManager: AgentManager) {
  const ENCRYPTED_API_KEY_PREFIX = "enc:v1:";
  const MAX_SESSION_RUN_EVENTS = 500;
  const getPageSourceUrl = (htmlPath?: string) => {
    if (!htmlPath || !fs.existsSync(htmlPath)) return undefined;
    return pathToFileURL(htmlPath).toString();
  };

  type SessionRunState = {
    sessionId: string;
    runId: string;
    mode: "generate" | "edit";
    status: "running" | "completed" | "failed";
    progress: number;
    totalPages: number;
    events: GenerateChunkEvent[];
    error: string | null;
    startedAt: number;
    updatedAt: number;
  };
  const sessionRunStates = new Map<string, SessionRunState>();

  const summarizeGenerateChunk = (chunk: GenerateChunkEvent) => {
    switch (chunk.type) {
      case "stage_started":
      case "stage_progress":
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          label: chunk.payload.label,
          progress: chunk.payload.progress ?? null,
          totalPages: chunk.payload.totalPages ?? null,
        };
      case "llm_status":
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          label: chunk.payload.label,
          detail: chunk.payload.detail ?? null,
          progress: chunk.payload.progress ?? null,
          totalPages: chunk.payload.totalPages ?? null,
          provider: chunk.payload.provider ?? null,
          model: chunk.payload.model ?? null,
        };
      case "page_generated":
      case "page_updated":
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          pageNumber: chunk.payload.pageNumber,
          pageId: chunk.payload.pageId,
          title: chunk.payload.title,
          progress: chunk.payload.progress ?? null,
          htmlPath: chunk.payload.htmlPath ?? null,
        };
      case "run_completed":
        return {
          type: chunk.type,
          totalPages: chunk.payload.totalPages,
        };
      case "run_error":
        return {
          type: chunk.type,
          message: chunk.payload.message,
        };
      default:
        return { type: chunk.type };
    }
  };

  const beginSessionRunState = (args: {
    sessionId: string;
    runId: string;
    mode: "generate" | "edit";
    totalPages: number;
  }): void => {
    const now = Date.now();
    sessionRunStates.set(args.sessionId, {
      sessionId: args.sessionId,
      runId: args.runId,
      mode: args.mode,
      status: "running",
      progress: 0,
      totalPages: Math.max(1, Math.floor(args.totalPages || 1)),
      events: [],
      error: null,
      startedAt: now,
      updatedAt: now,
    });
  };

  const trackSessionRunChunk = (sessionId: string, chunk: GenerateChunkEvent): void => {
    const state = sessionRunStates.get(sessionId);
    if (!state) return;
    if (state.runId !== chunk.payload.runId) return;

    const compactChunk =
      chunk.type === "page_generated" || chunk.type === "page_updated"
        ? ({
            ...chunk,
            payload: {
              ...chunk.payload,
              html: "",
            },
          } as GenerateChunkEvent)
        : chunk;

    state.updatedAt = Date.now();
    state.events.push(compactChunk);
    if (state.events.length > MAX_SESSION_RUN_EVENTS) {
      state.events.splice(0, state.events.length - MAX_SESSION_RUN_EVENTS);
    }

    if (chunk.type === "run_completed") {
      state.status = "completed";
      state.progress = 100;
      state.totalPages = Math.max(state.totalPages, Math.floor(chunk.payload.totalPages || state.totalPages));
      state.error = null;
      return;
    }

    if (chunk.type === "run_error") {
      state.status = "failed";
      state.error = chunk.payload.message || "Generation failed";
      return;
    }

    if ("totalPages" in chunk.payload && typeof chunk.payload.totalPages === "number" && Number.isFinite(chunk.payload.totalPages)) {
      state.totalPages = Math.max(1, Math.floor(chunk.payload.totalPages));
    }
    if ("progress" in chunk.payload && typeof chunk.payload.progress === "number" && Number.isFinite(chunk.payload.progress)) {
      const boundedProgress = Math.max(0, Math.min(100, Math.round(chunk.payload.progress)));
      state.progress = Math.max(state.progress, boundedProgress);
    }
  };

  const emitGenerateChunk = (sessionId: string, chunk: GenerateChunkEvent) => {
    const enrichedChunk = {
      ...chunk,
      payload: {
        ...chunk.payload,
        sessionId,
        timestamp: new Date().toISOString(),
      },
    } as GenerateChunkEvent;

    if (
      enrichedChunk.type === "stage_started" ||
      enrichedChunk.type === "stage_progress" ||
      enrichedChunk.type === "llm_status" ||
      enrichedChunk.type === "page_generated" ||
      enrichedChunk.type === "page_updated" ||
      enrichedChunk.type === "run_completed" ||
      enrichedChunk.type === "run_error"
    ) {
      log.info("[generate:chunk] emit", summarizeGenerateChunk(enrichedChunk));
    }
    trackSessionRunChunk(sessionId, enrichedChunk);

    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      try {
        win.webContents.send("generate:chunk", enrichedChunk);
      } catch (sendError) {
        log.warn("[generate:chunk] send failed", {
          sessionId,
          windowId: win.id,
          message: sendError instanceof Error ? sendError.message : String(sendError),
        });
      }
    }
  };

  const createDeckProgressEmitter = (sessionId: string) => {
    let normalizedProgress = 0;

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, Math.round(value)));

    const getStageBounds = (stage: string): { min: number; max: number } => {
      if (stage === "preflight" || stage === "planning") {
        return { min: 0, max: 10 };
      }
      if (stage === "rendering") {
        return { min: 10, max: 90 };
      }
      return { min: 0, max: 90 };
    };

    return (chunk: GenerateChunkEvent) => {
      if (chunk.type === "run_completed") {
        normalizedProgress = 100;
        emitGenerateChunk(sessionId, chunk);
        return;
      }

      if (
        chunk.type !== "stage_started" &&
        chunk.type !== "stage_progress" &&
        chunk.type !== "llm_status" &&
        chunk.type !== "page_generated" &&
        chunk.type !== "page_updated"
      ) {
        emitGenerateChunk(sessionId, chunk);
        return;
      }

      const { min, max } = getStageBounds(chunk.payload.stage);
      const rawProgress =
        typeof chunk.payload.progress === "number" && Number.isFinite(chunk.payload.progress)
          ? chunk.payload.progress
          : normalizedProgress;
      const bounded = clamp(rawProgress, min, max);
      normalizedProgress = Math.max(normalizedProgress, bounded);

      emitGenerateChunk(sessionId, {
        ...chunk,
        payload: {
          ...chunk.payload,
          progress: normalizedProgress,
        },
      } as GenerateChunkEvent);
    };
  };

  const resolveStoragePath = async (): Promise<string> => {
    const saved = await db.getSetting<string>("storage_path");
    if (typeof saved === "string" && saved.trim().length > 0) {
      const normalized = saved.trim();
      await db.setStoragePath(normalized);
      return normalized;
    }
    throw new Error("请先前往系统设置选择存储目录。");
  };

  const normalizeSessionId = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const parsePathPayload = (
    payload: unknown,
    preferredKey: "path" | "htmlPath" = "path"
  ): { filePath: string; sessionId?: string; hash?: string } => {
    if (typeof payload === "string") {
      return { filePath: payload.trim() };
    }
    if (!payload || typeof payload !== "object") {
      return { filePath: "" };
    }
    const record = payload as Record<string, unknown>;
    const candidate =
      typeof record[preferredKey] === "string"
        ? String(record[preferredKey])
        : typeof record.path === "string"
          ? String(record.path)
          : typeof record.htmlPath === "string"
            ? String(record.htmlPath)
            : "";
    return {
      filePath: candidate.trim(),
      sessionId: normalizeSessionId(record.sessionId),
      hash: typeof record.hash === "string" ? record.hash : undefined,
    };
  };

  const isPathInside = (targetPath: string, rootPath: string): boolean => {
    const relative = path.relative(rootPath, targetPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const resolveExistingFileRealPath = async (filePath: string): Promise<string> => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`文件不存在: ${absolutePath}`);
    }
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`目标不是文件: ${absolutePath}`);
    }
    return fs.promises.realpath(absolutePath);
  };

  const resolveWritableFileRealPath = async (filePath: string): Promise<string> => {
    const absolutePath = path.resolve(filePath);
    if (fs.existsSync(absolutePath)) {
      const stat = await fs.promises.stat(absolutePath);
      if (!stat.isFile()) {
        throw new Error(`目标不是文件: ${absolutePath}`);
      }
      return fs.promises.realpath(absolutePath);
    }
    const parentDir = path.dirname(absolutePath);
    if (!fs.existsSync(parentDir)) {
      throw new Error(`目标目录不存在: ${parentDir}`);
    }
    const parentRealPath = await fs.promises.realpath(parentDir);
    return path.join(parentRealPath, path.basename(absolutePath));
  };

  const resolveAllowedRoots = async (sessionId?: string): Promise<string[]> => {
    const roots = new Set<string>();
    const storagePath = await resolveStoragePath();
    const storageRoot = fs.existsSync(storagePath)
      ? await fs.promises.realpath(storagePath)
      : path.resolve(storagePath);
    roots.add(storageRoot);

    if (sessionId) {
      const project = await db.getProject(sessionId);
      const outputPath = typeof project?.output_path === "string" ? project.output_path : "";
      if (outputPath) {
        const resolvedOutputPath = fs.existsSync(outputPath)
          ? await fs.promises.realpath(outputPath)
          : path.resolve(outputPath);
        roots.add(resolvedOutputPath);
      }
    }
    return [...roots];
  };

  const assertPathInAllowedRoots = async (args: {
    filePath: string;
    mode: "read" | "write";
    sessionId?: string;
    htmlOnly?: boolean;
  }): Promise<string> => {
    const { filePath, mode, sessionId, htmlOnly } = args;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("文件路径不能为空");
    }
    const extension = path.extname(filePath).toLowerCase();
    if (htmlOnly && extension !== ".html" && extension !== ".htm") {
      throw new Error(`仅允许访问 HTML 文件，当前扩展名: ${extension || "(none)"}`);
    }
    const targetPath =
      mode === "read"
        ? await resolveExistingFileRealPath(filePath)
        : await resolveWritableFileRealPath(filePath);
    const allowedRoots = await resolveAllowedRoots(sessionId);
    const allowed = allowedRoots.some((root) => isPathInside(targetPath, root));
    if (!allowed) {
      throw new Error(`文件路径不在允许目录内: ${targetPath}`);
    }
    return targetPath;
  };

  const encryptApiKey = (apiKey: string): string => {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) return "";
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn("[settings] safeStorage unavailable, fallback to plaintext api key storage");
      return trimmed;
    }
    try {
      const encrypted = safeStorage.encryptString(trimmed).toString("base64");
      return `${ENCRYPTED_API_KEY_PREFIX}${encrypted}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("[settings] api key encrypt failed", { message });
      throw new Error("API Key 加密失败，请检查系统钥匙串状态后重试。");
    }
  };

  const decryptApiKey = (rawValue: unknown): string => {
    if (typeof rawValue !== "string") return "";
    const raw = rawValue.trim();
    if (!raw) return "";
    if (!raw.startsWith(ENCRYPTED_API_KEY_PREFIX)) {
      return raw;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn("[settings] safeStorage unavailable, cannot decrypt encrypted api key");
      return "";
    }
    try {
      const encrypted = raw.slice(ENCRYPTED_API_KEY_PREFIX.length);
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("[settings] api key decrypt failed", { message });
      return "";
    }
  };

  const resolveSessionAssetSourcePath = (fileName: string): string => {
    const baseDir = is.dev
      ? path.join(process.cwd(), "resources")
      : path.join(process.resourcesPath, "app.asar.unpacked", "resources");
    const sourcePath = path.join(baseDir, fileName);
    if (fs.existsSync(sourcePath)) return sourcePath;
    throw new Error(`缺少资源文件 ${fileName}。期望路径: ${sourcePath}`);
  };

  const ensureSessionAssets = async (projectDir: string): Promise<void> => {
    const assetsDir = path.join(projectDir, "assets");
    const imagesDir = path.join(projectDir, "images");
    await fs.promises.mkdir(assetsDir, { recursive: true });
    await fs.promises.mkdir(imagesDir, { recursive: true });
    await Promise.all(
      SESSION_ASSET_FILE_NAMES.map(async (fileName) => {
        const sourcePath = resolveSessionAssetSourcePath(fileName);
        const targetPath = path.join(assetsDir, fileName);
        await fs.promises.copyFile(sourcePath, targetPath);
      })
    );
    log.info("[assets] session assets ready", {
      projectDir,
      assetsDir,
      imagesDir,
      count: SESSION_ASSET_FILE_NAMES.length,
      env: is.dev ? "dev" : "prod",
    });
  };

  const scaffoldProjectFiles = async (args: {
    deckTitle: string;
    indexPath: string;
    pages: Array<{ pageNumber: number; pageId: string; title: string; htmlPath: string }>;
  }): Promise<void> => {
    const { deckTitle, indexPath, pages } = args;
    await Promise.all(
      pages.map((page) =>
        fs.promises.writeFile(
          page.htmlPath,
          buildPageScaffoldHtml({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            title: page.title,
          }),
          "utf-8"
        )
      )
    );
    await fs.promises.writeFile(
      indexPath,
      buildProjectIndexHtml(
        deckTitle,
        pages.map(
          (page): DeckPageFile => ({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            title: page.title,
            htmlPath: path.basename(page.htmlPath),
          })
        )
      ),
      "utf-8"
    );
  };

  type SessionPageFile = {
    pageNumber: number;
    pageId: string;
    title: string;
    htmlPath: string;
  };

  const PRINT_READY_PREFIX = "__PPT_PRINT_READY__";
  const EXPORT_PAGE_READY_TIMEOUT_MS = 4000;
  const EXPORT_CAPTURE_SETTLE_MS = 120;

  const resolveSessionPageFiles = async (sessionId: string): Promise<{
    session: Record<string, unknown>;
    pages: SessionPageFile[];
    projectDir: string;
  }> => {
    const session = await db.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const sessionRecord = session as unknown as Record<string, unknown>;
    const rawMetadata = typeof sessionRecord.metadata === "string" ? String(sessionRecord.metadata).trim() : "";
    const metadata = (() => {
      if (!rawMetadata) return {} as Record<string, unknown>;
      try {
        return JSON.parse(rawMetadata) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    })();

    const project = await db.getProject(sessionId);
    const projectDirCandidate =
      typeof project?.output_path === "string" && project.output_path.trim().length > 0
        ? project.output_path.trim()
        : typeof metadata.indexPath === "string" && metadata.indexPath.trim().length > 0
          ? path.dirname(metadata.indexPath.trim())
          : "";
    const projectDir = projectDirCandidate
      ? path.resolve(projectDirCandidate)
      : path.resolve(await resolveStoragePath(), sessionId);

    const generatedPagesRaw = Array.isArray(metadata.generatedPages)
      ? (metadata.generatedPages as Array<Record<string, unknown>>)
      : [];

    const pagesFromMetadata: SessionPageFile[] = [];
    for (let index = 0; index < generatedPagesRaw.length; index += 1) {
      const row = generatedPagesRaw[index];
      const pageNumberValue = Number(row.pageNumber);
      const pageIdValue = typeof row.pageId === "string" ? row.pageId.trim() : "";
      const inferredFromId = Number(pageIdValue.match(/^page-(\d+)$/i)?.[1] || 0);
      const pageNumber = Number.isFinite(pageNumberValue) && pageNumberValue > 0
        ? Math.floor(pageNumberValue)
        : inferredFromId > 0
          ? inferredFromId
          : index + 1;
      const pageId = pageIdValue || `page-${pageNumber}`;
      const titleRaw = typeof row.title === "string" ? row.title.trim() : "";
      const title = titleRaw || `第 ${pageNumber} 页`;
      const htmlPathRaw = typeof row.htmlPath === "string" ? row.htmlPath.trim() : "";
      const htmlPath = htmlPathRaw
        ? path.isAbsolute(htmlPathRaw)
          ? htmlPathRaw
          : path.resolve(projectDir, htmlPathRaw)
        : path.resolve(projectDir, `${pageId}.html`);
      pagesFromMetadata.push({
        pageNumber,
        pageId,
        title,
        htmlPath,
      });
    }

    const fallbackPages: SessionPageFile[] = [];
    if (pagesFromMetadata.length === 0 && fs.existsSync(projectDir)) {
      const files = await fs.promises.readdir(projectDir);
      for (const fileName of files) {
        const match = fileName.match(/^(page-(\d+))\.html$/i);
        if (!match) continue;
        const pageId = match[1];
        const pageNumber = Number(match[2]) || fallbackPages.length + 1;
        fallbackPages.push({
          pageNumber,
          pageId,
          title: `第 ${pageNumber} 页`,
          htmlPath: path.join(projectDir, fileName),
        });
      }
    }

    const dedupedPages = (pagesFromMetadata.length > 0 ? pagesFromMetadata : fallbackPages)
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .filter((page, index, arr) => arr.findIndex((item) => item.pageId === page.pageId) === index);

    if (dedupedPages.length === 0) {
      throw new Error("暂无可导出的页面，请先完成生成。");
    }

    const missingPages: string[] = [];
    const safePages: SessionPageFile[] = [];
    for (const page of dedupedPages) {
      try {
        const safePath = await assertPathInAllowedRoots({
          filePath: page.htmlPath,
          mode: "read",
          sessionId,
          htmlOnly: true,
        });
        safePages.push({
          ...page,
          htmlPath: safePath,
        });
      } catch {
        missingPages.push(page.pageId);
      }
    }
    if (missingPages.length > 0) {
      throw new Error(`页面文件缺失：${missingPages.join(", ")}`);
    }

    return { session: sessionRecord, pages: safePages, projectDir };
  };

  const waitForPrintReadySignal = async (args: {
    win: BrowserWindow;
    pageId: string;
    timeoutMs: number;
  }): Promise<{ timedOut: boolean; reportedPageId?: string }> => {
    const { win, pageId, timeoutMs } = args;
    return new Promise((resolve) => {
      let done = false;
      let timeoutRef: NodeJS.Timeout | null = null;
      let closedListenerBound = false;

      const finalize = (timedOut: boolean, reportedPageId?: string) => {
        if (done) return;
        done = true;
        if (timeoutRef) clearTimeout(timeoutRef);
        win.webContents.removeListener("console-message", onConsoleMessage);
        if (closedListenerBound) {
          win.removeListener("closed", onClosed);
        }
        resolve({ timedOut, reportedPageId });
      };

      const resolveConsoleMessageText = (...rawArgs: unknown[]): string => {
        if (rawArgs.length >= 3 && typeof rawArgs[2] === "string") {
          return rawArgs[2];
        }
        const firstArg = rawArgs[0] as
          | { message?: unknown; params?: { message?: unknown } }
          | undefined;
        if (firstArg && typeof firstArg === "object") {
          if (typeof firstArg.message === "string") return firstArg.message;
          if (firstArg.params && typeof firstArg.params.message === "string") {
            return firstArg.params.message;
          }
        }
        return "";
      };

      const extractReportedPageId = (message: string): string | null => {
        if (typeof message !== "string") return null;
        const prefixIndex = message.indexOf(PRINT_READY_PREFIX);
        if (prefixIndex < 0) return null;
        const suffix = message.slice(prefixIndex + PRINT_READY_PREFIX.length);
        const colonIndex = suffix.indexOf(":");
        if (colonIndex < 0) return null;
        return suffix.slice(colonIndex + 1).trim() || null;
      };

      const onConsoleMessage = (...rawArgs: unknown[]) => {
        const message = resolveConsoleMessageText(...rawArgs);
        const reported = extractReportedPageId(message);
        if (!reported) return;
        if (reported === pageId || reported === "page-unknown") {
          finalize(false, reported);
        }
      };

      const onClosed = () => {
        finalize(true);
      };

      timeoutRef = setTimeout(() => finalize(true), Math.max(500, timeoutMs));
      win.webContents.on("console-message", onConsoleMessage as (...args: any[]) => void);
      win.on("closed", onClosed);
      closedListenerBound = true;
    });
  };

  const renderPageToPdfBuffer = async (args: {
    page: SessionPageFile;
    timeoutMs: number;
  }): Promise<{ pngBuffer: Buffer; warning?: string }> => {
    const { page, timeoutMs } = args;
    const CAPTURE_WIDTH = 1600;
    const CAPTURE_HEIGHT = 900;
    const win = new BrowserWindow({
      show: false,
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: false,
      },
    });

    try {
      // Ensure no zoom and exact content size for consistent capture
      win.webContents.setZoomFactor(1);
      win.setContentSize(CAPTURE_WIDTH, CAPTURE_HEIGHT);
      const pageUrl = new URL(pathToFileURL(page.htmlPath).toString());
      pageUrl.searchParams.set("fit", "off");
      pageUrl.searchParams.set("print", "1");
      pageUrl.searchParams.set("pageId", page.pageId);
      pageUrl.searchParams.set("printTimeoutMs", String(timeoutMs));
      pageUrl.searchParams.set("_ts", String(Date.now()));

      const readyWaitPromise = waitForPrintReadySignal({
        win,
        pageId: page.pageId,
        timeoutMs,
      });
      await win.loadURL(pageUrl.toString());
      const readyResult = await readyWaitPromise;
      if (readyResult.timedOut) {
        log.warn("[export:pdf] print ready timeout", {
          pageId: page.pageId,
          htmlPath: page.htmlPath,
          timeoutMs,
        });
      }
      await sleep(EXPORT_CAPTURE_SETTLE_MS);
      // Capture with explicit rect to ensure exact 1600x900 coverage
      const image = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT,
      });
      const pngBuffer = image.toPNG();

      return {
        pngBuffer,
        warning: readyResult.timedOut ? `页面 ${page.pageId} 未收到打印就绪信号，已按当前状态导出` : undefined,
      };
    } finally {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
  };

  type GenerateMode = "generate" | "edit";
  type GenerateChatType = "main" | "page";

  type GenerationContext = {
    sessionId: string;
    userMessage: string;
    requestedType?: "deck" | "page";
    effectiveMode: GenerateMode;
    selectedPageId?: string;
    htmlPath?: string;
    selector?: string;
    elementTag?: string;
    elementText?: string;
    session: Awaited<ReturnType<PPTDatabase["getSession"]>>;
    sessionRecord: Record<string, unknown>;
    entry: ReturnType<AgentManager["beginRun"]> extends infer T ? NonNullable<T> : never;
    runId: string;
    styleId: string;
    styleSkill: ReturnType<typeof loadStyleSkill>;
    userProvidedOutlineTitles: string[];
    totalPages: number;
    provider: string;
    apiKey: string;
    model: string;
    providerBaseUrl: string;
    projectId: string;
    messageScope: GenerateChatType;
    messagePageId?: string;
    topic: string;
    deckTitle: string;
  };

  type FinalizeGenerationArgs = {
    context: GenerationContext;
    indexPath: string;
    totalPages: number;
    generatedPages: Array<{
      pageNumber: number;
      title: string;
      pageId: string;
      htmlPath: string;
      html: string;
    }>;
    designContract?: DesignContract;
  };

  const emitAssistantMessage = async (context: GenerationContext, content: string): Promise<void> => {
    if (!content.trim()) return;
    await db.addMessage(context.sessionId, {
      role: "assistant",
      content: content.trim(),
      type: "text",
      chat_scope: context.messageScope,
      page_id: context.messagePageId,
    });
    emitGenerateChunk(context.sessionId, {
      type: "assistant_message",
      payload: {
        runId: context.runId,
        content: content.trim(),
        chatType: context.messageScope,
        pageId: context.messagePageId,
      },
    });
  };

  const resolveGenerationContext = async (
    _event: Electron.IpcMainInvokeEvent,
    payload: unknown
  ): Promise<GenerationContext> => {
    const input = payload as GenerateStartPayload;
    const sessionId = String(input?.sessionId || "").trim();
    const userMessage = typeof input?.userMessage === "string" ? input.userMessage : "";
    const requestedType = input?.type === "page" ? "page" : input?.type === "deck" ? "deck" : undefined;
    const effectiveMode: GenerateMode =
      requestedType === "page"
        ? "edit"
        : "generate";
    const selectedPageId =
      typeof input?.selectedPageId === "string" && input.selectedPageId.trim().length > 0
        ? input.selectedPageId.trim()
        : undefined;
    const htmlPath = typeof input?.htmlPath === "string" ? input.htmlPath : undefined;
    const selector =
      typeof input?.selector === "string" && input.selector.trim().length > 0
        ? input.selector.trim()
        : undefined;
    const elementTag =
      typeof input?.elementTag === "string" && input.elementTag.trim().length > 0
        ? input.elementTag.trim()
        : undefined;
    const elementText =
      typeof input?.elementText === "string" && input.elementText.trim().length > 0
        ? input.elementText.trim()
        : undefined;

    if (!sessionId) {
      throw new Error("sessionId 不能为空");
    }

    log.info("[generate:start] received", {
      sessionId,
      type: requestedType || "legacy",
      mode: effectiveMode,
      chatType: input?.chatType === "page" ? "page" : "main",
      chatPageId: input?.chatPageId || null,
      hasUserMessage: typeof userMessage === "string" && userMessage.trim().length > 0,
      selectedPageId: selectedPageId || null,
      selector: selector || null,
      elementTag: elementTag || null,
      elementText: elementText || null,
    });

    const session = await db.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    const sessionRecord = session as unknown as Record<string, unknown>;
    const styleCatalog = listStyleCatalog();
    const defaultStyleId = styleCatalog.find((item) => item.styleKey === "minimal-white")?.id ?? styleCatalog[0]?.id ?? "";
    const styleIdRaw = typeof sessionRecord.styleId === "string" ? String(sessionRecord.styleId).trim() : "";
    const styleId = styleIdRaw || defaultStyleId;
    if (!styleId) {
      throw new Error("未找到可用风格，请先在风格管理中创建或导入风格。");
    }
    if (!hasStyleSkill(styleId)) {
      throw new Error(`styleId 不存在或不可用：${styleId}`);
    }
    const styleDetail = getStyleDetail(styleId);

    const existingProject = await db.getProject(sessionId);
    const storagePath = await resolveStoragePath();
    const projectDir = existingProject?.output_path || path.join(storagePath, sessionId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    await ensureSessionAssets(projectDir);

    const provider = String(sessionRecord.provider || "openai");
    const settings = await db.getAllSettings();
    const ensuredModel = String(sessionRecord.model || settings[`model_${provider}`] || "").trim();
    if (!ensuredModel) {
      throw new Error("请先前往系统设置填写 model。");
    }

    agentManager.ensureSession({
      sessionId,
      provider,
      model: ensuredModel,
      projectDir,
    });

    const entry = agentManager.beginRun(sessionId);
    if (!entry) throw new Error("Session not found");

    const runId = crypto.randomUUID();
    const styleSkill = loadStyleSkill(styleId);
    const userProvidedOutlineTitles = extractOutlineTitles(userMessage);
    const totalPages = Number(sessionRecord.page_count ?? sessionRecord.pageCount);

    const apiKey = decryptApiKey(settings[`api_key_${provider}`]).trim();
    const model = ensuredModel;
    const providerBaseUrl = String(settings[`base_url_${provider}`] || "").trim();
    const projectId =
      existingProject?.id ??
      (await db.createProject({
        session_id: sessionId,
        title: String(sessionRecord.title || "Untitled"),
        output_path: entry.projectDir,
      }));

    const normalizedChatType: GenerateChatType = input?.chatType === "page" ? "page" : "main";
    const normalizedChatPageId =
      normalizedChatType === "page"
        ? typeof input?.chatPageId === "string" && input.chatPageId.trim().length > 0
          ? input.chatPageId.trim()
          : selectedPageId
        : undefined;
    if (normalizedChatType === "page" && !normalizedChatPageId) {
      throw new Error("chatType=page requires chatPageId or selectedPageId");
    }

    await db.addMessage(sessionId, {
      role: "user",
      content: userMessage,
      type: "text",
      chat_scope: normalizedChatType,
      page_id: normalizedChatType === "page" ? normalizedChatPageId : undefined,
      selector: normalizedChatType === "page" ? selector : undefined,
    });
    await db.updateSessionStatus(sessionId, "active");

    const topic = String(sessionRecord.topic || "当前主题");
    const deckTitle = String(sessionRecord.title || "OpenPPT Preview");

    log.info("[generate:start] run initialized", {
      sessionId,
      projectDir: entry.projectDir,
      mode: effectiveMode,
      styleId,
      styleKey: styleDetail.styleKey,
      styleLabel: styleDetail.label,
    });

    return {
      sessionId,
      userMessage,
      requestedType,
      effectiveMode,
      selectedPageId,
      htmlPath,
      selector,
      elementTag,
      elementText,
      session,
      sessionRecord,
      entry,
      runId,
      styleId,
      styleSkill,
      userProvidedOutlineTitles,
      totalPages,
      provider,
      apiKey,
      model,
      providerBaseUrl,
      projectId,
      messageScope: normalizedChatType,
      messagePageId: normalizedChatType === "page" ? normalizedChatPageId : undefined,
      topic,
      deckTitle,
    };
  };

  const finalizeGenerationSuccess = async (args: FinalizeGenerationArgs): Promise<void> => {
    const { context, indexPath, totalPages, generatedPages } = args;
    await db.updateSessionMetadata(context.sessionId, {
      lastRunId: context.runId,
      entryMode: "multi_page",
      generatedPages: generatedPages.map((page) => ({
        pageNumber: page.pageNumber,
        title: page.title,
        pageId: page.pageId,
        htmlPath: page.htmlPath,
        html: page.html,
      })),
      indexPath,
      projectId: context.projectId,
    });
    if (args.designContract) {
      await db.updateSessionDesignContract(context.sessionId, args.designContract);
    }
    await db.updateProjectStatus(context.projectId, "draft");
    await db.updateSessionStatus(context.sessionId, "completed");
    log.info("[generate:start] completed", {
      sessionId: context.sessionId,
      styleId: context.styleId,
      totalPages,
    });
    emitGenerateChunk(context.sessionId, {
      type: "run_completed",
      payload: {
        runId: context.runId,
        totalPages,
      },
    });
  };

  const finalizeGenerationFailure = async (context: GenerationContext, error: unknown): Promise<void> => {
    const message = error instanceof Error && error.message.length > 0 ? error.message : "Generation failed";
    log.error("[generate:start] failed", {
      sessionId: context.sessionId,
      styleId: context.styleId,
      message,
    });
    await db.updateSessionStatus(context.sessionId, "failed");
    await db.addMessage(context.sessionId, {
      role: "system",
      content: message,
      type: "stream_chunk",
      chat_scope: context.messageScope,
      page_id: context.messagePageId,
    });
    emitGenerateChunk(context.sessionId, {
      type: "run_error",
      payload: { runId: context.runId, message },
    });
  };

  const executeEditGeneration = async (context: GenerationContext): Promise<void> => {
    if (!context.apiKey) {
      throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`);
    }

    const indexPath = context.htmlPath
      ? path.join(path.dirname(context.htmlPath), "index.html")
      : path.join(context.entry.projectDir, "index.html");
    const isMainScopeEdit = context.messageScope === "main";
    const pageIdFromPath = typeof context.htmlPath === "string"
      ? path.basename(context.htmlPath).match(/^(page-\d+)\.html$/i)?.[1]
      : undefined;
    let resolvedSelectedPageId = isMainScopeEdit ? undefined : (context.selectedPageId || pageIdFromPath);
    const selectedSelector = isMainScopeEdit ? undefined : context.selector;

    let outlineTitles: string[] = context.userProvidedOutlineTitles;
    let pageRefs: Array<{ pageNumber: number; title: string; pageId: string; htmlPath: string }> = [];
    let savedDesignContract: DesignContract | undefined;
    if (context.session?.metadata) {
      try {
        const metadata = JSON.parse(context.session.metadata) as {
          generatedPages?: Array<{ pageNumber: number; title: string; pageId?: string; htmlPath?: string }>;
        };
        if (outlineTitles.length === 0) {
          outlineTitles = (metadata.generatedPages || []).map((p) => p.title);
        }
        pageRefs = (metadata.generatedPages || []).map((p, index) => {
          const pageId = p.pageId || `page-${p.pageNumber || index + 1}`;
          return {
            pageNumber: p.pageNumber || index + 1,
            title: p.title || `第${index + 1}页`,
            pageId,
            htmlPath: p.htmlPath || path.join(context.entry.projectDir, `${pageId}.html`),
          };
        });
      } catch {
        // ignore malformed metadata
      }
    }
    // Read designContract from the dedicated column
    const sessionRecord = (context.session || {}) as Record<string, unknown>;
    if (typeof sessionRecord.designContract === "string" && sessionRecord.designContract.trim().length > 0) {
      try {
        savedDesignContract = JSON.parse(sessionRecord.designContract) as DesignContract;
      } catch { /* ignore */ }
    }
    if (outlineTitles.length === 0) {
      outlineTitles = Array.from({ length: context.totalPages }, (_unused, i) => `第${i + 1}页`);
    }
    if (pageRefs.length === 0) {
      const diskPageIds = fs.existsSync(context.entry.projectDir)
        ? fs.readdirSync(context.entry.projectDir)
          .map((name) => name.match(/^(page-(\d+))\.html$/i))
          .filter((m): m is RegExpMatchArray => Boolean(m))
          .sort((a, b) => Number(a[2]) - Number(b[2]))
          .map((m) => m[1])
        : [];
      const ids =
        diskPageIds.length > 0
          ? diskPageIds
          : outlineTitles.map((_title, i) => `page-${i + 1}`);
      pageRefs = ids.map((pid, index) => ({
        pageNumber: Number(pid.match(/^page-(\d+)$/i)?.[1] || index + 1),
        title: outlineTitles[index] || `第${index + 1}页`,
        pageId: pid,
        htmlPath: path.join(context.entry.projectDir, `${pid}.html`),
      }));
    }
    if (!isMainScopeEdit && resolvedSelectedPageId && !pageRefs.some((ref) => ref.pageId === resolvedSelectedPageId)) {
      const inferredNumber = Number(resolvedSelectedPageId.match(/^page-(\d+)$/i)?.[1] || pageRefs.length + 1);
      pageRefs.push({
        pageNumber: inferredNumber,
        title: outlineTitles[inferredNumber - 1] || `第${inferredNumber}页`,
        pageId: resolvedSelectedPageId,
        htmlPath: path.join(context.entry.projectDir, `${resolvedSelectedPageId}.html`),
      });
    }
    pageRefs.sort((a, b) => a.pageNumber - b.pageNumber);
    if (!isMainScopeEdit && !resolvedSelectedPageId && pageRefs.length > 0) {
      resolvedSelectedPageId = pageRefs[0].pageId;
    }
    const resolvedSelectedPageNumber = !isMainScopeEdit
      ? Number(resolvedSelectedPageId?.match(/^page-(\d+)$/i)?.[1] || 0) ||
        pageRefs.find((ref) => ref.pageId === resolvedSelectedPageId)?.pageNumber ||
        undefined
      : undefined;
    if (outlineTitles.length !== pageRefs.length) {
      outlineTitles = pageRefs.map((ref) => ref.title);
    }

    const outlineItems = outlineTitles.map((title) => ({ title, contentOutline: "" }));
    const pageFileMap = Object.fromEntries(pageRefs.map((p) => [p.pageId, p.htmlPath]));
    const beforeMap = new Map<string, string>();
    const existingPageIdsBeforeRun: string[] = [];
    const beforeReads = await Promise.all(
      pageRefs.map(async (ref) => {
        if (!fs.existsSync(ref.htmlPath)) return null;
        const html = await fs.promises.readFile(ref.htmlPath, "utf-8");
        return { pageId: ref.pageId, html };
      })
    );
    for (const item of beforeReads) {
      if (!item) continue;
      existingPageIdsBeforeRun.push(item.pageId);
      beforeMap.set(item.pageId, item.html);
    }

    emitGenerateChunk(context.sessionId, {
      type: "stage_started",
      payload: {
        runId: context.runId,
        stage: "editing",
        label: "正在理解你的修改意图",
        progress: 10,
        totalPages: outlineTitles.length,
      },
    });

    await emitAssistantMessage(
      context,
      isMainScopeEdit
        ? `我准备开始调整「${context.topic}」了。目标：主会话总览壳（index.html），我只会修改切换演示动画与交互层动画。`
        : `我准备开始调整「${context.topic}」了。目标：${resolvedSelectedPageId ? `第 ${resolvedSelectedPageNumber ?? "?"} 页` : "按你的指令智能定位"}${selectedSelector ? `（选择器：${selectedSelector}）` : ""}。`
    );

    const beforeIndexHtml = fs.existsSync(indexPath)
      ? await fs.promises.readFile(indexPath, "utf-8")
      : "";

    const editSummaryFromEngine = await runDeepAgentEdit({
      sessionId: context.sessionId,
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      styleId: context.styleId,
      styleSkillPrompt: context.styleSkill.prompt,
      topic: context.topic,
      deckTitle: context.deckTitle,
      userMessage: context.userMessage,
      outlineTitles,
      outlineItems,
      projectDir: context.entry.projectDir,
      indexPath,
      pageFileMap,
      designContract: savedDesignContract,
      editScope: isMainScopeEdit ? "main" : "page",
      selectedPageId: resolvedSelectedPageId,
      selectedPageNumber: resolvedSelectedPageNumber,
      selectedSelector,
      elementTag: context.elementTag,
      elementText: context.elementText,
      existingPageIds: existingPageIdsBeforeRun,
      agentManager,
      emit: (chunk) => emitGenerateChunk(context.sessionId, chunk),
      runId: context.runId,
      signal: context.entry.abortController.signal,
    });
    const afterIndexHtml = fs.existsSync(indexPath)
      ? await fs.promises.readFile(indexPath, "utf-8")
      : "";
    const indexChanged = beforeIndexHtml !== afterIndexHtml;

    const pageDescriptors: Array<{ pageNumber: number; title: string; pageId: string; html: string; htmlPath: string }> = [];
    const changedPageDescriptors: Array<{ pageNumber: number; title: string; pageId: string; html: string; htmlPath: string }> = [];
    const editedPageReads = await Promise.all(
      pageRefs.map(async (ref) => {
        if (!fs.existsSync(ref.htmlPath)) return null;
        const html = await fs.promises.readFile(ref.htmlPath, "utf-8");
        return { ref, html };
      })
    );
    for (const item of editedPageReads) {
      if (!item) continue;
      const { ref, html } = item;
      const page: GeneratedPagePayload = {
        pageNumber: ref.pageNumber,
        title: ref.title,
        html,
        pageId: ref.pageId,
        htmlPath: ref.htmlPath,
        sourceUrl: getPageSourceUrl(ref.htmlPath),
      };
      pageDescriptors.push({
        pageNumber: ref.pageNumber,
        title: ref.title,
        pageId: ref.pageId,
        html,
        htmlPath: ref.htmlPath,
      });
      const isExisting = existingPageIdsBeforeRun.includes(ref.pageId);
      const changed = beforeMap.get(ref.pageId) !== html;
      if (!changed && isExisting) continue;
      changedPageDescriptors.push({
        pageNumber: ref.pageNumber,
        title: ref.title,
        pageId: ref.pageId,
        html,
        htmlPath: ref.htmlPath,
      });
      emitGenerateChunk(context.sessionId, {
        type: isExisting ? "page_updated" : "page_generated",
        payload: {
          runId: context.runId,
          stage: "editing",
          label: isExisting ? `第 ${page.pageNumber} 页已更新` : `第 ${page.pageNumber} 页已创建`,
          progress: 90,
          currentPage: page.pageNumber,
          totalPages: pageRefs.length,
          ...page,
        },
      });
    }

    const changedPages = changedPageDescriptors.map((p) => `第${p.pageNumber}页`).join("、");
    const editSummary =
      changedPageDescriptors.length > 0
        ? `修改完成：${changedPages}${selectedSelector ? `（目标选择器：${selectedSelector}）` : ""}。`
        : indexChanged
          ? "修改完成：已更新 index.html 总览壳交互。"
        : editSummaryFromEngine.trim() || "我已经检查过了，这次没有检测到需要落盘的页面变化。";
    await emitAssistantMessage(context, editSummary);

    await finalizeGenerationSuccess({
      context,
      indexPath,
      totalPages: pageRefs.length,
      generatedPages: pageDescriptors,
    });
  };

  const executeDeckGeneration = async (context: GenerationContext): Promise<void> => {
    if (!context.apiKey) {
      throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`);
    }

    const emitDeckChunk = createDeckProgressEmitter(context.sessionId);

    emitDeckChunk({
      type: "stage_started",
      payload: {
        runId: context.runId,
        stage: "preflight",
        label: "正在理解你的创意目标",
        progress: 2,
        totalPages: context.totalPages,
      },
    });
    await db.addMessage(context.sessionId, {
      role: "system",
      content: "正在梳理需求并准备生成画布。",
      type: "stream_chunk",
      chat_scope: context.messageScope,
      page_id: context.messagePageId,
    });
    await sleep(120, context.entry.abortController.signal);

    const pageRefs = Array.from({ length: context.totalPages }, (_unused, index) => {
      const pageNumber = index + 1;
      const pageId = `page-${pageNumber}`;
      const htmlPath = path.join(context.entry.projectDir, `${pageId}.html`);
      const fallbackTitle = context.userProvidedOutlineTitles[index] || `第 ${pageNumber} 页`;
      return { pageNumber, title: fallbackTitle, pageId, htmlPath };
    });
    const pageFileMap = Object.fromEntries(pageRefs.map((page) => [page.pageId, page.htmlPath]));
    const indexPath = path.join(context.entry.projectDir, "index.html");

    emitDeckChunk({
      type: "stage_progress",
      payload: {
        runId: context.runId,
        stage: "planning",
        label: "正在梳理演示结构",
        progress: 6,
        totalPages: context.totalPages,
      },
    });
    const scaffoldPromise = scaffoldProjectFiles({
      deckTitle: context.deckTitle,
      indexPath,
      pages: pageRefs,
    }).then(() => {
      emitDeckChunk({
        type: "llm_status",
        payload: {
          runId: context.runId,
          stage: "preflight",
          label: "本地画布已就绪",
          progress: 4,
          totalPages: pageRefs.length,
          detail: `已创建 index.html 与 ${pageRefs.length} 个页面骨架`,
        },
      });
    });

    const plannerPromise = planDeckWithLLM({
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      styleId: context.styleId,
      totalPages: pageRefs.length,
      topic: context.topic,
      userMessage: context.userMessage,
      emit: (chunk) => emitDeckChunk(chunk),
      runId: context.runId,
      signal: context.entry.abortController.signal,
    });
    const designContractPromise = sleep(500, context.entry.abortController.signal).then(() =>
      buildDesignContractWithLLM({
        provider: context.provider,
        apiKey: context.apiKey,
        model: context.model,
        baseUrl: context.providerBaseUrl,
        styleId: context.styleId,
        styleSkillPrompt: context.styleSkill.prompt,
        totalPages: context.totalPages,
        emit: (chunk) => emitDeckChunk(chunk),
        runId: context.runId,
        signal: context.entry.abortController.signal,
      })
    );
    const [plannedOutlineItems, designContract] = await Promise.all([
      plannerPromise,
      designContractPromise,
      scaffoldPromise,
    ]);
    const outlineItems = pageRefs.map((page, index) => {
      const planned = plannedOutlineItems[index];
      return {
        title: planned?.title?.trim() || page.title,
        contentOutline: planned?.contentOutline?.trim() || "",
      };
    });
    const outlineTitles = outlineItems.map((item) => item.title);
    for (const page of pageRefs) {
      page.title = outlineTitles[page.pageNumber - 1] || page.title;
    }

    await fs.promises.writeFile(
      indexPath,
      buildProjectIndexHtml(
        context.deckTitle,
        pageRefs.map(
          (page): DeckPageFile => ({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            title: page.title,
            htmlPath: path.basename(page.htmlPath),
          })
        )
      ),
      "utf-8"
    );
    emitDeckChunk({
      type: "llm_status",
      payload: {
        runId: context.runId,
        stage: "preflight",
        label: "结构规划完成，开始填充内容",
        progress: 10,
        totalPages: pageRefs.length,
        detail: `已完成规划并更新目录标题，设计契约：${designContract.theme}`,
      },
    });

    await emitAssistantMessage(
      context,
      `已为「${context.topic}」规划 ${outlineItems.length} 页内容，风格为「${context.styleSkill.preset.label}」。接下来我会逐页完善并实时同步进度。`
    );
    await sleep(120, context.entry.abortController.signal);

    const beforePageMap = new Map<string, string>();
    const beforePageResults = await Promise.all(
      pageRefs.map(async (page) => ({
        pageId: page.pageId,
        html: await fs.promises.readFile(page.htmlPath, "utf-8"),
      }))
    );
    for (const item of beforePageResults) {
      beforePageMap.set(item.pageId, item.html);
    }

    const { failedPages } = await runDeepAgentDeckGeneration({
      sessionId: context.sessionId,
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      styleId: context.styleId,
      styleSkillPrompt: context.styleSkill.prompt,
      topic: context.topic,
      deckTitle: context.deckTitle,
      userMessage: context.userMessage,
      outlineTitles,
      outlineItems,
      designContract,
      projectDir: context.entry.projectDir,
      indexPath,
      pageFileMap,
      agentManager,
      emit: (chunk) => emitDeckChunk(chunk),
      runId: context.runId,
      signal: context.entry.abortController.signal,
    });

    const failedPageIdSet = new Set(failedPages.map((item) => item.pageId));
    const postValidationErrors: string[] = [];
    const postValidationFailures: Array<{ pageId: string; title: string; reason: string }> = [];
    if (!fs.existsSync(indexPath)) {
      postValidationErrors.push("index.html 缺失");
    } else {
      const indexHtml = await fs.promises.readFile(indexPath, "utf-8");
      if (!/<html[\s>]/i.test(indexHtml)) postValidationErrors.push("index.html 缺少 <html> 标签");
      if (!/<iframe[\s>]/i.test(indexHtml)) postValidationErrors.push("index.html 缺少 iframe 预览壳");
    }
    const validationPages = await Promise.all(
      pageRefs.map(async (page) => {
        if (!fs.existsSync(page.htmlPath)) {
          return { pageId: page.pageId, missing: true, html: "" };
        }
        const html = await fs.promises.readFile(page.htmlPath, "utf-8");
        return { pageId: page.pageId, missing: false, html };
      })
    );
    for (const item of validationPages) {
      if (item.missing) {
        postValidationErrors.push(`${item.pageId}.html 缺失`);
        continue;
      }
      if (!/<html[\s>]/i.test(item.html)) postValidationErrors.push(`${item.pageId}.html 缺少 <html>`);
      if (!failedPageIdSet.has(item.pageId)) {
        const pageRef = pageRefs.find((page) => page.pageId === item.pageId);
        const validation = validatePersistedPageHtml(item.html, item.pageId);
        if (!validation.valid) {
          const reason = validation.errors.join("; ");
          postValidationErrors.push(`${item.pageId}.html ${reason}`);
          postValidationFailures.push({
            pageId: item.pageId,
            title: pageRef?.title || item.pageId,
            reason,
          });
        }
      }
    }
    for (const failure of postValidationFailures) {
      failedPageIdSet.add(failure.pageId);
      failedPages.push(failure);
    }
    emitDeckChunk({
      type: "llm_status",
      payload: {
        runId: context.runId,
        stage: "rendering",
        label: postValidationErrors.length > 0 ? "我发现了几个结构提醒" : "页面结构检查通过",
        progress: 90,
        totalPages: outlineTitles.length,
        detail:
          postValidationErrors.length > 0
            ? postValidationErrors.join("; ")
            : `全部 ${pageRefs.length} 个页面文件都已准备完成`,
      },
    });

    const placeholderPages: string[] = [];
    const pageDescriptors: Array<{ pageNumber: number; title: string; pageId: string; htmlPath: string; html: string }> = [];
    const generatedPageReads = await Promise.all(
      pageRefs.map(async (pageRef) => {
        if (!fs.existsSync(pageRef.htmlPath)) return null;
        const html = await fs.promises.readFile(pageRef.htmlPath, "utf-8");
        return { pageRef, html };
      })
    );
    for (const item of generatedPageReads) {
      if (!item) continue;
      const { pageRef, html } = item;
      if (failedPageIdSet.has(pageRef.pageId)) {
        continue;
      }
      if (html.includes("等待模型填充这一页内容")) {
        placeholderPages.push(pageRef.pageId);
      }
      const page: GeneratedPagePayload = {
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        html,
        pageId: pageRef.pageId,
        htmlPath: pageRef.htmlPath,
        sourceUrl: getPageSourceUrl(pageRef.htmlPath),
      };
      pageDescriptors.push({
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        pageId: pageRef.pageId,
        htmlPath: pageRef.htmlPath,
        html,
      });
      emitDeckChunk({
        type: "page_generated",
        payload: {
          runId: context.runId,
          stage: "rendering",
          label: `第 ${page.pageNumber} 页已生成`,
          progress: 10 + Math.round((page.pageNumber / Math.max(pageRefs.length, 1)) * 80),
          currentPage: page.pageNumber,
          totalPages: pageRefs.length,
          ...page,
        },
      });
      const changed = beforePageMap.get(pageRef.pageId) !== html;
      await db.addMessage(context.sessionId, {
        role: "tool",
        content: `${changed ? "已更新" : "已确认"} ${page.pageId}: ${page.title}`,
        type: "tool_result",
        tool_name: "update_page_file",
        tool_call_id: context.runId,
        chat_scope: context.messageScope,
        page_id: context.messagePageId,
      });
    }

    if (placeholderPages.length > 0) {
      emitDeckChunk({
        type: "llm_status",
        payload: {
          runId: context.runId,
          stage: "rendering",
          label: "我还想再优化几页内容",
          progress: 90,
          totalPages: outlineTitles.length,
          detail: `以下页面可能仍是占位内容：${placeholderPages.join(", ")}`,
        },
      });
    }

    if (failedPages.length > 0) {
      const failedDetails = failedPages.map((item) => `${item.pageId}（${item.title}）：${item.reason}`).join("；");
      emitDeckChunk({
        type: "llm_status",
        payload: {
          runId: context.runId,
          stage: "rendering",
          label: "有几页暂时没长好",
          progress: 90,
          totalPages: outlineTitles.length,
          detail: `本次已完成 ${pageDescriptors.length}/${pageRefs.length} 页，失败页面：${failedDetails}`,
        },
      });
      throw new Error(
        `部分页面生成失败（${failedPages.length}/${pageRefs.length}）：${failedPages
          .map((item) => `${item.pageId}(${item.title})`)
          .join(", ")}`
      );
    }

    const completionSummary =
      placeholderPages.length > 0
        ? `你的创意已经生成完成！当前共 ${pageDescriptors.length} 页，主题「${context.topic}」。其中 ${placeholderPages.length} 页还可以继续优化，你可以继续让我精修。`
        : `你的创意已经生成完成！共 ${pageDescriptors.length} 页，主题「${context.topic}」。你可以继续在“当前页”精修细节，或在“主会话”调整全局切换动画。`;
    await emitAssistantMessage(context, completionSummary);

    await finalizeGenerationSuccess({
      context,
      indexPath,
      totalPages: outlineTitles.length,
      generatedPages: pageDescriptors,
      designContract,
    });
  };

  const executeGeneration = async (context: GenerationContext): Promise<void> => {
    if (context.effectiveMode === "edit") {
      await executeEditGeneration(context);
      return;
    }
    await executeDeckGeneration(context);
  };

  // ========== Session Management ==========

  ipcMain.handle("session:create", async (_event, payload) => {
    const { topic, styleId, pageCount, provider, apiKey, model, baseUrl } = payload;
    const storagePath = await resolveStoragePath();
    const sessionId = crypto.randomUUID();
    const projectDir = path.join(storagePath, sessionId);

    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    await ensureSessionAssets(projectDir);

    const normalizedStyleId = typeof styleId === "string" ? styleId.trim() : "";
    if (!normalizedStyleId) {
      throw new Error("创建会话失败：styleId 不能为空。");
    }
    if (!hasStyleSkill(normalizedStyleId)) {
      throw new Error(`创建会话失败：styleId 不存在 ${normalizedStyleId}`);
    }
    const styleDetail = getStyleDetail(normalizedStyleId);
    log.info("[session:create] style selected", {
      sessionId,
      styleId: normalizedStyleId,
      styleKey: styleDetail.styleKey,
      styleLabel: styleDetail.label,
    });

    await agentManager.createSession({
      sessionId,
      provider, apiKey, model, baseUrl, projectDir, db, topic, styleId: normalizedStyleId, pageCount,
    });

    return { sessionId };
  });

  ipcMain.handle("session:list", async () => {
    const sessions = await db.listSessions();
    return sessions.map((session) => normalizeSession(session as unknown as Record<string, unknown>));
  });

  ipcMain.handle("session:get", async (_event, sessionId) => {
    const session = await db.getSession(sessionId);
    const messages = await db.getSessionMessages(sessionId, { chatScope: "main" });
    const generatedPages: Array<{
      pageNumber: number;
      title: string;
      html: string;
      htmlPath?: string;
      pageId?: string;
      sourceUrl?: string;
    }> = [];

    if (session?.metadata) {
      try {
        const metadata = JSON.parse(session.metadata) as {
          entryMode?: "single_index" | "multi_page";
          indexPath?: string;
          generatedPages?: Array<{
            pageNumber: number;
            title: string;
            pageId?: string;
            htmlPath?: string;
            html?: string;
          }>;
        };

        if (metadata.entryMode === "multi_page") {
          const indexPath = metadata.indexPath || "";
          const restoredPages = await Promise.all(
            (metadata.generatedPages || []).map(async (page) => {
              const pageId = page.pageId || `page-${page.pageNumber}`;
              const pagePath = page.htmlPath || path.join(path.dirname(indexPath), `${pageId}.html`);
              if (!fs.existsSync(pagePath)) return null;
              const html = await fs.promises.readFile(pagePath, "utf-8");
              return {
                pageNumber: page.pageNumber,
                title: page.title,
                html,
                htmlPath: pagePath,
                pageId,
                sourceUrl: getPageSourceUrl(pagePath),
              };
            })
          );
          for (const page of restoredPages) {
            if (page) generatedPages.push(page);
          }
        } else if (metadata.entryMode === "single_index" && metadata.indexPath && fs.existsSync(metadata.indexPath)) {
          const resolvedIndexPath = metadata.indexPath;
          const indexHtml = await fs.promises.readFile(resolvedIndexPath, "utf-8");
          const baseUrl = pathToFileURL(resolvedIndexPath).toString();
          const parsedPages = extractPagesDataFromIndex(indexHtml);
          const parsedById = new Map(parsedPages.map((item) => [item.pageId, item]));
          const restoredPages = await Promise.all(
            (metadata.generatedPages || []).map(async (page) => {
              const pageId = page.pageId || `page-${page.pageNumber}`;
              const parsed = parsedById.get(pageId);
              const pagePath =
                page.htmlPath ||
                (typeof parsed?.htmlPath === "string"
                  ? path.resolve(path.dirname(resolvedIndexPath), parsed.htmlPath)
                  : resolvedIndexPath);
              const html =
                pagePath && pagePath !== resolvedIndexPath && fs.existsSync(pagePath)
                  ? await fs.promises.readFile(pagePath, "utf-8")
                  : page.html || parsed?.html || indexHtml;
              return {
                pageNumber: page.pageNumber,
                title: page.title,
                html,
                htmlPath: pagePath,
                pageId,
                sourceUrl: `${baseUrl}?embed=1#${encodeURIComponent(pageId)}`,
              };
            })
          );
          generatedPages.push(...restoredPages);
        } else {
          const restoredPages = await Promise.all(
            (metadata.generatedPages || []).map(async (page) => {
              if (!page.htmlPath || !fs.existsSync(page.htmlPath)) return null;
              const html = await fs.promises.readFile(page.htmlPath, "utf-8");
              return {
                pageNumber: page.pageNumber,
                title: page.title,
                html,
                htmlPath: page.htmlPath,
                pageId: page.pageId || `page-${page.pageNumber}`,
                sourceUrl: getPageSourceUrl(page.htmlPath),
              };
            })
          );
          for (const page of restoredPages) {
            if (page) generatedPages.push(page);
          }
        }
      } catch {
        // Ignore malformed metadata and let the session open without restored pages.
      }
    }

    return {
      session: normalizeSession(session as unknown as Record<string, unknown> | undefined),
      messages: messages.map((message) => normalizeMessage(message as unknown as Record<string, unknown>)),
      generatedPages,
    };
  });

  ipcMain.handle(
    "session:getMessages",
    async (_event, payload: { sessionId: string; chatType?: "main" | "page"; pageId?: string }) => {
      const chatType = payload?.chatType === "page" ? "page" : "main";
      const pageId =
        chatType === "page" && typeof payload?.pageId === "string" && payload.pageId.trim().length > 0
          ? payload.pageId.trim()
          : undefined;
      const messages = await db.getSessionMessages(payload.sessionId, { chatScope: chatType, pageId });
      return messages.map((message) => normalizeMessage(message as unknown as Record<string, unknown>));
    }
  );

  ipcMain.handle("session:delete", async (_event, sessionId) => {
    await db.deleteSession(sessionId);
    return { success: true };
  });

  // ========== Generation Flow ==========

  ipcMain.handle("generate:state", async (_event, rawSessionId: unknown) => {
    const sessionId = typeof rawSessionId === "string" ? rawSessionId.trim() : "";
    if (!sessionId) {
      throw new Error("sessionId 不能为空");
    }

    const activeState = sessionRunStates.get(sessionId);
    if (activeState) {
      return {
        sessionId,
        runId: activeState.runId,
        status: activeState.status,
        hasActiveRun: activeState.status === "running",
        progress: activeState.progress,
        totalPages: activeState.totalPages,
        events: activeState.events,
        error: activeState.error,
        startedAt: activeState.startedAt,
        updatedAt: activeState.updatedAt,
      };
    }

    const session = await db.getSession(sessionId);
    const sessionRecord = (session || {}) as Record<string, unknown>;
    const sessionStatus = String(sessionRecord.status || "active");
    const normalizedStatus =
      sessionStatus === "completed"
        ? "completed"
        : sessionStatus === "failed"
          ? "failed"
          : "idle";
    const pageCount = Number(sessionRecord.page_count ?? sessionRecord.pageCount ?? 1) || 1;
    return {
      sessionId,
      runId: null,
      status: normalizedStatus,
      hasActiveRun: false,
      progress: normalizedStatus === "completed" ? 100 : 0,
      totalPages: Math.max(1, Math.floor(pageCount)),
      events: [],
      error: null,
      startedAt: null,
      updatedAt: null,
    };
  });

  ipcMain.handle("generate:start", async (event, payload) => {
    const requestedSessionId =
      payload && typeof payload === "object" && typeof (payload as { sessionId?: unknown }).sessionId === "string"
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : "";
    if (requestedSessionId) {
      const runningState = sessionRunStates.get(requestedSessionId);
      if (runningState?.status === "running") {
        log.info("[generate:start] attach to existing run", {
          sessionId: requestedSessionId,
          runId: runningState.runId,
        });
        return { success: true, runId: runningState.runId, alreadyRunning: true };
      }
    }

    let context: GenerationContext | null = null;
    try {
      context = await resolveGenerationContext(event, payload);
      beginSessionRunState({
        sessionId: context.sessionId,
        runId: context.runId,
        mode: context.effectiveMode,
        totalPages: context.totalPages,
      });
      await executeGeneration(context);
      return { success: true, runId: context.runId };
    } catch (error) {
      if (context) {
        await finalizeGenerationFailure(context, error);
      }
      throw error;
    } finally {
      if (context) {
        agentManager.removeSession(context.sessionId);
      }
    }
  });

  ipcMain.handle("generate:cancel", async (_event, sessionId) => {
    agentManager.cancelSession(sessionId);
    const activeState = sessionRunStates.get(sessionId);
    if (activeState?.status === "running") {
      emitGenerateChunk(sessionId, {
        type: "run_error",
        payload: {
          runId: activeState.runId,
          message: "生成已取消",
        },
      });
    }
    await db.updateSessionStatus(sessionId, "failed");
    return { success: true };
  });

  // ========== Export ==========

  ipcMain.handle("export:pdf", async (event, payload: unknown) => {
    const sessionId =
      payload && typeof payload === "object" && typeof (payload as { sessionId?: unknown }).sessionId === "string"
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : typeof payload === "string"
          ? payload.trim()
          : "";
    if (!sessionId) {
      throw new Error("sessionId 不能为空");
    }

    const { session, pages, projectDir } = await resolveSessionPageFiles(sessionId);
    const sessionTitle = typeof session.title === "string" && session.title.trim().length > 0
      ? session.title.trim()
      : `ohmyppt-${sessionId}`;
    const sanitizedBaseName = sessionTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || `ohmyppt-${sessionId}`;

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      mainWindow;
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: "导出 PDF",
      defaultPath: path.join(projectDir, `${sanitizedBaseName}.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true };
    }

    const warnings: string[] = [];
    try {
      const mergedPdf = await PDFDocument.create();
      const pdfPageWidth = 16 * 72;
      const pdfPageHeight = 9 * 72;

      for (const page of pages) {
        log.info("[export:pdf] render page", {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath,
        });
        const rendered = await renderPageToPdfBuffer({
          page,
          timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS,
        });
        if (rendered.warning) warnings.push(rendered.warning);
        const embeddedImage = await mergedPdf.embedPng(rendered.pngBuffer);
        const pageDoc = mergedPdf.addPage([pdfPageWidth, pdfPageHeight]);
        pageDoc.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: pdfPageWidth,
          height: pdfPageHeight,
        });
      }

      const outputBytes = await mergedPdf.save();
      await fs.promises.writeFile(saveResult.filePath, outputBytes);
      const project = await db.getProject(sessionId);
      if (project?.id) {
        await db.updateProjectStatus(project.id, "exported");
      }

      log.info("[export:pdf] completed", {
        sessionId,
        pageCount: pages.length,
        filePath: saveResult.filePath,
        warningCount: warnings.length,
      });
      shell.showItemInFolder(saveResult.filePath);
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: pages.length,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("[export:pdf] failed", {
        sessionId,
        message,
      });
      throw error;
    }
  });

  // ========== Styles ==========

  ipcMain.handle("styles:get", async () => {
    log.info("[styles:get] requested");
    const styles = listStyleCatalog();
    const categories: Record<string, Array<{
      id: string;
      label: string;
      description: string;
      source?: "builtin" | "custom" | "override";
      editable?: boolean;
    }>> = {};
    for (const style of styles) {
      const category = style.category;
      if (!categories[category]) categories[category] = [];
      categories[category].push({
        id: style.id,
        label: style.label,
        description: style.description,
        source: style.source,
        editable: style.editable,
      });
    }
    const defaultStyle =
      styles.find((item) => item.styleKey === "minimal-white")?.id ??
      styles[0]?.id ??
      "";
    return { categories, defaultStyle };
  });

  ipcMain.handle("styles:getDetail", async (_event, styleId: string) => {
    return getStyleDetail(styleId);
  });

  ipcMain.handle("styles:list", async () => {
    const rows = await db.listStyleRows();
    rows.sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt));
    return {
      items: rows.map((row) => ({
        id: row.id,
        label: row.styleName,
        description: row.description,
        category: row.category || (row.source === "builtin" ? "内置" : "自定义"),
        source: row.source,
        editable: row.source !== "builtin",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  });

  const parseStylePayload = (payload: any) => {
    log.info("[styles:payload] requested", {
      styleId: payload?.id || "",
    });
    const id = String(payload?.id || "").trim();
    const label = String(payload?.label || "").trim();
    const description = String(payload?.description || "").trim();
    const category = String(payload?.category || "").trim();
    const styleSkill = String(payload?.styleSkill || "").trim();
    const aliases = Array.isArray(payload?.aliases)
      ? payload.aliases.map((alias: unknown) => String(alias || "").trim()).filter((alias: string) => alias.length > 0)
      : [];
    if (!id || !label) {
      throw new Error("保存风格失败：id 与 label 必填。");
    }
    if (!styleSkill) {
      throw new Error("保存风格失败：styleSkill 不能为空。");
    }
    return {
      id,
      label,
      description,
      category,
      aliases,
      prompt: styleSkill,
    };
  };

  ipcMain.handle("styles:create", async (_event, payload) => {
    const parsed = parseStylePayload(payload);
    const result = await createStyleSkill(parsed);
    return { success: true, ...result };
  });

  ipcMain.handle("styles:update", async (_event, payload) => {
    const parsed = parseStylePayload(payload);
    const result = await updateStyleSkill(parsed);
    return { success: true, ...result };
  });

  ipcMain.handle("styles:delete", async (_event, styleId: string) => {
    const id = String(styleId || "").trim();
    if (!id) return { success: false, deleted: false };
    if (!hasStyleSkill(id)) {
      return { success: false, deleted: false, message: "style 不存在" };
    }
    const result = await deleteStyleSkill(id);
    return {
      success: true,
      deleted: result.deleted,
      message: result.deleted ? undefined : "内置风格不可删除",
    };
  });

  // ========== Settings ==========

  ipcMain.handle("settings:get", async () => {
    log.info("[settings:get] requested");
    const settings = await db.getAllSettings();
    const storagePath =
      typeof settings.storage_path === "string" && settings.storage_path.trim().length > 0
        ? settings.storage_path.trim()
        : "";
    const providerConfigs = {
      anthropic: {
        model: typeof settings.model_anthropic === "string" ? settings.model_anthropic : "",
        apiKey: decryptApiKey(settings.api_key_anthropic),
        baseUrl: typeof settings.base_url_anthropic === "string" ? settings.base_url_anthropic : "",
      },
      openai: {
        model: typeof settings.model_openai === "string" ? settings.model_openai : "",
        apiKey: decryptApiKey(settings.api_key_openai),
        baseUrl: typeof settings.base_url_openai === "string" ? settings.base_url_openai : "",
      },
    };

    return {
      provider: settings.provider || "openai",
      theme: settings.theme || "light",
      autoSave: settings.auto_save ?? true,
      storagePath,
      providerConfigs,
    };
  });

  ipcMain.handle("settings:save", async (_event, settings) => {
    log.info("[settings:save] received", {
      provider: settings?.provider,
      hasStoragePath: typeof settings?.storagePath === "string" && settings.storagePath.trim().length > 0,
      providers: settings?.providerConfigs ? Object.keys(settings.providerConfigs) : [],
    });
    if (settings.provider !== undefined) await db.setSetting("provider", settings.provider);
    if (settings.theme !== undefined) await db.setSetting("theme", settings.theme);
    if (settings.autoSave !== undefined) await db.setSetting("auto_save", settings.autoSave);
    if (typeof settings.storagePath === "string" && settings.storagePath.trim().length > 0) {
      await db.setStoragePath(settings.storagePath);
    }
    if (settings.providerConfigs && typeof settings.providerConfigs === "object") {
      const providerConfigs = settings.providerConfigs as Record<
        string,
        { model?: unknown; apiKey?: unknown; baseUrl?: unknown }
      >;
      for (const [provider, config] of Object.entries(providerConfigs)) {
        if (typeof config.model === "string") await db.setSetting(`model_${provider}`, config.model);
        if (typeof config.apiKey === "string") {
          await db.setSetting(`api_key_${provider}`, encryptApiKey(config.apiKey));
        }
        if (typeof config.baseUrl === "string") await db.setSetting(`base_url_${provider}`, config.baseUrl);
      }
    }
    return { success: true };
  });

  ipcMain.handle("settings:verifyApiKey", async (_event, { provider, apiKey, model, baseUrl }) => {
    log.info("[settings:verifyApiKey] received", {
      provider, model,
      hasApiKey: typeof apiKey === "string" && apiKey.trim().length > 0,
      baseUrl: typeof baseUrl === "string" ? baseUrl : "",
    });

    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return { valid: false, message: "请先填写 api_key。" };
    }
    if (typeof model !== "string" || model.trim().length === 0) {
      return { valid: false, message: "请先填写 model。" };
    }

    try {
      const client = resolveModel(provider, apiKey.trim(), model.trim(), typeof baseUrl === "string" ? baseUrl.trim() : "");
      await client.invoke("Reply with OK.");
      log.info("[settings:verifyApiKey] success", { provider, model });
      return { valid: true, message: "连接验证成功。" };
    } catch (error) {
      const message = error instanceof Error && error.message.length > 0
        ? error.message : "连接验证失败，请检查 api_key、model 或 base_url。";
      log.error("[settings:verifyApiKey] failed", { provider, model, baseUrl: typeof baseUrl === "string" ? baseUrl : "", message });
      return { valid: false, message };
    }
  });

  ipcMain.handle("settings:chooseStoragePath", async (event) => {
    log.info("[settings:chooseStoragePath] received");
    const targetWindow =
      BrowserWindow.fromWebContents(event.sender) ??
      BrowserWindow.getFocusedWindow() ??
      mainWindow;

    try {
      const settings = await db.getAllSettings();
      const currentStoragePath =
        typeof settings.storage_path === "string" && settings.storage_path.trim().length > 0
          ? settings.storage_path.trim()
          : "";
      const result = await dialog.showOpenDialog(targetWindow, {
        title: "选择 OpenPPT 存储目录",
        buttonLabel: "选择目录",
        ...(currentStoragePath ? { defaultPath: currentStoragePath } : {}),
        properties: ["openDirectory", "createDirectory", "promptToCreate"],
      });
      if (!result.canceled && result.filePaths.length > 0) {
        return { path: result.filePaths[0] };
      }
      return { path: null };
    } catch (error) {
      const message = error instanceof Error && error.message.length > 0 ? error.message : "无法打开系统目录选择器。";
      log.error("[settings:chooseStoragePath] failed", { message });
      return { path: null, error: message };
    }
  });

  // ========== Preview ==========

  ipcMain.handle("preview:load", async (_event, payload, legacySessionId?: string) => {
    const parsed = parsePathPayload(payload, "htmlPath");
    const sessionId = parsed.sessionId ?? normalizeSessionId(legacySessionId);
    const safeHtmlPath = await assertPathInAllowedRoots({
      filePath: parsed.filePath,
      mode: "read",
      sessionId,
      htmlOnly: true,
    });
    return fs.promises.readFile(safeHtmlPath, "utf-8");
  });

  ipcMain.handle(
    "preview:loadPage",
    async (
      _event,
      payloadOrHtmlPath: unknown,
      legacyPageId?: string,
      legacySessionId?: string
    ) => {
      let htmlPath = "";
      let pageId = "";
      let sessionId: string | undefined;
      if (payloadOrHtmlPath && typeof payloadOrHtmlPath === "object") {
        const payload = payloadOrHtmlPath as {
          htmlPath?: unknown;
          path?: unknown;
          pageId?: unknown;
          sessionId?: unknown;
        };
        htmlPath =
          typeof payload.htmlPath === "string"
            ? payload.htmlPath
            : typeof payload.path === "string"
              ? payload.path
              : "";
        pageId = typeof payload.pageId === "string" ? payload.pageId : "";
        sessionId = normalizeSessionId(payload.sessionId);
      } else {
        htmlPath = typeof payloadOrHtmlPath === "string" ? payloadOrHtmlPath : "";
        pageId = typeof legacyPageId === "string" ? legacyPageId : "";
        sessionId = normalizeSessionId(legacySessionId);
      }
      const normalizedPageId = pageId.trim();
      if (!normalizedPageId) {
        throw new Error("pageId 不能为空");
      }
      const safeHtmlPath = await assertPathInAllowedRoots({
        filePath: htmlPath,
        mode: "read",
        sessionId,
        htmlOnly: true,
      });
      const isPageFile = /\/page-\d+\.html?$/i.test(safeHtmlPath);
      if (isPageFile) {
        const html = await fs.promises.readFile(safeHtmlPath, "utf-8");
        const numberMatch = safeHtmlPath.match(/page-(\d+)\.html?$/i);
        const pageNumber = numberMatch ? Number(numberMatch[1]) : 1;
        return {
          pageNumber,
          pageId: normalizedPageId || `page-${pageNumber}`,
          title: `Page ${pageNumber}`,
          html,
        };
      }

      const indexHtml = await fs.promises.readFile(safeHtmlPath, "utf-8");
      const pages = extractPagesDataFromIndex(indexHtml);
      const page = pages.find((p) => p.pageId === normalizedPageId);
      if (!page) throw new Error(`Page ${normalizedPageId} not found in ${safeHtmlPath}`);
      if (page.htmlPath) {
        const resolvedPagePath = path.resolve(path.dirname(safeHtmlPath), page.htmlPath);
        const safeResolvedPagePath = await assertPathInAllowedRoots({
          filePath: resolvedPagePath,
          mode: "read",
          sessionId,
          htmlOnly: true,
        });
        const html = await fs.promises.readFile(safeResolvedPagePath, "utf-8");
        return {
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: page.title,
          html,
        };
      }
      return page;
    }
  );

  // ========== File Operations ==========

  ipcMain.handle("file:open", async (_event, payload, legacySessionId?: string) => {
    const parsed = parsePathPayload(payload, "path");
    const sessionId = parsed.sessionId ?? normalizeSessionId(legacySessionId);
    const safePath = await assertPathInAllowedRoots({
      filePath: parsed.filePath,
      mode: "read",
      sessionId,
    });
    return fs.promises.readFile(safePath, "utf-8");
  });

  ipcMain.handle("file:reveal", async (_event, payload, legacySessionId?: string) => {
    const parsed = parsePathPayload(payload, "path");
    const sessionId = parsed.sessionId ?? normalizeSessionId(legacySessionId);
    const safePath = await assertPathInAllowedRoots({
      filePath: parsed.filePath,
      mode: "read",
      sessionId,
    });
    shell.showItemInFolder(safePath);
    return { success: true };
  });

  ipcMain.handle(
    "file:openInBrowser",
    async (_event, payloadOrPath, legacyHash?: string, legacySessionId?: string) => {
      const parsed = parsePathPayload(payloadOrPath, "path");
      const sessionId = parsed.sessionId ?? normalizeSessionId(legacySessionId);
      const hashRaw = typeof legacyHash === "string" ? legacyHash : parsed.hash;
      const safePath = await assertPathInAllowedRoots({
        filePath: parsed.filePath,
        mode: "read",
        sessionId,
        htmlOnly: true,
      });
      const baseUrl = pathToFileURL(safePath).toString();
      const hashValue = typeof hashRaw === "string" && hashRaw.trim().length > 0
        ? (hashRaw.startsWith("#") ? hashRaw : `#${hashRaw}`)
        : "";
      await shell.openExternal(`${baseUrl}${hashValue}`);
      return { success: true };
    }
  );

  ipcMain.handle("file:save", async (_event, payload) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("file:save 参数无效");
    }
    const record = payload as { path?: unknown; content?: unknown; sessionId?: unknown };
    const filePath = typeof record.path === "string" ? record.path : "";
    const content = typeof record.content === "string" ? record.content : "";
    const sessionId = normalizeSessionId(record.sessionId);
    const safePath = await assertPathInAllowedRoots({
      filePath,
      mode: "write",
      sessionId,
    });
    await fs.promises.writeFile(safePath, content, "utf-8");
    return { success: true };
  });
}
