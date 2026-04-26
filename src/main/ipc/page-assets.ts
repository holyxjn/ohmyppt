export const SESSION_ASSET_FILE_NAMES = [
  "anime.v4.js",
  "chart.v4.js",
  "tailwindcss.v3.js",
  "ppt-runtime.js",
] as const;

export const SESSION_ASSET_SCRIPT_SRCS = {
  anime: `./assets/${SESSION_ASSET_FILE_NAMES[0]}`,
  chart: `./assets/${SESSION_ASSET_FILE_NAMES[1]}`,
  tailwind: `./assets/${SESSION_ASSET_FILE_NAMES[2]}`,
  runtime: `./assets/${SESSION_ASSET_FILE_NAMES[3]}`,
} as const;

