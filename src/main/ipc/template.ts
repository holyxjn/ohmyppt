/** HTML template builders for multi-page preview architecture. */
import { escapeHtml } from "./utils";
import * as cheerio from "cheerio";
import { BASE_PAGE_STYLE_TAG, FIT_SCRIPT } from "../tools";
import { buildSessionAssetHeadTags } from "./page-assets";

export interface DeckPageFile {
  pageNumber: number;
  pageId: string;
  title: string;
  htmlPath: string;
}

export {
  SESSION_ASSET_DIR_NAMES,
  SESSION_ASSET_FILES,
  SESSION_ASSET_FILE_NAMES,
  SESSION_ASSET_SCRIPT_SRCS,
  SESSION_ASSET_STYLE_HREFS,
  buildSessionAssetHeadTags
} from "./page-assets";

export const buildPageScaffoldHtml = (page: {
  pageNumber: number;
  pageId: string;
  title: string;
}): string => {
  const safeTitle = escapeHtml(page.title || `第 ${page.pageNumber} 页`);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    ${buildSessionAssetHeadTags()}
    ${BASE_PAGE_STYLE_TAG}
    <style>
      .scaffold-card {
        width: 100%;
        height: 100%;
        border-radius: 24px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        padding: 28px;
      }
      .scaffold-title {
        margin: 0;
        font-size: 48px;
        line-height: 1.2;
        color: #0f172a;
      }
      .scaffold-hint {
        margin-top: 14px;
        font-size: 16px;
        color: #94a3b8;
      }
    </style>
  </head>
  <body data-page-id="${page.pageId}">
    <main class="ppt-page-root p-8" data-ppt-guard-root="1">
      <div class="ppt-page-fit-scope">
        <div class="ppt-page-content">
          <section class="scaffold-card" data-page-scaffold="1">
            <h1 class="scaffold-title">${safeTitle}</h1>
            <div class="scaffold-hint">等待模型填充这一页内容</div>
          </section>
        </div>
      </div>
    </main>
    ${FIT_SCRIPT}
  </body>
</html>`;
};

export const buildProjectIndexHtml = (
  title: string,
  pages: DeckPageFile[]
): string => {
  const safeTitle = escapeHtml(title || "OpenPPT Preview");
  const pagesData = JSON.stringify(
    pages.map((page) => ({
      pageNumber: page.pageNumber,
      pageId: page.pageId,
      title: page.title,
      htmlPath: page.htmlPath,
    }))
  ).replace(/</g, "\\u003c");
  const thumbButtons = pages
    .map(
      (page) => `<button class="ppt-thumb-item" data-page-id="${page.pageId}">
  <div class="ppt-thumb-index">P${page.pageNumber}</div>
  <div class="ppt-thumb-title">${escapeHtml(page.title)}</div>
</button>`
    )
    .join("\n");

  const frameElements = pages
    .map(
      (page) => `<iframe class="ppt-preview-frame" data-page-id="${page.pageId}" title="${escapeHtml(page.title)}"></iframe>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle} · Preview</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        height: 100%;
      }
      body {
        margin: 0;
        font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
        background: linear-gradient(160deg, #eef6ff 0%, #f8fbff 55%, #eef2ff 100%);
        color: #1e293b;
        overflow: hidden;
      }
      .ppt-layout {
        height: 100vh;
        height: 100dvh;
        padding: 0;
      }
      .ppt-stage {
        background: #ffffff;
        height: 100%;
        min-height: 0;
        border-radius: 0;
        overflow: hidden;
        padding: 0;
      }
      .ppt-preview-viewport {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 0;
        overflow: hidden;
        background: #ffffff;
      }
      .ppt-preview-frame {
        position: absolute;
        left: 0;
        top: 0;
        width: 1600px;
        height: 900px;
        transform-origin: top left;
        border: none;
        background: white;
        display: none;
      }
      .ppt-preview-frame.active { display: block; }
      .ppt-deck-switcher {
        position: fixed;
        right: 18px;
        bottom: 82px;
        width: min(320px, calc(100vw - 32px));
        max-height: min(54vh, 520px);
        overflow: auto;
        display: none;
        padding: 14px;
        border-radius: 20px;
        border: 1px solid rgba(148,163,184,0.24);
        background: rgba(255,255,255,0.92);
        box-shadow: 0 18px 48px rgba(15,23,42,0.16);
        backdrop-filter: blur(14px);
      }
      .ppt-deck-switcher.open { display: block; }
      .ppt-thumb-item {
        width: 100%;
        text-align: left;
        border: 1px solid transparent;
        border-radius: 14px;
        background: rgba(248,250,252,0.9);
        padding: 10px;
        cursor: pointer;
      }
      .ppt-thumb-item + .ppt-thumb-item { margin-top: 8px; }
      .ppt-thumb-item.active {
        border-color: rgba(59,130,246,0.45);
        background: rgba(219,234,254,0.7);
      }
      .ppt-thumb-index {
        font-size: 11px;
        color: #64748b;
      }
      .ppt-thumb-title {
        margin-top: 4px;
        font-size: 13px;
        color: #0f172a;
        font-weight: 600;
      }
      .ppt-controls {
        position: fixed;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 14px;
        border: 1px solid rgba(148,163,184,0.24);
        background: rgba(255,255,255,0.92);
        box-shadow: 0 10px 26px rgba(15,23,42,0.13);
        backdrop-filter: blur(8px);
      }
      .ppt-control-btn {
        border: 1px solid rgba(148,163,184,0.24);
        background: rgba(248,250,252,0.9);
        color: #334155;
        border-radius: 10px;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .ppt-indicator {
        min-width: 88px;
        text-align: center;
        color: #475569;
        font-size: 13px;
        font-weight: 600;
      }
      body.present .ppt-layout { padding: 0; }
      body.present .ppt-stage { border-radius: 0; border: none; box-shadow: none; padding: 0; }
      body.present .ppt-preview-viewport { border-radius: 0; }
      body.present .ppt-controls, body.present .ppt-deck-switcher { display: none !important; }
      body.embed .ppt-layout { padding: 0; }
      body.embed .ppt-stage { border-radius: 0; border: none; box-shadow: none; padding: 0; }
      body.embed .ppt-preview-viewport { border-radius: 0; }
      body.embed .ppt-controls, body.embed .ppt-deck-switcher { display: none !important; }
      .ppt-empty {
        position: absolute;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        color: #64748b;
        background: linear-gradient(180deg, rgba(241,245,249,0.7) 0%, rgba(248,250,252,0.8) 100%);
      }
      body.empty .ppt-empty { display: flex; }
      body.empty iframe { display: none; }
    </style>
  </head>
  <body>
    <div class="ppt-layout">
      <section class="ppt-stage">
        <div id="frameViewport" class="ppt-preview-viewport">
          ${frameElements}
          <div class="ppt-empty">暂无页面，请先生成 page-xx.html 内容</div>
        </div>
      </section>
    </div>
    <aside class="ppt-deck-switcher" id="deckSwitcher">
      <div id="thumbs">${thumbButtons}</div>
    </aside>
    <div class="ppt-controls">
      <button class="ppt-control-btn" id="prevBtn">上一页</button>
      <div class="ppt-indicator" id="indicator"></div>
      <button class="ppt-control-btn" id="nextBtn">下一页</button>
      <button class="ppt-control-btn" id="tabsBtn">页面目录</button>
      <button class="ppt-control-btn" id="presentBtn">演示模式（ESC退出）</button>
      <button class="ppt-control-btn" id="fullscreenBtn">全屏</button>
    </div>
    <script type="application/json" id="pages-data">${pagesData}</script>
    <script>
      const pages = JSON.parse(document.getElementById('pages-data')?.textContent || '[]');
      const frameViewport = document.getElementById('frameViewport');
      const thumbs = document.getElementById('thumbs');
      const deckSwitcher = document.getElementById('deckSwitcher');
      const indicator = document.getElementById('indicator');
      const prevBtn = document.getElementById('prevBtn');
      const nextBtn = document.getElementById('nextBtn');
      const tabsBtn = document.getElementById('tabsBtn');
      const presentBtn = document.getElementById('presentBtn');
      const fullscreenBtn = document.getElementById('fullscreenBtn');
      const search = new URLSearchParams(window.location.search);
      const embedMode = search.get('embed') === '1';
      let presentMode = search.get('present') === '1';
      let currentPageId = '';
      let fitRaf = 0;

      // ── iframe pool: one per page, lazy-loaded on first visit ──
      const framePool = new Map();
      const loadedPages = new Set();
      const allFrames = frameViewport
        ? Array.from(frameViewport.querySelectorAll('.ppt-preview-frame'))
        : [];
      allFrames.forEach((el) => {
        const pid = el.getAttribute('data-page-id');
        if (pid) framePool.set(pid, el);
      });

      // Build URL for a page iframe
      function buildPageUrl(page) {
        const url = new URL(page.htmlPath, window.location.href);
        url.searchParams.set('fit', 'off');
        if (embedMode) url.searchParams.set('embed', '1');
        return url.toString();
      }

      // Load a page's iframe on first visit so animations start when visible
      function ensureFrameLoaded(pageId) {
        if (loadedPages.has(pageId)) return;
        const page = pages.find((p) => p.pageId === pageId);
        const frame = framePool.get(pageId);
        if (!page || !frame) return;
        loadedPages.add(pageId);
        frame.src = buildPageUrl(page);
        frame.addEventListener('load', () => {
          if (pageId === currentPageId) scheduleFitFrame();
        });
      }

      if (embedMode) document.body.classList.add('embed');

      function applyPresentMode(nextPresentMode, syncQuery) {
        presentMode = Boolean(nextPresentMode);
        document.body.classList.toggle('present', presentMode);
        if (presentBtn) {
          presentBtn.textContent = presentMode ? '退出演示' : '演示模式（ESC退出）';
        }
        if (syncQuery) {
          const next = new URLSearchParams(window.location.search);
          if (presentMode) next.set('present', '1');
          else next.delete('present');
          const query = next.toString();
          window.history.replaceState(
            null,
            '',
            window.location.pathname + (query ? '?' + query : '') + (window.location.hash || '')
          );
        }
        scheduleFitFrame();
      }

      function normalizePageId(hashValue) {
        const raw = (hashValue || '').replace(/^#/, '').trim();
        if (!raw && pages.length > 0) return pages[0].pageId;
        const decoded = decodeURIComponent(raw || '');
        return pages.some((item) => item.pageId === decoded) ? decoded : (pages[0]?.pageId || '');
      }

      function getActiveFrame() {
        return currentPageId ? framePool.get(currentPageId) : null;
      }

      function fitFrame() {
        const frame = getActiveFrame();
        if (!frame || !frameViewport) return;
        const rect = frameViewport.getBoundingClientRect();
        const rawScale = Math.min(rect.width / 1600, rect.height / 900);
        const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
        const offsetX = Math.max(0, (rect.width - 1600 * scale) / 2);
        const offsetY = Math.max(0, (rect.height - 900 * scale) / 2);
        frame.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
      }

      function scheduleFitFrame() {
        if (fitRaf) cancelAnimationFrame(fitRaf);
        fitRaf = requestAnimationFrame(() => {
          fitRaf = 0;
          fitFrame();
        });
      }

      function renderThumbs(activePageId) {
        if (!thumbs || embedMode) return;
        Array.from(thumbs.querySelectorAll('.ppt-thumb-item')).forEach((item) => {
          item.classList.toggle('active', item.getAttribute('data-page-id') === activePageId);
        });
      }

      function bindThumbEvents() {
        if (!thumbs) return;
        Array.from(thumbs.querySelectorAll('.ppt-thumb-item')).forEach((item) => {
          item.addEventListener('click', () => {
            const pageId = item.getAttribute('data-page-id');
            if (!pageId) return;
            deckSwitcher?.classList.remove('open');
            window.location.hash = '#' + encodeURIComponent(pageId);
          });
        });
      }

      function currentIndex() {
        return pages.findIndex((item) => item.pageId === currentPageId);
      }

      function updateIndicator() {
        if (!indicator) return;
        const index = currentIndex();
        indicator.textContent = index >= 0 ? (index + 1) + ' / ' + pages.length : '--';
      }

      function applyPage(pageId, syncHash) {
        if (!Array.isArray(pages) || pages.length === 0) {
          document.body.classList.add('empty');
          if (indicator) indicator.textContent = '0 / 0';
          return;
        }
        document.body.classList.remove('empty');
        const page = pages.find((item) => item.pageId === pageId) || pages[0];
        if (!page) return;

        // Hide previous frame
        const prevFrame = currentPageId ? framePool.get(currentPageId) : null;
        if (prevFrame) prevFrame.classList.remove('active');

        // Show target frame
        currentPageId = page.pageId;
        ensureFrameLoaded(page.pageId);
        const nextFrame = framePool.get(page.pageId);
        if (nextFrame) nextFrame.classList.add('active');

        scheduleFitFrame();
        if (syncHash && window.location.hash !== '#' + encodeURIComponent(page.pageId)) {
          window.history.replaceState(null, '', '#' + encodeURIComponent(page.pageId));
        }
        renderThumbs(page.pageId);
        updateIndicator();
      }

      function gotoOffset(offset) {
        if (!Array.isArray(pages) || pages.length === 0) return;
        const index = currentIndex();
        if (index < 0) return;
        const target = Math.max(0, Math.min(pages.length - 1, index + offset));
        const targetPage = pages[target];
        if (!targetPage) return;
        window.location.hash = '#' + encodeURIComponent(targetPage.pageId);
      }

      function onHashChange() {
        const pageId = normalizePageId(window.location.hash);
        applyPage(pageId, false);
      }

      function togglePresentMode() {
        applyPresentMode(!presentMode, true);
      }

      function exitPresentMode() {
        if (!presentMode) return;
        applyPresentMode(false, true);
      }

      async function toggleFullscreen() {
        if (!document.fullscreenElement) {
          try { await document.documentElement.requestFullscreen(); } catch {}
          return;
        }
        try { await document.exitFullscreen(); } catch {}
      }

      bindThumbEvents();
      prevBtn?.addEventListener('click', () => gotoOffset(-1));
      nextBtn?.addEventListener('click', () => gotoOffset(1));
      tabsBtn?.addEventListener('click', () => deckSwitcher?.classList.toggle('open'));
      presentBtn?.addEventListener('click', () => togglePresentMode());
      fullscreenBtn?.addEventListener('click', () => void toggleFullscreen());
      window.addEventListener('resize', () => scheduleFitFrame());
      window.addEventListener('hashchange', onHashChange);
      window.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'PageDown') gotoOffset(1);
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') gotoOffset(-1);
        if (event.key === 'Escape') {
          deckSwitcher?.classList.remove('open');
        }
        if (event.key === 'Escape' && presentMode) {
          event.preventDefault();
          exitPresentMode();
        }
      });
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (!deckSwitcher?.classList.contains('open')) return;
        const inSwitcher = deckSwitcher.contains(target);
        const inTabsButton = tabsBtn?.contains(target);
        if (!inSwitcher && !inTabsButton) {
          deckSwitcher.classList.remove('open');
        }
      });

      applyPresentMode(presentMode, false);
      applyPage(normalizePageId(window.location.hash), true);
      scheduleFitFrame();
    </script>
  </body>
