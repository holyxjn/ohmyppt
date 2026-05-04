import fs from 'fs'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import * as cheerio from 'cheerio'
import log from 'electron-log/main.js'
import type { SessionDeckGenerationContext } from './types'
import { validateHtmlContent, validatePersistedPageHtml } from './html-utils'
import { buildSessionAssetHeadTags } from '../ipc/page-assets'
import { normalizeCreativePageFragment } from './page-fragment-normalizer'

const uiText = (locale: 'zh' | 'en' | undefined, zh: string, en: string): string =>
  locale === 'en' ? en : zh

export const BASE_PAGE_STYLE_TAG = `<style id="ppt-page-guard-style">
  :root {
    --ppt-page-bg: #ffffff;
  }
  html, body {
    margin: 0;
    width: 1600px;
    height: 900px;
    overflow: hidden;
    font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    background: var(--ppt-page-bg);
    color: #0f172a;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .ppt-page-root[data-ppt-guard-root="1"] {
    position: relative;
    width: 1600px;
    height: 900px;
    overflow: hidden;
    isolation: isolate;
    background: var(--ppt-page-bg);
  }
  .ppt-page-root.p-2 { padding: 0.5rem; }
  .ppt-page-root.p-8 { padding: 2rem; }
  .ppt-page-root.p-12 { padding: 3rem; }
  .ppt-page-root[data-ppt-guard-root="1"]:not(.p-2):not(.p-8):not(.p-12) {
    padding: 0.5rem;
  }
  body > .ppt-page-root:not([data-ppt-guard-root="1"]):not(.p-2):not(.p-8):not(.p-12) {
    padding: 0.5rem;
  }
  .ppt-page-fit-scope {
    position: relative;
    width: 100%;
    height: 100%;
    transform-origin: top left;
    overflow: hidden;
  }
  .ppt-page-content {
    width: 100%;
    height: 100%;
    min-height: 100%;
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    overflow: hidden;
  }
  .ppt-page-content > [data-page-scaffold="1"] {
    width: 100%;
    min-height: 100%;
    height: 100%;
  }
  .ppt-page-content canvas {
    display: block;
    width: 100%;
    height: 100%;
    max-width: 100% !important;
    max-height: 100% !important;
  }
  .ppt-page-content .ppt-chart-frame {
    position: relative;
    min-width: 0;
    overflow: hidden;
  }
  .ppt-page-content .ppt-chart-frame > canvas {
    width: 100% !important;
    height: 100% !important;
  }
  .ppt-page-content [data-block-id*="chart"],
  .ppt-page-content [data-block-id*="graph"],
  .ppt-page-content [data-block-id*="plot"] {
    min-height: 240px;
    min-width: 0;
  }
  [data-role="title"] h1,
  header[data-block-id="title"] h1 {
    font-size: 48px !important;
    line-height: 1.2 !important;
  }
  [data-role="title"] h1.text-5xl,
  header[data-block-id="title"] h1.text-5xl {
    font-size: 48px !important;
  }
</style>`

