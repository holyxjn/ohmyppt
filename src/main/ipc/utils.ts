/** Pure utility functions used across IPC handlers. */

export const normalizeSession = (session: Record<string, unknown> | null | undefined) => {
  if (!session) return session;
  return {
    ...session,
    styleId: session.styleId ?? session.style_id ?? null,
    page_count: session.page_count ?? session.pageCount ?? null,
    referenceDocumentPath:
      session.referenceDocumentPath ?? session.reference_document_path ?? null,
    reference_document_path:
      session.reference_document_path ?? session.referenceDocumentPath ?? null,
    created_at: session.created_at ?? session.createdAt ?? null,
    updated_at: session.updated_at ?? session.updatedAt ?? null,
    generation_duration_sec:
      session.generation_duration_sec ?? session.generationDurationSec ?? null,
    generated_count: session.generated_count ?? session.generatedCount ?? null,
    failed_count: session.failed_count ?? session.failedCount ?? null,
  };
};

export const normalizeMessage = (message: Record<string, unknown>) => {
  const normalizeAssetPaths = (raw: unknown, prefix: "./images/" | "./videos/") => {
    if (Array.isArray(raw)) {
      return raw
        .map((item) => String(item || "").trim())
        .filter((item) => item.startsWith(prefix))
        .slice(0, 10);
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item || "").trim())
            .filter((item) => item.startsWith(prefix))
            .slice(0, 10);
        }
      } catch {
        // ignore invalid JSON payload
      }
    }
    return [] as string[];
  };

  const normalizedImagePaths = normalizeAssetPaths(
    message.image_paths ?? message.imagePaths,
    "./images/"
  );
  const normalizedVideoPaths = normalizeAssetPaths(
    message.video_paths ?? message.videoPaths,
    "./videos/"
  );

  return {
  ...message,
  session_id: message.session_id ?? message.sessionId ?? null,
  chat_scope: message.chat_scope ?? message.chatScope ?? "main",
  page_id: message.page_id ?? message.pageId ?? null,
  image_paths: normalizedImagePaths,
  video_paths: normalizedVideoPaths,
  tool_name: message.tool_name ?? message.toolName ?? null,
  tool_call_id: message.tool_call_id ?? message.toolCallId ?? null,
  token_count: message.token_count ?? message.tokenCount ?? null,
  created_at: message.created_at ?? message.createdAt ?? null,
  };
};

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Generation cancelled"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const extractOutlineTitles = (prompt: string): string[] =>
  prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const explicit = line.match(/^第\s*[一二三四五六七八九十百\d]+\s*页\s*[:：]\s*(.+)$/i);
      if (explicit?.[1]) return explicit[1].trim();
      const numbered = line.match(/^\d+\s*[.、]\s*(.+)$/);
      if (numbered?.[1]) return numbered[1].trim();
      return "";
    })
    .filter((line) => line.length > 0);

export const extractModelText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const content = "content" in value ? (value as { content?: unknown }).content : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return typeof (item as { text?: unknown }).text === "string" ? String((item as { text?: unknown }).text) : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
};

export const extractJsonBlock = (raw: string): string => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const extractBalanced = (open: "{" | "[", close: "}" | "]"): string | null => {
    const start = raw.indexOf(open);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === open) depth += 1;
      if (char === close) {
        depth -= 1;
        if (depth === 0) return raw.slice(start, index + 1);
      }
    }
    return null;
  };

  const objectBlock = extractBalanced("{", "}");
  if (objectBlock) return objectBlock.trim();
  const arrayBlock = extractBalanced("[", "]");
  if (arrayBlock) return arrayBlock.trim();
  return raw.trim();
};
