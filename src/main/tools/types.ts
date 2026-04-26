import log from "electron-log/main.js";

// ── Marker constants ──

export const SHARED_PAGE_STYLES_START = "/* SHARED_PAGE_STYLES_START */";
export const SHARED_PAGE_STYLES_END = "/* SHARED_PAGE_STYLES_END */";

export const pageContentStartMarker = (pageId: string) => `<!-- PAGE_CONTENT_START:${pageId} -->`;
export const pageContentEndMarker = (pageId: string) => `<!-- PAGE_CONTENT_END:${pageId} -->`;

// ── Types ──

export type ToolStreamConfig = {
  writer?: (chunk: unknown) => void;
} | null;

export interface OutlineItem {
  title: string;
  contentOutline: string;
}

export interface DesignContract {
  theme: string;
  background: string;
  palette: string[];
  titleStyle: string;
  layoutMotif: string;
  chartStyle: string;
  shapeLanguage: string;
}

export interface SessionDeckGenerationContext {
  mode?: "generate" | "edit";
  editScope?: "main" | "page";
  sessionId: string;
  projectDir: string;
  indexPath: string;
  pageFileMap: Record<string, string>;
  allowedPageIds?: string[];
  topic: string;
  deckTitle: string;
  styleId: string | null | undefined;
  /** Snapshot of the database styleSkill markdown for this run. */
  styleSkillPrompt?: string;
  userMessage: string;
  outlineTitles: string[];
  outlineItems: OutlineItem[];
  designContract?: DesignContract;
  // Edit-mode fields (filled when mode=edit)
  selectedPageId?: string;
  selectedPageNumber?: number;
  selectedSelector?: string;
  elementTag?: string;
  elementText?: string;
  existingPageIds?: string[];
}

export interface DeckToolStatusPayload {
  label: string;
  detail?: string;
  progress?: number;
  pageId?: string;
  agentName?: string;
}

// ── Shared helpers ──

export const emitToolStatus = (
  config: ToolStreamConfig | undefined,
  payload: DeckToolStatusPayload
) => {
  try {
    config?.writer?.({
      type: "deck_tool_status",
      ...payload,
    });
  } catch (error) {
    log.warn("[deepagent] failed to emit custom tool status", {
      message: error instanceof Error ? error.message : String(error),
      payload,
    });
  }
};