export const FIT_SCRIPT = `<script id="ppt-page-fit">
(() => {
  const WIDTH = 1600;
  const HEIGHT = 900;
  const MIN_FONT = 14;
  const search = new URLSearchParams(window.location.search);
  const disableFit = search.get("fit") === "off";
  const findRoot = () =>
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector(".ppt-page-root");

  function fitPage() {
    const root = findRoot();
    if (!root) return;

    // Check if a scope wrapper already exists.
    let scope = root.querySelector(":scope > .ppt-page-fit-scope");
    let content = null;
    if (scope) {
      content =
        scope.querySelector(":scope > .ppt-page-content") ||
        scope.querySelector(".ppt-page-content") ||
        scope;
    }

    if (!scope) {
      const directElementChildren = Array.from(root.children);
      const singleContentChild =
        directElementChildren.length === 1 &&
        directElementChildren[0].classList.contains("ppt-page-content")
          ? directElementChildren[0]
          : null;

      if (singleContentChild) {
        content = singleContentChild;
      } else {
        // First time: wrap all children in a container div so orphaned closing tags
        // (e.g. stray </div>, </main>) become text nodes INSIDE the container,
        // not siblings that break the DOM structure.
        const container = document.createElement("div");
        container.className = "ppt-page-content";
        container.style.cssText = "white-space:normal;word-wrap:normal;";
        while (root.firstChild) {
          container.appendChild(root.firstChild);
        }
        content = container;
      }

      const scopeEl = document.createElement("div");
      scopeEl.className = "ppt-page-fit-scope";
      scopeEl.appendChild(content);
      root.appendChild(scopeEl);
      scope = scopeEl;
    }

    scope.style.transform = "scale(1)";
    if (disableFit) {
      return;
    }
    const targetWidth = Math.max(1, Math.floor(scope.clientWidth || root.clientWidth || WIDTH));
    const targetHeight = Math.max(1, Math.floor(scope.clientHeight || root.clientHeight || HEIGHT));
    let guard = 0;
    const measuredContent = content || scope;
    const textNodes = measuredContent.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, .text");
    while ((measuredContent.scrollWidth > targetWidth || measuredContent.scrollHeight > targetHeight) && guard < 12) {
      let changed = false;
      textNodes.forEach((node) => {
        const size = Number.parseFloat(getComputedStyle(node).fontSize || "16");
        if (Number.isFinite(size) && size > MIN_FONT) {
          node.style.fontSize = Math.max(MIN_FONT, Math.floor(size * 0.94)) + "px";
          changed = true;
        }
      });
      if (!changed) break;
      guard += 1;
    }

    const scale = Math.min(
      1,
      targetWidth / Math.max(measuredContent.scrollWidth, 1),
      targetHeight / Math.max(measuredContent.scrollHeight, 1)
    );
    scope.style.transform = "scale(" + scale.toFixed(4) + ")";
  }

  window.addEventListener("load", () => requestAnimationFrame(fitPage), { once: true });
  window.addEventListener("resize", fitPage);
})();
</script>`

const DEFAULT_MOTION_SCRIPT = `<script id="ppt-default-motion">
(() => {
  const search = new URLSearchParams(window.location.search);
  if (search.get("print") === "1" || search.get("export") === "1") {
    document.documentElement.dataset.pptExportStatic = "1";
    return;
  }

  function revealFallback(root) {
    const hiddenTargets = Array.from(root.querySelectorAll("*"))
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) === 0;
      })
      .slice(0, 120);
    hiddenTargets.forEach((el, i) => {
      const node = el;
      node.style.transition = "opacity 300ms ease, transform 300ms ease";
      if (!node.style.transform || node.style.transform === "none") {
        node.style.transform = "translateY(0)";
      }
      window.setTimeout(() => {
        node.style.opacity = "1";
      }, i * 8);
    });
  }

  function runMotion() {
    const root = document.querySelector(".ppt-page-root");
    if (!root) return;
    const targets = Array.from(
      root.querySelectorAll(".opacity-0, [data-anime], [data-animate], h1, h2, h3, p, li, .card, .panel, .text-section, .diagram-section, .timeline-node, section, section > *")
    ).slice(0, 16);
    if (targets.length === 0) {
      revealFallback(root);
      return;
    }
    const pptApi = globalThis.PPT;
    if (pptApi && typeof pptApi.animate === "function") {
      try {
        pptApi.animate(targets, {
          opacity: [0, 1],
          translateY: [20, 0],
          easing: "easeOutCubic",
          duration: 560,
          delay: (_el, i) => i * 45,
        });
        // If custom animation failed and left nodes hidden, force visibility once.
        window.setTimeout(() => revealFallback(root), 720);
        return;
      } catch (_err) {
        revealFallback(root);
        return;
      }
    }
    targets.forEach((el, i) => {
      const node = el;
      node.style.opacity = "0";
      node.style.transform = "translateY(14px)";
      node.style.transition = "opacity 420ms ease, transform 420ms ease";
      window.setTimeout(() => {
        node.style.opacity = "1";
        node.style.transform = "translateY(0)";
      }, i * 40);
    });
    revealFallback(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runMotion, { once: true });
  } else {
    runMotion();
  }
})();
</script>`

const writeLocks = new Map<string, Promise<void>>()

export function serializedWrite<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const chain = writeLocks.get(lockKey) || Promise.resolve()
  const run = chain.then(fn)
  const next = run.then(
    () => undefined,
    () => undefined
  )
  writeLocks.set(lockKey, next)
  return run.finally(() => {
    if (writeLocks.get(lockKey) === next) {
      writeLocks.delete(lockKey)
    }
  })
}

