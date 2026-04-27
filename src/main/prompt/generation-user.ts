import type { DesignContract, SessionDeckGenerationContext } from "../tools/types";
import { buildOutlinePageList, formatDesignContract } from "./shared";

export function buildDeckGenerationPrompt(context: SessionDeckGenerationContext): string {
  const pageList = buildOutlinePageList(context);
  return [
    "请根据以下用户需求和页面大纲，通过工具将内容写入各个 /page-x.html：",
    "",
    `主题：${context.topic}`,
    `标题：${context.deckTitle}`,
    "页面大纲：",
    pageList,
    "",
    "用户补充需求：",
    context.userMessage,
    "",
    "你可直接使用已内置能力：anime.js v4 + Tailwind CSS + Chart.js v4.5.0 + PPT Runtime；不要重复引入本地 runtime script。",
    "禁止使用任何 CDN 外链资源（包括 script/link 的 http/https URL）。",
    "",
    "请遵守页面语义结构：必须有 title/content 语义块，且每个可编辑区块带 data-block-id。",
    "",
    "请严格按上述页面大纲中的内容要点来填充每一页。",
  ].join("\n");
}

export function buildSinglePageGenerationPrompt(args: {
  topic: string;
  deckTitle: string;
  pageId: string;
  pageNumber: number;
  pageTitle: string;
  pageOutline: string;
  designContract?: DesignContract;
  retryContext?: {
    attempt: number;
    maxRetries: number;
    previousError: string;
  };
}): string {
  const retryInstructions = args.retryContext
    ? [
        "",
        "失败重试修正（本次必须优先处理）：",
        `- 当前是第 ${args.retryContext.attempt}/${args.retryContext.maxRetries} 次重试。`,
        `- 上次失败原因：${args.retryContext.previousError}`,
        "- 本次只输出页面主体片段，不要输出完整文档、页面骨架或运行时脚本。",
        "- 如果上次是标签闭合问题，请主动精简结构，确保每个 section/div/p/span/li 等标签成对闭合。",
        "- 如果上次是骨架问题，请不要包含 .ppt-page-root、.ppt-page-content、.ppt-page-fit-scope 或 data-ppt-guard-root。",
        "- 如果上次是动画/图表 API 问题，请统一使用 PPT.animate / PPT.createTimeline / PPT.stagger / PPT.createChart。",
      ]
    : [];
  return [
    "请只生成并写入这一页，不要修改其他页面。",
    "",
    `主题：${args.topic}`,
    `标题：${args.deckTitle}`,
    `目标页面：${args.pageId}（第 ${args.pageNumber} 页）`,
    `页面标题：${args.pageTitle}`,
    `内容要点：${args.pageOutline || "按主题自行扩展，但保持信息密度适中"}`,
    "",
    "整套演示设计契约（必须遵守，保持跨页一致）：",
    formatDesignContract(args.designContract),
    ...retryInstructions,
    "",
    "扩展规则（重要）：",
    "- 将“内容要点”视为短句种子：你需要把每个种子扩展成可展示的模块（标题/说明/列表/图表/对比/结论）。",
    "- 若要点为 2-4 条，最终页面应至少覆盖全部要点，不得遗漏；可按主次补充 1-2 个支撑信息块。",
    "- 扩展时允许补全合理数据口径、示例与结构，但不能偏离该页标题与要点主题。",
    "- 优先做“信息可视化友好”表达：要点中涉及趋势/对比/占比时，优先使用图表或数据卡片。",
    "",
    "强约束：",
    "- 只允许调用 update_single_page_file(pageId=目标页面, content)，禁止调用 update_page_file",
    "- 禁止传 <!doctype>/<html>/<head>/<body> 标签，工具会自动包装",
    "- 禁止传 <meta>/<title>/<link> 这类 head 标签",
    "- 禁止传 <script src=...>；运行时脚本已预注入",
    "- 禁止传 .ppt-page-root / .ppt-page-fit-scope / .ppt-page-content / data-ppt-guard-root 骨架结构",
    "- **每个标签必须成对闭合**：所有 <div>、<p>、<span> 等必须有对应的 </闭合标签>",
    "- **严禁半截输出**：若内容过多，请主动精简，不要留下未完成结构",
    "- **布局类一致性**：出现 items-center/justify-*/content-* 时，必须同时包含 flex 或 grid",
    "- 写入前先自检：无孤立 closing tag（如 </div>）且不出现双重 .ppt-page-content 包裹",
    "- 默认禁止 emoji/贴纸/玩具化装饰，除非用户明确要求",
    "- **最低内容密度**：至少包含 3-5 个内容块（标题、副标题、段落、列表、卡片、数据展示等），不准只写一句话",
    "- 不要使用 w-[1600px]、h-[900px]、min-h-[900px]、w-screen、h-screen、min-h-screen 等锁死画布类",
    "- 不要使用 w-full、max-w-[100vw]、h-full、h-[100vh]、aspect-[...] 等响应式类",
    "- 不要使用 text-[clamp(...)]、vw/vh 字体单位；字号使用固定层级（如 text-2xl 到 text-6xl）",
    "- 页面固定 1600×900 像素，内置缩放会自动适配视口",
    "- 根容器 class 必须包含 p-8 或 p-12（默认 p-8），避免内容直接贴边",
    "- 可用内容区约 1536×836；高度预算：标题≤120px，主内容≤650px，页脚≤48px",
    "- 页面主体用 h-full min-h-0 overflow-hidden；主内容用 min-h-0 flex-1/grid overflow-hidden；禁止主体滚动或内容溢出",
    "- 内容超高时精简文字、减少卡片、降低图表高度或改紧凑 2 行布局；正文和关键数据必须在正常布局流内",
    "- **标题字号统一**：h1 标题必须使用 text-5xl（48px），禁止使用 text-6xl / text-7xl / text-8xl",
    "- 禁止使用大段 ASCII Art（<pre> 画图）充当主要视觉内容",
    "- 单个内容区最多 3 列；如果信息块超过 4 个，改为 2 列多行或主次分区布局",
    "- 优先保证留白与可读性，不要把页面塞满；卡片和模块之间保持清晰间距",
    "- 至少包含一段轻量入场动画（无闪烁、无无限循环）",
    "- 禁止默认隐藏态：不要使用 opacity-0 / invisible / style=\"opacity:0\" / style=\"visibility:hidden\"",
    "- 页面初始态必须可见；动画只做增强，不可依赖隐藏态作为前提",
    "- 可直接使用 anime.js v4、Tailwind CSS、Chart.js v4.5.0、PPT Runtime（均已预注入），禁止重复引入 runtime script",
    "- 禁止使用任何 CDN 外链资源（包括 script/link 的 http/https URL）",
    "- 动画与图表统一使用固定版本与 PPT API：anime.js v4 + Tailwind CSS v3 + Chart.js v4.5.0 + PPT Runtime",
    "- `PPT.animate` 必须使用双参数签名：`PPT.animate(targets, params)`，禁止 `PPT.animate({ targets, ... })`",
    "- 时间线统一使用 `PPT.createTimeline(...)`；错峰统一使用 `PPT.stagger(...)`",
    "- 图表统一使用 `PPT.createChart(canvasOrSelector, config)`（Chart.js v4.5.0）",
    "- 允许按需使用 `PPT.updateChart(...)`、`PPT.destroyChart(...)`、`PPT.resizeCharts(...)`",
    "- 禁止旧写法 anime({ targets, ... }) / anime.timeline(...)",
    "- 禁止直接调用 new Chart(...)，请改用 PPT.createChart(canvasOrSelector, config)",
    "- 若使用图表，canvas 外层容器必须有明确高度（如 h-64 / h-[280px]）；不要仅依赖 canvas 的 flex-1/h-full",
    "- 优先使用 Tailwind utility class 组织布局与间距",
    "- 必须包含语义结构：title 区(data-role=title) + content 区(data-role=content)，并为可编辑块添加 data-block-id",
  ].join("\n");
}
