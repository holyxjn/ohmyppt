export {
  SHARED_PAGE_STYLES_START,
  SHARED_PAGE_STYLES_END,
  pageContentStartMarker,
  pageContentEndMarker,
  emitToolStatus,
} from "./types";
export type { SessionDeckGenerationContext, DeckToolStatusPayload, ToolStreamConfig } from "./types";
export { createSessionBoundDeckTools, BASE_PAGE_STYLE_TAG, FIT_SCRIPT } from "./deck-tools";
