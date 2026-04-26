import * as cheerio from "cheerio";
import {
  SHARED_PAGE_STYLES_END,
  SHARED_PAGE_STYLES_START,
  pageContentEndMarker,
  pageContentStartMarker,
} from "./types";

// ── HTML parsing ──

export const extractBodyHtml = (html: string): string => {
  const $ = cheerio.load(html, { scriptingEnabled: false });
  $("script").remove();
  const bodyHtml = $("body").html();
  return (bodyHtml || "").trim();
};

export const extractStyleCss = (html: string): string =>
  (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || "").trim();

export const normalizePageCss = (css: string): string =>
  css
    .replace(/body\s*\{/g, ".ppt-page-root {")
    .replace(/\s+$/g, "")
    .trim();

export const unwrapCss = (input: string): string => {
  const styleMatch = input.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  return normalizePageCss((styleMatch?.[1] || input).trim());
};

// ── Marker-based replacement ──

export const replaceBetweenMarkers = (
  source: string,
  startMarker: string,
  endMarker: string,
  replacement: string
): string | null => {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    return null; // marker block not found, caller should handle
  }
  const before = source.slice(0, startIndex + startMarker.length);
  const after = source.slice(endIndex);
  return `${before}\n${replacement.trim()}\n${after}`;
};

// ── Validation ──

// Tags that should be strictly balanced (any imbalance is an error)
const STRICT_TAGS = ["div", "section", "main", "ul", "ol", "li", "table", "thead", "tbody", "tr", "p", "h1", "h2", "h3", "h4", "h5", "h6", "article", "header", "footer", "aside", "figure", "figcaption", "blockquote"];

