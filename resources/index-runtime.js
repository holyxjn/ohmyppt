(function () {
  'use strict';
  // @ohmyppt-index-runtim:arcsin1:v2

  var pages = JSON.parse(document.getElementById('pages-data')?.textContent || '[]');
  var frameViewport = document.getElementById('frameViewport');
  var thumbs = document.getElementById('thumbs');
  var deckSwitcher = document.getElementById('deckSwitcher');
  var indicator = document.getElementById('indicator');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var tabsBtn = document.getElementById('tabsBtn');
  var presentBtn = document.getElementById('presentBtn');
  var fullscreenBtn = document.getElementById('fullscreenBtn');
  var search = new URLSearchParams(window.location.search);
  var embedMode = search.get('embed') === '1';
  var presentMode = search.get('present') === '1';
  var currentPageId = '';
  var fitRaf = 0;

  function getPageKey(page) {
    return String((page && (page.id || page.pageId)) || '');
  }

  function getLegacyPageId(page) {
    return String((page && page.pageId) || getPageKey(page));
  }

  // ── iframe pool: one per page, lazy-loaded on first visit ──
  var framePool = new Map();
  var loadedPages = new Set();
  var allFrames = frameViewport
    ? Array.from(frameViewport.querySelectorAll('.ppt-preview-frame'))
    : [];
  allFrames.forEach(function (el) {
    var pid = el.getAttribute('data-page-id');
    if (pid) framePool.set(pid, el);
  });

  // Build URL for a page iframe
  function buildPageUrl(page) {
    var url = new URL(page.htmlPath, window.location.href);
    url.searchParams.set('fit', 'off');
    if (embedMode) url.searchParams.set('embed', '1');
    return url.toString();
  }

  // Load a page's iframe on first visit so animations start when visible
  function ensureFrameLoaded(pageId) {
    if (loadedPages.has(pageId)) return;
    var page = pages.find(function (p) { return getPageKey(p) === pageId; });
    var frame = framePool.get(pageId);
    if (!page || !frame) return;
    loadedPages.add(pageId);
    frame.src = buildPageUrl(page);
    frame.addEventListener('load', function () {
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
      var next = new URLSearchParams(window.location.search);
      if (presentMode) next.set('present', '1');
      else next.delete('present');
      var query = next.toString();
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (query ? '?' + query : '') + (window.location.hash || '')
      );
    }
    scheduleFitFrame();
  }

  function normalizePageId(hashValue) {
    var raw = (hashValue || '').replace(/^#/, '').trim();
    if (!raw && pages.length > 0) return getPageKey(pages[0]);
    var decoded = decodeURIComponent(raw || '');
    if (pages.some(function (item) { return getPageKey(item) === decoded; })) return decoded;
    var legacyMatch = pages.find(function (item) { return getLegacyPageId(item) === decoded; });
    if (legacyMatch) return getPageKey(legacyMatch);
    return (pages[0] ? getPageKey(pages[0]) : '');
  }

  function getActiveFrame() {
    return currentPageId ? framePool.get(currentPageId) : null;
  }

  function fitFrame() {
    var frame = getActiveFrame();
    if (!frame || !frameViewport) return;
    var rect = frameViewport.getBoundingClientRect();
    var rawScale = Math.min(rect.width / 1600, rect.height / 900);
    var scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
    var offsetX = Math.max(0, (rect.width - 1600 * scale) / 2);
    var offsetY = Math.max(0, (rect.height - 900 * scale) / 2);
    frame.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
  }

  function scheduleFitFrame() {
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(function () {
      fitRaf = 0;
      fitFrame();
    });
  }

  function renderThumbs(activePageId) {
    if (!thumbs || embedMode) return;
    Array.from(thumbs.querySelectorAll('.ppt-thumb-item')).forEach(function (item) {
      item.classList.toggle('active', item.getAttribute('data-page-id') === activePageId);
    });
  }

  function bindThumbEvents() {
    if (!thumbs) return;
    Array.from(thumbs.querySelectorAll('.ppt-thumb-item')).forEach(function (item) {
      item.addEventListener('click', function () {
        var pageId = item.getAttribute('data-page-id');
        if (!pageId) return;
        if (deckSwitcher) deckSwitcher.classList.remove('open');
        window.location.hash = '#' + encodeURIComponent(pageId);
      });
    });
  }

  function currentIndex() {
    return pages.findIndex(function (item) { return getPageKey(item) === currentPageId; });
  }

  function updateIndicator() {
    if (!indicator) return;
    var index = currentIndex();
    indicator.textContent = index >= 0 ? (index + 1) + ' / ' + pages.length : '--';
  }

  function applyPage(pageId, syncHash) {
    if (!Array.isArray(pages) || pages.length === 0) {
      document.body.classList.add('empty');
      if (indicator) indicator.textContent = '0 / 0';
      return;
    }
    document.body.classList.remove('empty');
    var page = pages.find(function (item) { return getPageKey(item) === pageId; }) || pages[0];
    if (!page) return;

    // Hide previous frame
    var prevFrame = currentPageId ? framePool.get(currentPageId) : null;
    if (prevFrame) prevFrame.classList.remove('active');

    // Show target frame
    currentPageId = getPageKey(page);
    ensureFrameLoaded(currentPageId);
    var nextFrame = framePool.get(currentPageId);
    if (nextFrame) nextFrame.classList.add('active');

    scheduleFitFrame();
    if (syncHash && window.location.hash !== '#' + encodeURIComponent(currentPageId)) {
      window.history.replaceState(null, '', '#' + encodeURIComponent(currentPageId));
    }
    renderThumbs(currentPageId);
    updateIndicator();
  }

  function gotoOffset(offset) {
    if (!Array.isArray(pages) || pages.length === 0) return;
    var index = currentIndex();
    if (index < 0) return;
    var target = Math.max(0, Math.min(pages.length - 1, index + offset));
    var targetPage = pages[target];
    if (!targetPage) return;
    window.location.hash = '#' + encodeURIComponent(getPageKey(targetPage));
  }

  function onHashChange() {
    var pageId = normalizePageId(window.location.hash);
    applyPage(pageId, false);
  }

  function togglePresentMode() {
    applyPresentMode(!presentMode, true);
  }

  function exitPresentMode() {
    if (!presentMode) return;
    applyPresentMode(false, true);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      try { document.documentElement.requestFullscreen(); } catch (_) {}
      return;
    }
    try { document.exitFullscreen(); } catch (_) {}
  }

  bindThumbEvents();
  if (prevBtn) prevBtn.addEventListener('click', function () { gotoOffset(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { gotoOffset(1); });
  if (tabsBtn) tabsBtn.addEventListener('click', function () { if (deckSwitcher) deckSwitcher.classList.toggle('open'); });
  if (presentBtn) presentBtn.addEventListener('click', function () { togglePresentMode(); });
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', function () { toggleFullscreen(); });
  window.addEventListener('resize', function () { scheduleFitFrame(); });
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowRight' || event.key === 'PageDown') gotoOffset(1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') gotoOffset(-1);
    if (event.key === 'Escape') {
      if (deckSwitcher) deckSwitcher.classList.remove('open');
    }
    if (event.key === 'Escape' && presentMode) {
      event.preventDefault();
      exitPresentMode();
    }
  });
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Node)) return;
    if (!deckSwitcher || !deckSwitcher.classList.contains('open')) return;
    var inSwitcher = deckSwitcher.contains(target);
    var inTabsButton = tabsBtn && tabsBtn.contains(target);
    if (!inSwitcher && !inTabsButton) {
      deckSwitcher.classList.remove('open');
    }
  });

  applyPresentMode(presentMode, false);
  applyPage(normalizePageId(window.location.hash), true);
  scheduleFitFrame();
})();
