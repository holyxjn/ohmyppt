export const SESSION_ASSET_FILES = {
  anime: "anime.v4.js",
  chart: "chart.v4.js",
  tailwind: "tailwindcss.v3.js",
  katexStyle: "katex.min.css",
  katex: "katex.min.js",
  katexAutoRender: "katex-auto-render.min.js",
  runtime: "ppt-runtime.js",
  indexRuntime: "index-runtime.js",
} as const;

export const SESSION_ASSET_FILE_NAMES = Object.values(SESSION_ASSET_FILES);

export const SESSION_ASSET_DIR_NAMES = [
  "fonts",
] as const;

export const SESSION_ASSET_SCRIPT_SRCS = {
  anime: `./assets/${SESSION_ASSET_FILES.anime}`,
  chart: `./assets/${SESSION_ASSET_FILES.chart}`,
  tailwind: `./assets/${SESSION_ASSET_FILES.tailwind}`,
  katex: `./assets/${SESSION_ASSET_FILES.katex}`,
  katexAutoRender: `./assets/${SESSION_ASSET_FILES.katexAutoRender}`,
  runtime: `./assets/${SESSION_ASSET_FILES.runtime}`,
} as const;

export const SESSION_ASSET_STYLE_HREFS = {
  katex: `./assets/${SESSION_ASSET_FILES.katexStyle}`,
} as const;

export const buildSessionAssetHeadTags = (): string =>
  [
    `<link rel="stylesheet" href="${SESSION_ASSET_STYLE_HREFS.katex}" />`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.anime}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.tailwind}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.chart}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.katex}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.katexAutoRender}"></script>`,
    `<script src="${SESSION_ASSET_SCRIPT_SRCS.runtime}"></script>`,
  ].join("\n    ");
