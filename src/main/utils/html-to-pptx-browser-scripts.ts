export const FREEZE_PAGE_FOR_EXPORT_SCRIPT = `
(async () => {
  const root =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.body;
  const existing = document.getElementById('ohmyppt-export-freeze-page');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'ohmyppt-export-freeze-page';
  style.textContent = [
    'html { scroll-behavior: auto !important; }',
    '*, *::before, *::after { animation: none !important; transition: none !important; animation-delay: 0s !important; animation-duration: 0s !important; animation-play-state: paused !important; transition-delay: 0s !important; transition-duration: 0s !important; }',
    '.opacity-0, [data-anime], [data-animate] { opacity: 1 !important; transform: none !important; }'
  ].join('\\n');
  document.head.appendChild(style);

  try {
    document.getAnimations?.().forEach((animation) => {
      try {
        animation.finish();
      } catch (_err) {
        try {
          animation.cancel();
        } catch (_cancelErr) {}
      }
    });
  } catch (_err) {}

  const motionTargets = root.querySelectorAll(
    '.opacity-0, [data-anime], [data-animate], h1, h2, h3, p, li, .card, .panel, .text-section, .diagram-section, .timeline-node, section, section > *'
  );
  motionTargets.forEach((element) => {
    const node = element;
    node.style.transition = 'none';
    node.style.animation = 'none';
    if (Number(getComputedStyle(node).opacity || '1') < 0.98) {
      node.style.opacity = '1';
    }
    if (/translateY\\([^)]*\\)/.test(node.style.transform || '')) {
      node.style.transform = 'none';
    }
  });

  Array.from(root.querySelectorAll('*')).slice(0, 900).forEach((element) => {
    const node = element;
    const computed = getComputedStyle(node);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (Number(computed.opacity || '1') < 0.98) {
      node.style.opacity = '1';
    }
    if (/translate(?:3d|X|Y)?\\(/.test(node.style.transform || '')) {
      node.style.transform = 'none';
    }
  });

  const scope = root.querySelector?.(':scope > .ppt-page-fit-scope');
  if (scope) scope.style.transform = 'scale(1)';
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_err) {}
  }
  return true;
})()
`

export const FREEZE_PAGE_FOR_PPTX_SCRIPT = FREEZE_PAGE_FOR_EXPORT_SCRIPT

export const HIDE_TEXT_FOR_PPTX_BACKGROUND_SCRIPT = `
(() => {
  const existing = document.getElementById('ohmyppt-pptx-hide-text');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'ohmyppt-pptx-hide-text';
  style.textContent = [
    'body, body * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }',
    'svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }',
    'input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  return true;
})()
`
