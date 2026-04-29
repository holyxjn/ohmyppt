export const INSPECTOR_CONSOLE_PREFIX = '__PPT_INSPECTOR__:'

export function buildInspectorInjectScript(): string {
  return `
(() => {
  const STATE_KEY = "__pptInspectorState";
  const STYLE_ID = "ppt-inspector-style";
  const HIGHLIGHT_CLASS = "ppt-inspector-highlight";
  const LOG_PREFIX = "${INSPECTOR_CONSOLE_PREFIX}";

  const state = window[STATE_KEY];
  if (state && state.active) return;

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
      .filter((item) => item && !item.startsWith("ppt-inspector-") && !item.includes(":"))
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
      const selector = scope + ' [data-block-id="' + attrEscape(blockId) + '"]';
      return selector;
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

  const getContentRoot = (element) => {
    return element && element.closest('[data-block-id="content"], [data-role="content"]');
  };

  const isScaffoldBlock = (element) => {
    if (!(element instanceof Element)) return false;
    const blockId = element.getAttribute("data-block-id");
    const role = element.getAttribute("data-role");
    return blockId === "content" || role === "content";
  };

  const isUsableTarget = (element) => {
    if (!(element instanceof Element)) return false;
    if (!isInsidePageRoot(element)) return false;
    if (isScaffoldBlock(element)) return false;
    const contentRoot = getContentRoot(element);
    if (!contentRoot || element === contentRoot) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  };

  const pickTarget = (origin) => {
    if (!(origin instanceof Element)) return null;
    let candidate = origin;
    const contentRoot = getContentRoot(origin);
    while (candidate && candidate !== contentRoot) {
      if (isUsableTarget(candidate) && buildStableSelector(candidate)) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = \`
      .\${HIGHLIGHT_CLASS} {
        outline: 2px dashed #3b82f6 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 2px rgba(59,130,246,0.18) !important;
        background-image: linear-gradient(rgba(59,130,246,0.08), rgba(59,130,246,0.08)) !important;
        cursor: crosshair !important;
      }
    \`;
    document.head.appendChild(style);
  };

  let activeElement = null;
  const cursorHost = document.body || document.documentElement;
  const previousCursor = cursorHost && cursorHost.style ? cursorHost.style.cursor : "";
  if (cursorHost && cursorHost.style) {
    cursorHost.style.cursor = "crosshair";
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

  const onClick = (event) => {
    const target = pickTarget(event.target);
    if (!target) return;
    const selector = buildStableSelector(target);
    if (!selector) {
      console.log(LOG_PREFIX + JSON.stringify({
        type: "invalid",
        message: "无法为该元素生成稳定选择器，请点击 content 内的可见元素",
      }));
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const elementTag = target.tagName ? target.tagName.toLowerCase() : "";
    const rawText = (target.textContent || "").replace(/\s+/g, " ").trim();
    const elementText = rawText.length > 80 ? rawText.slice(0, 80) + "…" : rawText;

    console.log(LOG_PREFIX + JSON.stringify({
      type: "selected",
      selector,
      label: selector,
      elementTag,
      elementText,
    }));

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
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    clearActive();
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    if (cursorHost && cursorHost.style) {
      cursorHost.style.cursor = previousCursor || "";
    }
    delete window[STATE_KEY];
  };

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  window[STATE_KEY] = { active: true, cleanup };
})();
  `
}

export function buildInspectorCleanupScript(): string {
  return `
(() => {
  const STATE_KEY = "__pptInspectorState";
  const state = window[STATE_KEY];
  if (state && typeof state.cleanup === "function") {
    state.cleanup();
  } else {
    delete window[STATE_KEY];
  }
})();
  `
}
