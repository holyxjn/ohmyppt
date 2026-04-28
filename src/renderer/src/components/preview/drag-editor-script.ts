export const DRAG_EDITOR_CONSOLE_PREFIX = '__PPT_DRAG_EDITOR__:'

export interface DragEditorMovePayload {
  selector: string
  label: string
  elementTag: string
  x: number
  y: number
  deltaX: number
  deltaY: number
}

export function buildDragEditorInjectScript(): string {
  return `
(() => {
  const STATE_KEY = "__pptDragEditorState";
  const STYLE_ID = "ppt-drag-editor-style";
  const HOVER_CLASS = "ppt-drag-editor-hover";
  const ACTIVE_CLASS = "ppt-drag-editor-active";
  const LOG_PREFIX = "${DRAG_EDITOR_CONSOLE_PREFIX}";

  const existing = window[STATE_KEY];
  if (existing && existing.active) return;

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\\\" + ch);
  };

  const attrEscape = (value) => String(value).replace(/"/g, '\\\\"');

  const isUniqueSelector = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (_error) {
      return false;
    }
  };

  const getPageScopeSelector = () => {
    const pageId = document.body ? document.body.getAttribute("data-page-id") : "";
    if (pageId) return 'body[data-page-id="' + attrEscape(pageId) + '"]';
    return "body";
  };

  const buildStableSelector = (el) => {
    if (!(el instanceof Element)) return null;
    const scope = getPageScopeSelector();
    const blockId = el.getAttribute("data-block-id");
    if (blockId) return scope + ' [data-block-id="' + attrEscape(blockId) + '"]';

    const idValue = el.getAttribute("id");
    if (idValue) {
      const selector = scope + " #" + cssEscape(idValue);
      if (isUniqueSelector(selector)) return selector;
    }

    return null;
  };

  const pickTarget = (origin) => {
    if (!(origin instanceof Element)) return null;
    const target = origin.closest("[data-block-id]");
    if (!target) return null;
    if (target.closest(".ppt-page-root") === null && !target.closest("[data-ppt-guard-root='1']")) {
      return null;
    }
    return target;
  };

  const parsePx = (value) => {
    const match = String(value || "").trim().match(/^(-?\\d+(?:\\.\\d+)?)px$/);
    return match ? Number(match[1]) : 0;
  };

  const ensureDragTranslate = (target) => {
    target.style.translate = "var(--ppt-drag-x, 0px) var(--ppt-drag-y, 0px)";
    target.style.willChange = "transform";
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = \`
      .\${HOVER_CLASS} {
        outline: 2px dashed rgba(93,107,77,0.78) !important;
        outline-offset: 3px !important;
        cursor: move !important;
      }
      .\${HOVER_CLASS} * {
        cursor: move !important;
      }
      .\${ACTIVE_CLASS} {
        outline: 2px solid #5d6b4d !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 4px rgba(93,107,77,0.14) !important;
        cursor: move !important;
        user-select: none !important;
      }
      .\${ACTIVE_CLASS} * {
        cursor: move !important;
      }
      html,
      body,
      body * {
        cursor: move !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
    \`;
    document.head.appendChild(style);
  };

  let hoverElement = null;
  let activeElement = null;
  let dragState = null;
  let pendingClientX = 0;
  let pendingClientY = 0;
  let frameId = 0;
  const cursorHost = document.body || document.documentElement;
  const rootHost = document.documentElement;
  const previousCursor = cursorHost && cursorHost.style ? cursorHost.style.cursor : "";
  const previousRootCursor = rootHost && rootHost.style ? rootHost.style.cursor : "";
  if (rootHost && rootHost.style) {
    rootHost.style.cursor = "move";
  }
  if (cursorHost && cursorHost.style) {
    cursorHost.style.cursor = "move";
  }
  ensureStyle();

  const setHover = (target) => {
    if (hoverElement === target) return;
    if (hoverElement && hoverElement !== activeElement) hoverElement.classList.remove(HOVER_CLASS);
    hoverElement = target;
    if (hoverElement && hoverElement !== activeElement) hoverElement.classList.add(HOVER_CLASS);
  };

  const setActive = (target) => {
    if (activeElement === target) return;
    if (activeElement) activeElement.classList.remove(ACTIVE_CLASS);
    activeElement = target;
    if (activeElement) {
      activeElement.classList.remove(HOVER_CLASS);
      activeElement.classList.add(ACTIVE_CLASS);
    }
  };

  const clearVisualState = () => {
    if (hoverElement) hoverElement.classList.remove(HOVER_CLASS);
    if (activeElement) activeElement.classList.remove(ACTIVE_CLASS);
    hoverElement = null;
    activeElement = null;
  };

  const applyPendingDrag = () => {
    frameId = 0;
    if (!dragState) return;
    const nextX = dragState.baseX + pendingClientX - dragState.startClientX;
    const nextY = dragState.baseY + pendingClientY - dragState.startClientY;
    dragState.target.style.setProperty("--ppt-drag-x", nextX.toFixed(1) + "px");
    dragState.target.style.setProperty("--ppt-drag-y", nextY.toFixed(1) + "px");
    ensureDragTranslate(dragState.target);
  };

  const onPointerMove = (event) => {
    if (dragState) {
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      if (!frameId) {
        frameId = requestAnimationFrame(applyPendingDrag);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = pickTarget(event.target);
    setHover(target);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const target = pickTarget(event.target);
    if (!target) return;
    const selector = buildStableSelector(target);
    if (!selector) {
      console.log(LOG_PREFIX + JSON.stringify({
        type: "invalid",
        message: "请拖拽带 data-block-id 的外层模块",
      }));
      return;
    }

    const computed = getComputedStyle(target);
    const baseX = parsePx(target.style.getPropertyValue("--ppt-drag-x") || computed.getPropertyValue("--ppt-drag-x"));
    const baseY = parsePx(target.style.getPropertyValue("--ppt-drag-y") || computed.getPropertyValue("--ppt-drag-y"));
    ensureDragTranslate(target);
    setActive(target);
    if (rootHost && rootHost.style) rootHost.style.cursor = "move";
    if (cursorHost && cursorHost.style) cursorHost.style.cursor = "move";
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;
    dragState = {
      target,
      selector,
      elementTag: target.tagName ? target.tagName.toLowerCase() : "",
      startClientX: event.clientX,
      startClientY: event.clientY,
      baseX,
      baseY,
    };
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch (_error) {}
    event.preventDefault();
    event.stopPropagation();
  };

  const finishDrag = (event) => {
    if (!dragState) return;
    if (frameId) {
      cancelAnimationFrame(frameId);
      applyPendingDrag();
    }
    const target = dragState.target;
    const nextX = parsePx(target.style.getPropertyValue("--ppt-drag-x"));
    const nextY = parsePx(target.style.getPropertyValue("--ppt-drag-y"));
    const deltaX = nextX - dragState.baseX;
    const deltaY = nextY - dragState.baseY;
    try {
      target.releasePointerCapture?.(event.pointerId);
    } catch (_error) {}
    target.classList.remove(ACTIVE_CLASS);
    target.style.willChange = "";
    if (rootHost && rootHost.style) rootHost.style.cursor = "move";
    if (cursorHost && cursorHost.style) cursorHost.style.cursor = "move";

    if (Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5) {
      console.log(LOG_PREFIX + JSON.stringify({
        type: "moved",
        selector: dragState.selector,
        label: dragState.selector,
        elementTag: dragState.elementTag,
        x: Number(nextX.toFixed(1)),
        y: Number(nextY.toFixed(1)),
        deltaX: Number(deltaX.toFixed(1)),
        deltaY: Number(deltaY.toFixed(1)),
      }));
    }
    dragState = null;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      console.log(LOG_PREFIX + JSON.stringify({ type: "exit" }));
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const cleanup = () => {
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", finishDrag, true);
    document.removeEventListener("pointercancel", finishDrag, true);
    document.removeEventListener("keydown", onKeyDown, true);
    clearVisualState();
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    if (cursorHost && cursorHost.style) {
      cursorHost.style.cursor = previousCursor || "";
    }
    if (rootHost && rootHost.style) {
      rootHost.style.cursor = previousRootCursor || "";
    }
    delete window[STATE_KEY];
  };

  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", finishDrag, true);
  document.addEventListener("pointercancel", finishDrag, true);
  document.addEventListener("keydown", onKeyDown, true);

  window[STATE_KEY] = { active: true, cleanup };
})();
  `
}

export function buildDragEditorCleanupScript(): string {
  return `
(() => {
  const STATE_KEY = "__pptDragEditorState";
  const state = window[STATE_KEY];
  if (state && typeof state.cleanup === "function") {
    state.cleanup();
  } else {
    delete window[STATE_KEY];
  }
})();
  `
}