export function getAgentNameFromToolConfig(config: unknown): string | undefined {
  const maybe = config as Record<string, unknown> | undefined
  const metadata = maybe?.metadata as Record<string, unknown> | undefined
  const configurable = maybe?.configurable as Record<string, unknown> | undefined
  const fromMetadata = metadata?.lc_agent_name
  const fromConfigurable = configurable?.lc_agent_name
  if (typeof fromMetadata === 'string' && fromMetadata.trim().length > 0) return fromMetadata.trim()
  if (typeof fromConfigurable === 'string' && fromConfigurable.trim().length > 0)
    return fromConfigurable.trim()
  return undefined
}

function extractBackgroundStyle(styleAttr: string): string {
  const declarations = styleAttr
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
  const kept = declarations.filter((decl) => {
    const normalized = decl.toLowerCase().replace(/\s+/g, ' ')
    return (
      normalized.startsWith('background:') ||
      normalized.startsWith('background-color:') ||
      normalized.startsWith('background-image:')
    )
  })
  return kept.join('; ')
}

function isBackgroundUtilityClass(cls: string): boolean {
  const base = cls.split(':').pop() || cls
  return (
    base.startsWith('bg-') ||
    base.startsWith('from-') ||
    base.startsWith('via-') ||
    base.startsWith('to-')
  )
}

function syncRootBackgroundFromScaffold(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false })
    const root = $('.ppt-page-root[data-ppt-guard-root="1"]').first()
    if (!root.length) return html

    const scaffold = root.find('[data-page-scaffold="1"]').first()
    if (!scaffold.length) return html

    const rootClassRaw = (root.attr('class') || '').trim()
    const rootClasses = rootClassRaw.split(/\s+/).filter(Boolean)
    const rootHasBgClass = rootClasses.some((cls) => isBackgroundUtilityClass(cls))

    if (!rootHasBgClass) {
      const scaffoldClassRaw = (scaffold.attr('class') || '').trim()
      const scaffoldBgClasses = scaffoldClassRaw
        .split(/\s+/)
        .filter(Boolean)
        .filter((cls) => isBackgroundUtilityClass(cls))
      if (scaffoldBgClasses.length > 0) {
        const classSet = new Set(rootClasses)
        for (const cls of scaffoldBgClasses) classSet.add(cls)
        root.attr('class', Array.from(classSet).join(' '))
      }
    }

    const rootStyleRaw = (root.attr('style') || '').trim()
    const rootBgStyle = extractBackgroundStyle(rootStyleRaw)
    if (!rootBgStyle) {
      const scaffoldStyleRaw = (scaffold.attr('style') || '').trim()
      const scaffoldBgStyle = extractBackgroundStyle(scaffoldStyleRaw)
      if (scaffoldBgStyle) {
        const finalStyle = [rootStyleRaw, scaffoldBgStyle].filter(Boolean).join('; ')
        root.attr('style', finalStyle)
      }
    }

    return $.html()
  } catch {
    return html
  }
}

function stripUnsafeHiddenStates(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false })
    $('*').each((_, node) => {
      const el = $(node)

      const classRaw = (el.attr('class') || '').trim()
      if (classRaw) {
        const kept = classRaw
          .split(/\s+/)
          .filter(Boolean)
          .filter((cls) => {
            const base = cls.split(':').pop() || cls
            return base !== 'opacity-0' && base !== 'invisible'
          })
        if (kept.length > 0) {
          el.attr('class', kept.join(' '))
        } else {
          el.removeAttr('class')
        }
      }

      const styleRaw = (el.attr('style') || '').trim()
      if (styleRaw) {
        const keptDecls = styleRaw
          .split(';')
          .map((decl) => decl.trim())
          .filter(Boolean)
          .filter((decl) => {
            const idx = decl.indexOf(':')
            if (idx < 0) return true
            const key = decl.slice(0, idx).trim().toLowerCase()
            const value = decl
              .slice(idx + 1)
              .trim()
              .toLowerCase()
            if (key === 'opacity' && /^0(?:\.0+)?$/.test(value)) return false
            if (key === 'visibility' && value === 'hidden') return false
            return true
          })
        if (keptDecls.length > 0) {
          el.attr('style', keptDecls.join('; '))
        } else {
          el.removeAttr('style')
        }
      }
    })
    return $.html()
  } catch {
    return html
  }
}