const SCRIPT_SRC_RE = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const REMOTE_SCRIPT_OR_LINK_RE = /<(script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+["'][^>]*>/i;
const HIDDEN_STYLE_RULE_RE = /(?:^|[;}])\s*[^{}]+\{\s*[^{}]*(?:opacity\s*:\s*0(?:\.0+)?|visibility\s*:\s*hidden)[^{}]*\}/i;

const isAllowedRuntimeAsset = (src: string): boolean => {
  const normalized = src.trim().toLowerCase();
  const clean = normalized.split("?")[0].split("#")[0];
  return (
    clean.endsWith("/assets/anime.v4.js") ||
    clean.endsWith("./assets/anime.v4.js") ||
    clean.endsWith("assets/anime.v4.js") ||
    clean.endsWith("/assets/ppt-runtime.js") ||
    clean.endsWith("./assets/ppt-runtime.js") ||
    clean.endsWith("assets/ppt-runtime.js") ||
    clean.endsWith("/assets/chart.v4.js") ||
    clean.endsWith("./assets/chart.v4.js") ||
    clean.endsWith("assets/chart.v4.js") ||
    clean.endsWith("/assets/tailwindcss.v3.js") ||
    clean.endsWith("./assets/tailwindcss.v3.js") ||
    clean.endsWith("assets/tailwindcss.v3.js")
  );
};

export const validateHtmlContent = (html: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  const hasUnqualifiedCall = (fnName: string): boolean =>
    new RegExp(`(^|[^\\w$.])${fnName}\\s*\\(`, "m").test(html);
  if (!html || html.trim().length === 0) {
    errors.push("HTML 内容为空");
    return { valid: false, errors };
  }
  // Strict new-structure mode: content must be a page fragment only.
  if (/<\!doctype[\s>]/i.test(html)) {
    errors.push("检测到 <!doctype>。请仅传页面主体片段，不要传完整文档。");
  }
  if (/<html[\s>]/i.test(html) || /<\/html>/i.test(html)) {
    errors.push("检测到 <html> 标签。请仅传页面主体片段，不要传完整文档。");
  }
  if (/<head[\s>]/i.test(html) || /<\/head>/i.test(html)) {
    errors.push("检测到 <head> 标签。请仅传页面主体片段，不要传完整文档。");
  }
  if (/<body[\s>]/i.test(html) || /<\/body>/i.test(html)) {
    errors.push("检测到 <body> 标签。请仅传页面主体片段，不要传完整文档。");
  }
  if (/<meta[\s>]/i.test(html)) {
    errors.push("检测到 <meta> 标签。页面片段中禁止包含 head 元信息。");
  }
  if (/<title[\s>]/i.test(html) || /<\/title>/i.test(html)) {
    errors.push("检测到 <title> 标签。页面片段中禁止包含标题标签。");
  }
  if (/<link[\s>]/i.test(html)) {
    errors.push("检测到 <link> 标签。页面片段中禁止包含外部资源链接。");
  }
  if (/data-ppt-guard-root\s*=\s*["']1["']/i.test(html)) {
    errors.push("检测到 data-ppt-guard-root。禁止传入页面骨架根节点，请仅传主体片段。");
  }
  if (/\bppt-page-root\b/i.test(html) || /\bppt-page-content\b/i.test(html) || /\bppt-page-fit-scope\b/i.test(html)) {
    errors.push("检测到页面骨架类（ppt-page-root/content/fit-scope）。请仅传主体片段。");
  }
  if (/<script[^>]*id=["']ppt-(?:page-fit|default-motion|page-guard-style)["'][^>]*>/i.test(html)) {
    errors.push("检测到内置运行时脚本/样式块。请不要自行注入，系统会自动注入。");
  }
  if (/<iframe[\s>]/gi.test(html)) {
    errors.push("内容中包含 iframe 标签，页面内不允许嵌套 iframe");
  }
  const scriptSrcHits = Array.from(html.matchAll(SCRIPT_SRC_RE)).map((m) => (m[1] || "").trim());
  if (scriptSrcHits.length > 0) {
    errors.push("检测到 <script src=...>。页面片段禁止引入脚本资源，运行时已预注入。");
  }
  const disallowedScriptSrc = scriptSrcHits.filter((src) => !isAllowedRuntimeAsset(src));
  if (disallowedScriptSrc.length > 0) {
    const preview = disallowedScriptSrc.slice(0, 3).join(", ");
    errors.push(
      `检测到不允许的 script src：${preview}。仅允许 ./assets/anime.v4.js、./assets/ppt-runtime.js、./assets/chart.v4.js、./assets/tailwindcss.v3.js`
    );
  }
  if (/anime\s*\(\s*\{[\s\S]{0,240}?targets\s*:/im.test(html)) {
    errors.push("检测到旧版 anime({ targets, ... }) 写法，请统一改为 PPT.animate(...)（v4）");
  }
  if (/(^|[^\w$])anime\.(?:animate|stagger|createTimeline|timeline)\s*\(/i.test(html)) {
    errors.push("检测到直接 anime.* 调用，请统一改为 PPT.animate/PPT.stagger/PPT.createTimeline");
  }
  if (/PPT\.animate\s*\(\s*\{[\s\S]{0,240}?targets\s*:/im.test(html)) {
    errors.push("检测到 PPT.animate({ targets, ... }) 写法，请改为 PPT.animate(targets, params)");
  }
  if (hasUnqualifiedCall("animate") || hasUnqualifiedCall("stagger") || hasUnqualifiedCall("createTimeline")) {
    errors.push("检测到未命名空间的动画调用（animate/stagger/createTimeline），请统一改为 PPT.*");
  }
  if (/new\s+Chart\s*\(/i.test(html)) {
    errors.push("检测到直接 new Chart(...) 调用，请统一改为 PPT.createChart(canvasOrSelector, config)");
  }
  if (/<[^>]*$/.test(html.trim())) {
    errors.push("HTML 末尾存在未闭合标签，内容可能被截断");
  }
  const normalized = html.trim();
  if (/<html[\s>]/i.test(normalized) && !/<\/html>\s*$/i.test(normalized)) {
    errors.push("检测到 <html> 但缺少结尾 </html>，内容可能被截断");
  }
  if (/<body[\s>]/i.test(normalized) && !/<\/body>/i.test(normalized)) {
    errors.push("检测到 <body> 但缺少 </body>，内容可能被截断");
  }

  // Remove comments/script/style to avoid counting pseudo tags in JS/CSS/comment text.
  const structuralHtml = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // Check for orphan closing tags (closing tag without a matching open)
  for (const tag of STRICT_TAGS) {
    const opens = (structuralHtml.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
    const closes = (structuralHtml.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    if (opens < closes) {
      errors.push(`</${tag}> 闭标签多于开标签（${opens} 个开, ${closes} 个闭），可能是内容被截断`);
    } else if (opens !== closes) {
      errors.push(`<${tag}> 开闭标签数量不一致（${opens} 个开, ${closes} 个闭），内容可能被截断`);
    }
  }
  return { valid: errors.length === 0, errors };
};

export const validatePersistedPageHtml = (
  html: string,
  pageId: string
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!html || html.trim().length === 0) {
    return { valid: false, errors: [`${pageId}.html 内容为空`] };
  }
  if (html.includes("等待模型填充这一页内容")) {
    errors.push("仍包含页面占位文案");
  }
  if (REMOTE_SCRIPT_OR_LINK_RE.test(html)) {
    errors.push("包含远程 script/link 资源");
  }

  const $ = cheerio.load(html, { scriptingEnabled: false });
  $("style").each((_, node) => {
    const css = $(node).text();
    if (HIDDEN_STYLE_RULE_RE.test(css)) {
      errors.push("样式块包含默认隐藏态规则，可能导致内容不可见");
      return false;
    }
    return undefined;
  });
  $("[class], [style]").each((_, node) => {
    const el = $(node);
    const classRaw = el.attr("class") || "";
    const styleRaw = el.attr("style") || "";
    if (/\bopacity-0\b|\binvisible\b/i.test(classRaw)) {
      errors.push("包含默认隐藏态 class，可能导致内容不可见");
      return false;
    }
    if (/visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?(?:;|$)/i.test(styleRaw)) {
      errors.push("包含默认隐藏态 style，可能导致内容不可见");
      return false;
    }
    return undefined;
  });
  const root = $('.ppt-page-root[data-ppt-guard-root="1"]').first();
  if (!root.length) {
    errors.push("缺少 .ppt-page-root[data-ppt-guard-root=\"1\"]");
  }
  const content = $(".ppt-page-content").first();
  if (!content.length) {
    errors.push("缺少 .ppt-page-content");
  }
  if ($('[data-role="title"]').length < 1) {
    errors.push("缺少 data-role=\"title\" 语义区");
  }
  if ($('[data-role="content"]').length < 1) {
    errors.push("缺少 data-role=\"content\" 语义区");
  }
  if ($("[data-block-id]").length < 2) {
    errors.push("data-block-id 可编辑块少于 2 个");
  }

  $("canvas").each((index, node) => {
    let current = $(node).parent();
    if (!current.length) {
      errors.push(`第 ${index + 1} 个 canvas 缺少父容器`);
      return;
    }
    let hasHeight = false;
    for (let depth = 0; depth < 3 && current.length; depth += 1) {
      const className = current.attr("class") || "";
      const style = current.attr("style") || "";
      const hasHeightClass = className
        .split(/\s+/)
        .some((cls) => /^h-/.test(cls) || /^min-h-/.test(cls) || /^max-h-/.test(cls));
      const hasHeightStyle = /(?:^|;)\s*(?:height|min-height|max-height)\s*:/.test(style);
      if (hasHeightClass || hasHeightStyle) {
        hasHeight = true;
        break;
      }
      current = current.parent();
    }
    if (!hasHeight) {
      errors.push(`第 ${index + 1} 个 canvas 近层容器缺少明确高度`);
    }
  });

  return { valid: errors.length === 0, errors };
};

// ── Section content normalization ──

export const normalizeSectionContent = (pageId: string, html: string): string => {
  const trimmed = html.trim();
  const bodyHtml = extractBodyHtml(trimmed);
  const css = extractStyleCss(trimmed);
  const normalizedBody = (bodyHtml || trimmed).trim();
  const normalizedCss = normalizePageCss(css);
  if (!normalizedCss) return normalizedBody;
  return `<style data-page-style="${pageId}">
${normalizedCss}
</style>
${normalizedBody}`;
};

// ── Re-export markers for convenience ──

export {
  SHARED_PAGE_STYLES_START,
  SHARED_PAGE_STYLES_END,
  pageContentStartMarker,
  pageContentEndMarker,
};
