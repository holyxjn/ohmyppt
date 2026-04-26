import { loadStyleSkill } from "../utils/style-skills";
import type { DesignContract, SessionDeckGenerationContext } from "../tools/types";

export const PAGE_SEMANTIC_STRUCTURE = [
  "## 页面语义结构（必须）",
  "- 每页内容根节点使用一个语义容器：<section data-page-scaffold=\"1\" ...> ... </section>",
  "- 标题区必须存在：<header data-block-id=\"title\" data-role=\"title\">，其中包含 h1；可选副标题 p[data-role=\"subtitle\"]",
  "- 主内容区必须存在：<main data-block-id=\"content\" data-role=\"content\"> ... </main>",
  "- 主内容区内至少 2-4 个子块，每个子块都要有 data-block-id，例如：overview / metric-1 / list-1 / timeline-1",
  "- 可选信息区：<footer data-block-id=\"meta\" data-role=\"meta\">（来源、注释、结论）",
  "- 所有可编辑块必须带 data-block-id，命名采用 kebab-case（如：title、content、metric-1、summary）",
  "- 不要创建第二层 .ppt-page-content 包裹；不要输出孤立 closing tag",
  "",
  "结构示例（片段）：",
  "<section data-page-scaffold=\"1\" class=\"flex flex-col gap-6\">",
  "  <header data-block-id=\"title\" data-role=\"title\" class=\"space-y-2\">",
  "    <h1 class=\"text-5xl font-bold\">页面标题</h1>",
  "    <p data-role=\"subtitle\" class=\"text-xl text-slate-500\">副标题</p>",
  "  </header>",
  "  <main data-block-id=\"content\" data-role=\"content\" class=\"grid grid-cols-2 gap-6 flex-1\">",
  "    <section data-block-id=\"metric-1\">...</section>",
  "    <section data-block-id=\"metric-2\">...</section>",
  "  </main>",
  "  <footer data-block-id=\"meta\" data-role=\"meta\" class=\"text-sm text-slate-500\">...</footer>",
  "</section>",
].join("\n");

export function resolveStylePrompt(
  styleId: string | null | undefined,
): { presetLabel: string; presetId: string; stylePrompt: string } {
  const { preset, prompt } = loadStyleSkill(styleId);
  return {
    presetLabel: preset.label,
    presetId: preset.id,
    stylePrompt: prompt,
  };
}

export function buildOutlinePageList(context: SessionDeckGenerationContext): string {
  return context.outlineItems
    .map((item, i) => `${i + 1}. ${item.title}\n   内容要点：${item.contentOutline}`)
    .join("\n");
}

export function formatDesignContract(contract?: DesignContract): string {
  if (!contract) return "未提供，按风格规则保持统一。";
  return [
    `- 主题气质：${contract.theme}`,
    `- 画布背景：${contract.background}`,
    `- 色板：${contract.palette.join(", ")}`,
    `- 标题样式：${contract.titleStyle}`,
    `- 布局母题：${contract.layoutMotif}`,
    `- 图表风格：${contract.chartStyle}`,
    `- 形状语言：${contract.shapeLanguage}`,
  ].join("\n");
}