const CANVAS_LOCK_CLASS_PATTERNS = [
  /^(w|h|min-w|min-h|max-w|max-h)-\[(1600px|900px|100vw|100vh|100dvw|100dvh)\]$/i,
  /^(w|h|min-w|min-h|max-w|max-h)-screen$/i,
  /^aspect-\[(16\/9|1600\/900)\]$/i,
  /^size-\[(1600px|900px)\]$/i
]

function stripCanvasLockClasses(classAttr: string): string {
  const classes = classAttr.split(/\s+/).filter(Boolean)
  const kept = classes.filter(
    (cls) => !CANVAS_LOCK_CLASS_PATTERNS.some((pattern) => pattern.test(cls))
  )
  return kept.join(' ')
}

function stripCanvasInlineSizes(styleAttr: string): string {
  const declarations = styleAttr
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
  const kept = declarations.filter((decl) => {
    const normalized = decl.toLowerCase().replace(/\s+/g, ' ')
    if (/^(width|min-width|max-width): (1600px|100vw|100dvw)$/.test(normalized)) return false
    if (/^(height|min-height|max-height): (900px|100vh|100dvh)$/.test(normalized)) return false
    return true
  })
  return kept.join('; ')
}

function stripCanvasLockStyles(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false })
    $('[class]').each((_, node) => {
      const classValue = ($(node).attr('class') || '').trim()
      if (!classValue) return
      const cleaned = stripCanvasLockClasses(classValue)
      if (cleaned.length > 0) {
        $(node).attr('class', cleaned)
      } else {
        $(node).removeAttr('class')
      }
    })
    $('[style]').each((_, node) => {
      const styleValue = ($(node).attr('style') || '').trim()
      if (!styleValue) return
      const cleaned = stripCanvasInlineSizes(styleValue)
      if (cleaned.length > 0) {
        $(node).attr('style', cleaned)
      } else {
        $(node).removeAttr('style')
      }
    })
    return $.html()
  } catch {
    return html
  }
}

const REMOTE_RUNTIME_RESOURCE_RE =
  /<(script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+["'][^>]*>/gi

export function extractRemoteRuntimeResources(content: string): string[] {
  const hits: string[] = []
  let match: RegExpExecArray | null
  REMOTE_RUNTIME_RESOURCE_RE.lastIndex = 0
  while ((match = REMOTE_RUNTIME_RESOURCE_RE.exec(content)) !== null) {
    const raw = match[0].replace(/\s+/g, ' ').trim()
    hits.push(raw.length > 200 ? `${raw.slice(0, 200)}…` : raw)
    if (hits.length >= 8) break
  }
  return hits
}

const CHART_FRAME_CLASS = 'ppt-chart-frame'
const CHART_FRAME_DEFAULT_HEIGHT_CLASS = 'h-[240px]'

function splitClassNames(classRaw: string): string[] {
  return classRaw
    .split(/\s+/)
    .map((cls) => cls.trim())
    .filter(Boolean)
}

function classBaseName(cls: string): string {
  return cls.split(':').pop() || cls
}

function isChartCanvasLayoutClass(cls: string): boolean {
  const base = classBaseName(cls)
  return base === 'flex-1' || /^h-/.test(base) || /^min-h-/.test(base) || /^max-h-/.test(base)
}

function isMarginUtilityClass(cls: string): boolean {
  return /^-?m[trblxy]?-[^\s]+$/.test(classBaseName(cls))
}

function hasConcreteChartHeightClass(classes: Iterable<string>): boolean {
  return Array.from(classes).some((cls) => {
    const base = classBaseName(cls)
    if (/^(?:h|min-h)-(?:full|screen|dvh|svh|lvh|auto)$/.test(base)) return false
    return /^(?:h|min-h)-(?:\[[^\]]+\]|(?!0\b)\d+)/.test(base)
  })
}

function hasConcreteChartHeightStyle(styleRaw: string): boolean {
  return /(?:^|;)\s*(?:height|min-height)\s*:\s*(?!\s*(?:auto|0(?:px|rem|em|%)?|100%|inherit|initial|unset)\b)[^;]+/i.test(
    styleRaw
  )
}

function stabilizeChartCanvases(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false })
    $('canvas').each((_, node) => {
      const canvas = $(node)
      const originalCanvasClasses = splitClassNames(canvas.attr('class') || '')
      const wrapperClasses = originalCanvasClasses.filter(isMarginUtilityClass)
      const canvasClassSet = new Set(
        originalCanvasClasses.filter(
          (cls) => !isChartCanvasLayoutClass(cls) && !isMarginUtilityClass(cls)
        )
      )
      canvasClassSet.add('h-full')
      canvasClassSet.add('w-full')
      canvas.attr('class', Array.from(canvasClassSet).join(' '))

      const parent = canvas.parent()
      if (!parent.length) return

      const parentClassRaw = (parent.attr('class') || '').trim()
      const parentClassSet = new Set(parentClassRaw.split(/\s+/).filter(Boolean))
      const parentStyle = parent.attr('style') || ''
      const hasHeightClass = hasConcreteChartHeightClass(parentClassSet)
      const hasHeightStyle = hasConcreteChartHeightStyle(parentStyle)
      const parentElementChildren = parent.children()
      const parentIsDedicatedFrame =
        parentElementChildren.length === 1 && parentElementChildren.get(0) === canvas.get(0)

      if (parentIsDedicatedFrame && (hasHeightClass || hasHeightStyle)) {
        parentClassSet.add(CHART_FRAME_CLASS)
        parentClassSet.add('relative')
        parentClassSet.add('min-w-0')
        parentClassSet.add('overflow-hidden')
        parent.attr('class', Array.from(parentClassSet).join(' '))
        return
      }

      const frame = $('<div></div>')
      const frameClassSet = new Set([
        CHART_FRAME_CLASS,
        'relative',
        CHART_FRAME_DEFAULT_HEIGHT_CLASS,
        'w-full',
        'min-w-0',
        'overflow-hidden',
        ...wrapperClasses
      ])
      frame.attr('class', Array.from(frameClassSet).join(' '))
      canvas.before(frame)
      frame.append(canvas)
    })
    return $.html()
  } catch {
    return html
  }
}