</html>`;
};

export const buildProjectIndexScaffold = (
  title: string,
  pages: Array<{ pageNumber: number; title: string; pageId: string }>
): string => {
  return buildProjectIndexHtml(
    title || "OpenPPT Preview",
    pages.map((page) => ({
      pageNumber: page.pageNumber,
      pageId: page.pageId,
      title: page.title,
      htmlPath: `${page.pageId}.html`,
    }))
  );
};

export const extractPagesDataFromIndex = (indexHtml: string): Array<{
  pageNumber: number;
  pageId: string;
  title: string;
  html: string;
  htmlPath?: string;
}> => {
  const $ = cheerio.load(indexHtml, { scriptingEnabled: false });
  const pagesDataText = $("script#pages-data").text();
  const metadata = (() => {
    try {
      const parsed = JSON.parse(pagesDataText);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })() as Array<{
    pageNumber?: number;
    pageId?: string;
    title?: string;
    htmlPath?: string;
  }>;

  if (metadata.length === 0) return [];

  return metadata.map((item, index) => {
    const pageNumber = Number(item.pageNumber) || index + 1;
    const pageId = String(item.pageId || `page-${pageNumber}`);
    const rawPath = typeof item.htmlPath === "string" ? item.htmlPath.trim() : "";
    return {
      pageNumber,
      pageId,
      title: String(item.title || `Page ${pageNumber}`),
      html: "",
      htmlPath: rawPath.length > 0 ? rawPath : `${pageId}.html`,
    };
  });
};
