import { loadStyleSkill } from '../utils/style-skills'
import { formatLayoutIntentPrompt } from '@shared/layout-intent'
import type { DesignContract, SessionDeckGenerationContext } from '../tools/types'

export const PAGE_SEMANTIC_STRUCTURE = [
  '## 页面语义结构',
  '- 直接输出完整创意页面片段；系统会自动包裹 section[data-page-scaffold]、main[data-role="content"] 和标准 page frame。',
  '- 如果页面有明确标题，可以给第一个标题元素添加 data-role="title"；没有传统标题时不要为了校验硬造标题。',
  '- 主动添加 data-block-id 时保持页面内唯一（kebab-case：metric-1、summary、chart-main）；未添加时系统会自动补齐。',
  '',
  '布局决策：',
  '- 先判断本页叙事重心：数据展示、概念解释、信息对比、流程时间线、结论收束、封面/章节页。',
  '- 标题是阅读路径的一部分，不是固定装饰头部；它应该出现在最能引导阅读的位置。',
  '- 数据页可以让图表/指标成为主视觉，标题靠边或与关键数字组合。',
  '- 对比页优先考虑分区结构，标题服务于对比关系。',
  '- 概念页可以使用中心主视觉、侧栏标题、图文交错或卡片组合。',
  '- 总结页和封面页可以让标题占据视觉重心。',
  '- 在同一套视觉语言下保持变化，不要机械重复同一标题位置和同一网格。',
  '',
  '标题可读性底线：',
  '- 竖排仅限 2-6 个中文字符的短标签。',
  '- 标题包含英文、数字、年份、中英混排或长句时必须横排。',
  '- 完整标题优先保证可读性，不要为了装饰牺牲阅读。'
].join('\n')

export const CONTENT_LANGUAGE_RULES = [
  '## Content language',
  '- The language of these instructions is not the output language. Do not imitate the prompt language.',
  '- If the user explicitly requests a language, use that language.',
  "- Otherwise, use the dominant language of the user's latest request and provided source materials.",
  '- If source materials are primarily English, write slide titles, body text, outlines, and user-facing summaries in English. Do not translate them into Chinese.',
  '- If source materials are primarily Chinese, write slide titles, body text, outlines, and user-facing summaries in Chinese.',
  '- For mixed-language materials, prefer the latest user instruction language.',
  '- Preserve proper nouns, brand names, technical terms, quoted source text, and metrics when appropriate.'
].join('\n')

export const CANVAS_CONSTRAINTS = [
  '## 画布约束',
  '- 16:9（1600×900），系统自动缩放。可用内容区约 1584×884（外层有 p-2）。',
  '- 用 Tailwind flex/grid 布局；禁止 w-[1600px]/h-[900px]/100vw/100vh/w-screen/h-screen 等画布锁定。',
  '- 禁止 vw/vh 字体单位和 text-[clamp(...)]；h1 统一 text-5xl，禁 text-6xl/7xl/8xl。',
  '- 禁止 iframe。禁止引用系统骨架类。',
  '- 整套页面复用同一背景体系/主色/字体；背景铺满画布，定义在最外层容器上。',
  '- 内容过长时精简文字和卡片；不要预留页脚/meta 区。'
].join('\n')

export const FRONTEND_CAPABILITIES = [
  '## 前端能力（已内置）',
  '每个 page-x.html 已预注入 ./assets/anime.v4.js、./assets/tailwindcss.v3.js、./assets/chart.v4.js、./assets/ppt-runtime.js 和 KaTeX。',
  '禁止重复插入上述 script/link 标签；禁止使用任何 CDN 外链。',
  '',
  '### 图表 — 必须严格按此模板写',
  '正确写法（高度写在 canvas 的直接父容器上）：',
  '```html',
  '<div class=”relative h-[260px] w-full”>',
  '  <canvas class=”h-full w-full”></canvas>',
  '</div>',
  '```',
  '```js',
  'const chart = PPT.createChart(canvasEl, { type: “bar”, data: { labels: [“A”,”B”], datasets: [{ data: [10,20] }] }, options: {} });',
  '```',
  '⛔ 错误写法（全部会被验证拦截，导致该页生成失败）：',
  '- new Chart(ctx, config) → 必须用 PPT.createChart(el, config)',
  '- canvas 上直接写 h-32 / h-full / flex-1 → 高度必须写在父容器',
  '- 把 canvas 直接放进卡片/文本块 → 必须有专属 chart frame 父容器',
  '',
  '### 动画 — 必须严格按此写法',
  '正确：PPT.animate(targets, params)、PPT.createTimeline(...)、PPT.stagger(...)',
  '⛔ 错误：anime({ targets })、anime.timeline()、PPT.animate({ targets })',
  '',
  '### 其他硬校验禁区（违反即失败）',
  '- 禁止 opacity-0 / invisible / visibility:hidden（初始态必须可见）',
  '- 数学公式用 \\( \\) 或 $$ $$，不用单 $',
  '- 动画仅做轻量入场增强（opacity/translate/scale，300-700ms），禁止无限循环'
].join('\n')

export const CONTENT_WRITING_RULES = [
  '## 内容写入规则',
  '- 只输出页面片段（不是完整 HTML）。工具自动包裹 page frame、补 data-block-id。',
  '- 禁止 <!doctype>/<html>/<head>/<body>/<meta>/<title>/<link>/<script src=...>。',
  '- 禁止系统骨架标识：.ppt-page-root / .ppt-page-fit-scope / .ppt-page-content / data-ppt-guard-root（class、CSS、script、注释里都不能出现）。',
  '- 所有标签必须成对闭合；items-center/justify-* 的父节点必须有 flex 或 grid。',
  '- 先在脑内完成整页结构，再一次性调用工具写入。写入前自检：容器开闭一致，末尾无未闭合标签。',
  '- 默认禁止 emoji/贴纸装饰；单区最多 3 列；留白优先，不要塞满。'
].join('\n')

export function resolveStylePrompt(styleId: string | null | undefined): {
  presetLabel: string
  presetId: string
  stylePrompt: string
} {
  const { preset, prompt } = loadStyleSkill(styleId)
  return {
    presetLabel: preset.label,
    presetId: preset.id,
    stylePrompt: prompt
  }
}

export function buildOutlinePageList(context: SessionDeckGenerationContext): string {
  return context.outlineItems
    .map((item, i) => {
      const layoutIntent = item.layoutIntent
        ? `\n   ${formatLayoutIntentPrompt(item.layoutIntent).replace(/\n/g, '\n   ')}`
        : ''
      return `${i + 1}. ${item.title}\n   Content points: ${item.contentOutline}${layoutIntent}`
    })
    .join('\n')
}

export function formatDesignContract(contract?: DesignContract): string {
  if (!contract) return 'Not provided. Keep pages visually consistent according to the style rules.'
  return [
    `- Visual theme: ${contract.theme}`,
    `- Canvas background: ${contract.background}`,
    `- Palette: ${contract.palette.join(', ')}`,
    `- Title style: ${contract.titleStyle}`,
    `- Layout motif: ${contract.layoutMotif}`,
    '- Use the layout motif as the deck-level layout language. Keep pages varied within this motif instead of repeating one template.',
    `- Chart style: ${contract.chartStyle}`,
    `- Shape language: ${contract.shapeLanguage}`
  ].join('\n')
}
