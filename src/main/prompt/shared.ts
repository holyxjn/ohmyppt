import { loadStyleSkill } from "../utils/style-skills";
import type { DesignContract, SessionDeckGenerationContext } from "../tools/types";

export const PAGE_SEMANTIC_STRUCTURE = [
  "## 页面语义结构（必须）",
  "- 每页内容根节点使用一个语义容器：<section data-page-scaffold=\"1\" ...> ... </section>",
  "- section 内只需要一个整体内容入口：<main data-block-id=\"content\" data-role=\"content\"> ... </main>",
  "- 标题不要做成固定外层骨架；在 content 内放置 h1 或标题子块，并标记 data-role=\"title\"",
  "- data-role=\"title\" 只表示语义标题，不表示固定 header；不要把它默认放在页面最顶部",
  "- 标题位置和整体布局由本页内容决定，允许上下、左右、居中、角标、图表旁、卡片内、不对称等方式",
  "- 在一致风格下保持自然变化；可以复用有效结构，但不要机械重复",
  "- 竖排标题只适合 2-6 个中文字符的短栏目标签（如：效率明细、关键结论、风险提示），不要把完整长标题整句竖排",
  "- **硬约束：标题只要包含英文单词/英文缩写/年份/数字编号/中英混排，就禁止竖排 writing-mode，必须横排显示**",
  "- 包含英文的标题可以放在左侧、右侧、顶部、角落或卡片内，但文字方向必须保持横排；若需要侧边效果，只能用横排标题整体 rotate(-90deg/90deg)，不要逐字竖排",
  "- 中文完整标题超过 8 个字时必须横排；如需要竖向视觉，只把短标签竖排，完整标题放在旁边横排",
  "- 只有纯中文且 2-6 个字符的短标签才可使用竖排：在标题容器上使用 writing-mode: vertical-rl; text-orientation: mixed; 或 Tailwind 任意属性 [writing-mode:vertical-rl] [text-orientation:mixed]",
  "- 视觉侧标也可以用 rotate(-90deg) / rotate(90deg) 做横排旋转标题；长英文标题、长句、副标题不要竖排，避免可读性差",
  "- 竖排或旋转标题必须给容器明确宽高、位置和 overflow-hidden，避免文字挤出画布；标题仍需保留 data-role=\"title\"",
  "- 每页生成前先选择一种适合内容的版式；标题必须服务于该页叙事",
  "- 不要默认预留 footer/meta；来源、注释、结论等信息若必须出现，应作为 content 内的普通子块呈现",
  "- content 内至少 2-4 个可编辑子块，每个子块都要有 data-block-id，例如：overview / metric-1 / list-1 / timeline-1",
  "- content 内所有主要可视元素都要有稳定唯一标识：可编辑子块必须有唯一 data-block-id，同时添加唯一语义 class（如 ppt-page-title / ppt-chart-main / ppt-metric-1）",
  "- 图表容器、图片、表格、关键文本块、按钮式标签等可被用户点选的元素，都应添加页面内唯一 class，便于检选、拖拽和局部编辑",
  "- 所有可编辑子块命名采用 kebab-case（如：metric-1、summary、chart-main）；不要再使用 data-block-id=\"title\" 作为固定骨架",
  "- 不要创建第二层 .ppt-page-content 包裹；不要输出孤立 closing tag",
  "",
  "结构示例之一（片段，整体 padding 由系统外层 p-2 提供；这是上下布局示例，不要每页照抄）：",
  "<section data-page-scaffold=\"1\" class=\"h-full min-h-0 overflow-hidden\">",
  "  <main data-block-id=\"content\" data-role=\"content\" class=\"flex h-full min-h-0 flex-col gap-6 overflow-hidden\">",
  "    <section data-block-id=\"page-title\" data-role=\"title\" class=\"ppt-page-title shrink-0 space-y-2\">",
  "      <h1 class=\"text-5xl font-bold\">Slide title</h1>",
  "      <p data-role=\"subtitle\" class=\"text-xl text-slate-500\">Subtitle</p>",
  "    </section>",
  "    <section data-block-id=\"main-visual\" class=\"ppt-main-visual min-h-0 flex-1\">...</section>",
  "    <section data-block-id=\"key-points\" class=\"ppt-key-points shrink-0\">...</section>",
  "  </main>",
  "</section>",
  "",
  "布局可以自由选择上下、左右、居中、角标、卡片、不对称、图表旁标题等形式；不要机械套用示例。竖排只承载纯中文短标签，不能承载完整长标题、英文标题、年份标题或中英混排标题。",
].join("\n");

export const CONTENT_LANGUAGE_RULES = [
  "## Content language",
  "- The language of these instructions is not the output language. Do not imitate the prompt language.",
  "- If the user explicitly requests a language, use that language.",
  "- Otherwise, use the dominant language of the user's latest request and provided source materials.",
  "- If source materials are primarily English, write slide titles, body text, outlines, and user-facing summaries in English. Do not translate them into Chinese.",
  "- If source materials are primarily Chinese, write slide titles, body text, outlines, and user-facing summaries in Chinese.",
  "- For mixed-language materials, prefer the latest user instruction language.",
  "- Preserve proper nouns, brand names, technical terms, quoted source text, and metrics when appropriate.",
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
    .map((item, i) => `${i + 1}. ${item.title}\n   Content points: ${item.contentOutline}`)
    .join("\n");
}

export function formatDesignContract(contract?: DesignContract): string {
  if (!contract) return "Not provided. Keep pages visually consistent according to the style rules.";
  return [
    `- Visual theme: ${contract.theme}`,
    `- Canvas background: ${contract.background}`,
    `- Palette: ${contract.palette.join(", ")}`,
    `- Title style: ${contract.titleStyle}`,
    `- Layout motif: ${contract.layoutMotif}`,
    `- Chart style: ${contract.chartStyle}`,
    `- Shape language: ${contract.shapeLanguage}`,
  ].join("\n");
}