function hasCustomPageAnimation(html: string): boolean {
  return (
    /(?:anime\s*\(|anime\.(?:createTimeline|timeline|animate|stagger)\s*\()/m.test(html) ||
    /PPT\.(?:animate|stagger|createTimeline)\s*\(/m.test(html) ||
    /data-(?:anime|animate)\b/i.test(html)
  )
}

const normalizeAndInjectPageRuntime = (content: string, pageId: string): string => {
  const fragment = normalizeCreativePageFragment(
    stripUnsafeHiddenStates(stabilizeChartCanvases(stripCanvasLockStyles(content.trim())))
  )
  const output = buildScaffoldDocument({
    pageId,
    innerContent: fragment,
    includeDefaultMotion: !hasCustomPageAnimation(content)
  })
  return syncRootBackgroundFromScaffold(output)
}

function buildScaffoldDocument(args: {
  pageId: string
  innerContent: string
  includeDefaultMotion: boolean
}): string {
  const { pageId, innerContent, includeDefaultMotion } = args
  const motionScript = includeDefaultMotion ? `\n    ${DEFAULT_MOTION_SCRIPT}` : ''
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${buildSessionAssetHeadTags()}
    ${BASE_PAGE_STYLE_TAG}
  </head>
  <body data-page-id="${pageId}">
    <main class="ppt-page-root p-2" data-ppt-guard-root="1">
      <div class="ppt-page-fit-scope">
        <div class="ppt-page-content">
          ${innerContent}
        </div>
      </div>
    </main>
    ${FIT_SCRIPT}
    ${motionScript}
  </body>
</html>`
}

type EmitNormalizedToolStatus = (
  config: unknown,
  status: {
    label: string
    detail?: string
    progress?: number
    pageId?: string
    agentName?: string
  }
) => void

export function createPageWriteTools(args: {
  context: SessionDeckGenerationContext
  isEditMode: boolean
  isMainScopeEdit: boolean
  emitNormalizedToolStatus: EmitNormalizedToolStatus
}): unknown[] {
  const { context, isEditMode, isMainScopeEdit, emitNormalizedToolStatus } = args
  const scopedPageIdsForWrite = (
    Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0
      ? context.allowedPageIds.filter((pid) => Boolean(context.pageFileMap[pid]))
      : Object.keys(context.pageFileMap)
  ).sort((a, b) => {
    const an = Number(a.match(/^page-(\d+)$/i)?.[1] || 0)
    const bn = Number(b.match(/^page-(\d+)$/i)?.[1] || 0)
    return an - bn
  })
  let autoPageCursor = 0
  const writtenPageIds = new Set<string>()

  const resolveSingleTargetPageId = (): string | undefined => {
    if (context.selectedPageId && context.pageFileMap[context.selectedPageId]) {
      return context.selectedPageId
    }
    if (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length === 1) {
      const only = context.allowedPageIds[0]
      if (context.pageFileMap[only]) return only
    }
    return undefined
  }

  const resolveWriteTargetPage = (
    requestedPageId?: string
  ): { pageId: string; isAuto: boolean } => {
    if (requestedPageId && requestedPageId.trim().length > 0) {
      return { pageId: requestedPageId.trim(), isAuto: false }
    }
    const singleTarget = resolveSingleTargetPageId()
    if (singleTarget) return { pageId: singleTarget, isAuto: false }
    if (scopedPageIdsForWrite.length === 0) {
      throw new Error('当前会话没有可写入页面。')
    }
    if (scopedPageIdsForWrite.every((pid) => writtenPageIds.has(pid))) {
      throw new Error(
        '当前作用域内页面已经全部写入。请调用 verify_completion() 校验，不要继续自动写入。'
      )
    }
    while (
      autoPageCursor < scopedPageIdsForWrite.length - 1 &&
      writtenPageIds.has(scopedPageIdsForWrite[autoPageCursor])
    ) {
      autoPageCursor += 1
    }
    const idx = Math.min(autoPageCursor, scopedPageIdsForWrite.length - 1)
    const picked = scopedPageIdsForWrite[idx]
    return { pageId: picked, isAuto: true }
  }

  const writePageFile = async (writeArgs: {
    pageId?: string
    content: string
    config: unknown
    statusLabel?: string
  }): Promise<string> => {
    if (isMainScopeEdit) {
      throw new Error(
        '当前为主会话编辑（main），只允许调用 set_index_transition(type, durationMs)。'
      )
    }
    const { pageId, content, config, statusLabel } = writeArgs
    const { pageId: resolvedPageId, isAuto } = resolveWriteTargetPage(pageId)
    const agentName = getAgentNameFromToolConfig(config)
    if (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length > 0) {
      if (!context.allowedPageIds.includes(resolvedPageId)) {
        throw new Error(
          `当前任务仅允许修改: ${context.allowedPageIds.join(', ')}；收到: ${resolvedPageId}`
        )
      }
    }
    const remoteResources = extractRemoteRuntimeResources(content)
    if (remoteResources.length > 0) {
      const detail = `检测到 ${remoteResources.length} 个远程 script/link 资源。仅允许使用系统预注入的本地 ./assets/*`
      emitNormalizedToolStatus(config, {
        label: `外链资源校验失败 ${resolvedPageId}`,
        detail,
        progress: 60,
        pageId: resolvedPageId
      })
      throw new Error(
        [
          `检测到禁止的 CDN/远程资源引用 (${resolvedPageId})，已拒绝写入。`,
          '请移除所有 script/link 的 http(s) 或 // 外链，仅使用系统预注入的本地 ./assets/* 资源。',
          '示例命中：',
          ...remoteResources.map((item) => `- ${item}`)
        ].join('\n')
      )
    }
    const validation = validateHtmlContent(content)
    if (!validation.valid) {
      emitNormalizedToolStatus(config, {
        label: `验证失败 ${resolvedPageId}`,
        detail: validation.errors.join('; '),
        progress: 60,
        pageId: resolvedPageId
      })
      throw new Error(
        `HTML 验证失败 (${resolvedPageId}): ${validation.errors.join('; ')}。请修正后重试。`
      )
    }
    const targetPath = context.pageFileMap[resolvedPageId]
    if (!targetPath) {
      throw new Error(
        `未知页面 ${resolvedPageId}，可用页面: ${Object.keys(context.pageFileMap).join(', ')}`
      )
    }
    emitNormalizedToolStatus(config, {
      label:
        statusLabel ||
        uiText(context.appLocale, `更新 ${resolvedPageId}`, `Updating ${resolvedPageId}`),
      detail: uiText(context.appLocale, '正在写入对应 page 文件', 'Writing the target page file'),
      pageId: resolvedPageId,
      agentName
    })
    const result = await serializedWrite(context.projectDir, async () => {
      const normalized = normalizeAndInjectPageRuntime(content, resolvedPageId)
      const persistedValidation = validatePersistedPageHtml(normalized, resolvedPageId)
      if (!persistedValidation.valid) {
        emitNormalizedToolStatus(config, {
          label: `落盘校验失败 ${resolvedPageId}`,
          detail: persistedValidation.errors.join('; '),
          progress: 60,
          pageId: resolvedPageId
        })
        throw new Error(
          `HTML 落盘校验失败 (${resolvedPageId}): ${persistedValidation.errors.join('; ')}。请修正页面片段后重试。`
        )
      }
      await fs.promises.writeFile(targetPath, normalized, 'utf-8')
      return `Updated ${resolvedPageId} in ${targetPath}`
    })
    writtenPageIds.add(resolvedPageId)
    if (isAuto) {
      autoPageCursor = Math.min(autoPageCursor + 1, scopedPageIdsForWrite.length)
    }
    log.info('[deepagent] update_page_file', {
      sessionId: context.sessionId,
      pageId: resolvedPageId,
      targetPath,
      agentName: agentName || 'unknown',
      allowedPageIds: context.allowedPageIds || null
    })
    return result
  }

  if (isMainScopeEdit || (isEditMode && context.selectedSelector?.trim())) {
    return []
  }

  const singleTargetPageId = resolveSingleTargetPageId()
  if (singleTargetPageId) {
    return [
      tool(
        async ({ pageId, content }, config) => {
          const targetPageId = resolveSingleTargetPageId()
          if (!targetPageId) {
            throw new Error(
              isEditMode
                ? '当前会话未锁定单页。请改用 update_page_file(pageId, content) 并显式传 pageId，或在上下文中指定 selectedPageId。'
                : '当前会话未锁定单页。请改用 update_page_file(content) 或在上下文中指定 selectedPageId。'
            )
          }
          if (targetPageId && pageId !== targetPageId) {
            throw new Error(`单页编辑工具仅允许目标页面 ${targetPageId}；收到: ${pageId}`)
          }
          return writePageFile({
            pageId,
            content,
            config,
            statusLabel: uiText(context.appLocale, `更新单页 ${pageId}`, `Updating ${pageId}`)
          })
        },
        {
          name: 'update_single_page_file',
          description:
            'Single-page edit tool. Pass pageId and content explicitly; the tool validates pageId against the current single-page context to avoid modifying other pages.',
          schema: z.object({
            pageId: z
              .string()
              .describe(
                'Target pageId, such as page-5. It must match the current single-page context.'
              ),
            content: z
              .string()
              .describe(
                'Complete creative page HTML fragment only. The tool will add section[data-page-scaffold], main[data-role="content"], editable data-block-id attributes, and the runtime page frame when needed. Do not pass <!doctype>, <html>, <head>, <body>, .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, data-ppt-guard-root, or any runtime shell markup.'
              )
          })
        }
      )
    ]
  }

  return [
    tool(
      async ({ pageId, content }, config) => {
        if (isEditMode && (!pageId || pageId.trim().length === 0)) {
          throw new Error(
            '编辑模式调用 update_page_file 时必须显式传 pageId，避免自动游标误写到其它页面。'
          )
        }
        const singleTargetPageId = resolveSingleTargetPageId()
        if (singleTargetPageId) {
          throw new Error(
            `当前为单页上下文（${singleTargetPageId}），禁止调用 update_page_file。请改用 update_single_page_file(pageId, content)。`
          )
        }
        return writePageFile({
          pageId,
          content,
          config
        })
      },
      {
        name: 'update_page_file',
        description:
          'Multi-page generation/global edit tool. Disabled in single-page context. In generation mode pageId may be omitted to resolve pages by order; in edit mode pageId is required. content must be a complete creative page fragment. The tool adds section/main content semantics, editable block ids, wraps it as a complete HTML document, and injects runtime assets. Do not pass a full HTML document, runtime page shell, or ppt-page-root/content/fit-scope markup. HTML is validated before writing.',
        schema: z.object({
          pageId: z
            .string()
            .optional()
            .describe(
              'Optional target section id, such as page-1. If omitted, the tool resolves the page from context/order.'
            ),
          content: z
            .string()
            .describe(
              'Complete creative page HTML fragment only. The tool will add section[data-page-scaffold], main[data-role="content"], editable data-block-id attributes, and the runtime page frame when needed. Do not pass <!doctype>, <html>, <head>, <body>, .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, data-ppt-guard-root, or any runtime shell markup.'
            )
        })
      }
    )
  ]
}
