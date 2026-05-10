export const TEXT_EDITOR_CONSOLE_PREFIX = '__PPT_TEXT_EDITOR__:'

export function buildTextEditorInjectScript(): string {
  return `
(() => {
  const STATE_KEY = "__pptTextEditorState";
  const STYLE_ID = "ppt-text-editor-style";
  const HIGHLIGHT_CLASS = "ppt-text-editor-highlight";
  const SELECTED_CLASS = "ppt-text-editor-selected";
  const LOG_PREFIX = "${TEXT_EDITOR_CONSOLE_PREFIX}";
  const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "span", "strong", "em", "b", "i", "u", "s", "small", "label", "button", "td", "th", "blockquote", "figcaption", "sub", "sup"]);
  const BLOCKED_TEXT_TAGS = new Set(["script", "style", "svg", "canvas", "img", "video", "audio", "input", "textarea", "select", "option"]);
  const EDITABLE_TEXT_CHILD_TAGS = new Set([...TEXT_TAGS, "br"]);

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
    if (pageId) {
      const byId = "#" + cssEscape(pageId);
      try {
        if (document.querySelector(byId)) return byId;
      } catch (_error) {}
      return 'body[data-page-id="' + attrEscape(pageId) + '"]';
    }
    return "body";
  };

  const getClassList = (el) =>
    Array.from(el.classList || [])
      .filter((item) => item && !item.startsWith("ppt-text-editor-") && !item.includes(":"))
      .slice(0, 3);

  const buildSegment = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute("id");
    if (id) return "#" + cssEscape(id);
    const role = el.getAttribute("data-role");
    if (role) return tag + '[data-role="' + attrEscape(role) + '"]';
    const blockId = el.getAttribute("data-block-id");
    if (blockId) return tag + '[data-block-id="' + attrEscape(blockId) + '"]';
    const classes = getClassList(el);
    if (classes.length > 0) {
      return tag + "." + classes.map((item) => cssEscape(item)).join(".");
    }
    return tag;
  };

  const buildScopedSelector = (scope, el) => {
    const levels = [];
    let cursor = el;
    while (
      cursor &&
      cursor instanceof Element &&
      cursor !== document.body &&
      cursor !== document.documentElement &&
      levels.length < 3
    ) {
      levels.unshift(buildSegment(cursor));
      cursor = cursor.parentElement;
    }

    const candidates = [];
    if (levels.length >= 1) {
      candidates.push(scope + " " + levels[levels.length - 1]);
    }
    if (levels.length >= 2) {
      candidates.push(scope + " " + levels[levels.length - 2] + " > " + levels[levels.length - 1]);
    }
    if (levels.length >= 3) {
      candidates.push(scope + " " + levels[levels.length - 3] + " > " + levels[levels.length - 2] + " > " + levels[levels.length - 1]);
    }

    for (const candidate of candidates) {
      if (isUniqueSelector(candidate)) return candidate;
    }

    return candidates[candidates.length - 1] || (scope + " " + buildSegment(el));
  };

  const buildStableSelector = (el) => {
    if (!(el instanceof Element)) return null;
    const scope = getPageScopeSelector();

    const blockId = el.getAttribute("data-block-id");
    if (blockId) {
      return scope + ' [data-block-id="' + attrEscape(blockId) + '"]';
    }

    const role = el.getAttribute("data-role");
    if (role) {
      const owner = el.closest("[data-block-id]");
      const ownerBlockId = owner ? owner.getAttribute("data-block-id") : "";
      if (ownerBlockId) {
        const roleSelector =
          scope +
          ' [data-block-id="' +
          attrEscape(ownerBlockId) +
          '"] [data-role="' +
          attrEscape(role) +
          '"]';
        if (isUniqueSelector(roleSelector)) return roleSelector;
      }
    }

    const idValue = el.getAttribute("id");
    if (idValue) {
      const idSelector = scope + " #" + cssEscape(idValue);
      if (isUniqueSelector(idSelector)) return idSelector;
      return idSelector;
    }

    const root = el.closest("[data-ppt-guard-root='1'], .ppt-page-root");
    if (root) {
      const rootSelector = root.getAttribute("data-ppt-guard-root") === "1"
        ? '[data-ppt-guard-root="1"]'
        : ".ppt-page-root";
      const segments = [];
      let current = el;
      while (current && current !== root) {
        const parent = current.parentElement;
        if (!parent) break;
        const index = Array.prototype.indexOf.call(parent.children, current);
        if (index < 0) break;
        const tag = current.tagName ? current.tagName.toLowerCase() : "*";
        segments.unshift(tag + ":nth-child(" + (index + 1) + ")");
        current = parent;
      }
      if (current === root && segments.length > 0) {
        const selector = scope + " " + rootSelector + " " + segments.join(" > ");
        if (isUniqueSelector(selector)) return selector;
      }
    }

    return buildScopedSelector(scope, el);
  };

  const isInsidePageRoot = (element) => {
    return element && (element.closest(".ppt-page-root") !== null || element.closest("[data-ppt-guard-root='1']") !== null);
  };

  const getPageRoot = (element) => {
    return element && element.closest(".ppt-page-root, [data-ppt-guard-root='1']");
  };

  const getContentRoot = (element) => {
    return element && element.closest('[data-block-id="content"], [data-role="content"]');
  };

  const isScaffoldBlock = (element) => {
    if (!(element instanceof Element)) return false;
    const blockId = element.getAttribute("data-block-id");
    const role = element.getAttribute("data-role");
    return (
      (blockId && new Set(["content", "page", "root"]).has(String(blockId))) ||
      role === "content" ||
      element.classList.contains("ppt-page-root") ||
      element.classList.contains("ppt-page-fit-scope") ||
      element.classList.contains("ppt-page-content") ||
      element.getAttribute("data-ppt-guard-root") === "1" ||
      element.tagName === "BODY" ||
      element.tagName === "HTML"
    );
  };

  const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();

  const hasOnlyEditableTextChildren = (element) => {
    return Array.from(element.children || []).every((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : "";
      if (!tag || BLOCKED_TEXT_TAGS.has(tag)) return false;
      if (!EDITABLE_TEXT_CHILD_TAGS.has(tag)) return false;
      return hasOnlyEditableTextChildren(child);
    });
  };

  const isEditableTextTarget = (element) => {
    if (!(element instanceof Element)) return false;
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    if (!tag || BLOCKED_TEXT_TAGS.has(tag)) return false;
    if (element.closest("svg, canvas, script, style")) return false;
    if (!hasOnlyEditableTextChildren(element)) return false;
    if (!TEXT_TAGS.has(tag) && !element.getAttribute("data-role") && !element.getAttribute("data-block-id")) return false;
    const text = normalizeText(element.textContent);
    if (!text || text.length > 500) return false;
    return true;
  };

  const isUsableTarget = (element) => {
    if (!(element instanceof Element)) return false;
    if (!isInsidePageRoot(element)) return false;
    if (isScaffoldBlock(element)) return false;
    if (["SCRIPT", "STYLE", "LINK", "META", "TITLE"].includes(element.tagName)) return false;
    const boundaryRoot = getContentRoot(element) || getPageRoot(element);
    if (!boundaryRoot || element === boundaryRoot) return false;
    if (!isEditableTextTarget(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  };

  const pickTarget = (origin) => {
    if (!(origin instanceof Element)) return null;
    let candidate = origin;
    let firstUsable = null;
    const boundaryRoot = getContentRoot(origin) || getPageRoot(origin);
    while (candidate && candidate !== boundaryRoot) {
      if (isUsableTarget(candidate) && buildStableSelector(candidate)) {
        if (!firstUsable) firstUsable = candidate;
        if (candidate.getAttribute("data-block-id")) return candidate;
      }
      candidate = candidate.parentElement;
    }
    return firstUsable;
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = \`
      .\${HIGHLIGHT_CLASS} {
        outline: 2px dashed #16a34a !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 2px rgba(22,163,74,0.18) !important;
        background-image: linear-gradient(rgba(22,163,74,0.08), rgba(22,163,74,0.08)) !important;
        cursor: text !important;
      }
      .\${SELECTED_CLASS} {
        outline: 2px solid #16a34a !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 2px rgba(22,163,74,0.25) !important;
        background-image: linear-gradient(rgba(22,163,74,0.12), rgba(22,163,74,0.12)) !important;
        cursor: text !important;
      }
    \`;
    document.head.appendChild(style);
  };

  let activeElement = null;
  let selectedElement = null;

  const setSelected = (el) => {
    if (selectedElement === el) return;
    if (selectedElement) selectedElement.classList.remove(SELECTED_CLASS);
    selectedElement = el;
    if (selectedElement) selectedElement.classList.add(SELECTED_CLASS);
  };

  const clearSelected = () => {
    if (selectedElement) {
      selectedElement.classList.remove(SELECTED_CLASS);
      selectedElement = null;
    }
  };
  const cursorHost = document.body || document.documentElement;
  const previousCursor = cursorHost && cursorHost.style ? cursorHost.style.cursor : "";
  if (cursorHost && cursorHost.style) {
    cursorHost.style.cursor = "text";
  }
  ensureStyle();

  const setActive = (el) => {
    if (activeElement === el) return;
    if (activeElement) activeElement.classList.remove(HIGHLIGHT_CLASS);
    activeElement = el;
    if (activeElement) activeElement.classList.add(HIGHLIGHT_CLASS);
  };

  const clearActive = () => {
    if (activeElement) {
      activeElement.classList.remove(HIGHLIGHT_CLASS);
      activeElement = null;
    }
  };

  const onMouseMove = (event) => {
    const target = pickTarget(event.target);
    if (!target) {
      clearActive();
      return;
    }
    setActive(target);
  };

  const onDblClick = (event) => {
    const target = pickTarget(event.target);
    if (!target) return;
    const selector = buildStableSelector(target);
    if (!selector) return;

    setSelected(target);

    const elementTag = target.tagName ? target.tagName.toLowerCase() : "";
    const rawText = normalizeText(target.textContent);
    const elementText = rawText.length > 80 ? rawText.slice(0, 80) + "…" : rawText;
    const computed = window.getComputedStyle(target);
    const rect = target.getBoundingClientRect();

    console.log(LOG_PREFIX + JSON.stringify({
      type: "selected",
      selector,
      label: selector,
      elementTag,
      elementText,
      text: rawText,
      style: {
        color: computed.color || "",
        fontSize: computed.fontSize || "",
        fontWeight: computed.fontWeight || "",
        lineHeight: computed.lineHeight || "",
        textAlign: computed.textAlign || "",
        backgroundColor: computed.backgroundColor || ""
      },
      bounds: {
        x: Math.round(rect.left * 10) / 10,
        y: Math.round(rect.top * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10
      }
    }));

    event.preventDefault();
    event.stopPropagation();
  };

  /**
   * Live preview: apply style/text changes to the element inside the iframe
   * without persisting to disk. The host calls this via executeJavaScript.
   */
  window.__pptTextEditorLiveUpdate = (selector, patch) => {
    try {
      const el = document.querySelector(selector);
      if (!el) return;
      if (typeof patch.text === "string") {
        el.textContent = patch.text;
      }
      if (patch.style) {
        if (patch.style.color) el.style.setProperty("color", patch.style.color, "important");
        if (patch.style.fontSize) el.style.setProperty("font-size", patch.style.fontSize, "important");
        if (patch.style.fontWeight) el.style.setProperty("font-weight", patch.style.fontWeight, "important");
      }
    } catch (_error) {}
  };

  window.__pptTextEditorClearSelection = () => {
    clearSelected();
  };

  const cleanup = () => {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("dblclick", onDblClick, true);
    clearActive();
    clearSelected();
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    if (cursorHost && cursorHost.style) {
      cursorHost.style.cursor = previousCursor || "";
    }
    delete window.__pptTextEditorLiveUpdate;
    delete window.__pptTextEditorClearSelection;
    delete window[STATE_KEY];
  };

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("dblclick", onDblClick, true);

  window[STATE_KEY] = { active: true, cleanup };
})();
`
}

export function buildTextEditorCleanupScript(): string {
  return `
(() => {
  const STATE_KEY = "__pptTextEditorState";
  const state = window[STATE_KEY];
  if (state && typeof state.cleanup === "function") {
    state.cleanup();
  } else {
    delete window[STATE_KEY];
  }
})();
`
}
