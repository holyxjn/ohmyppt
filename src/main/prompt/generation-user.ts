import type { DesignContract, SessionDeckGenerationContext } from "../tools/types";
import { CONTENT_LANGUAGE_RULES, buildOutlinePageList, formatDesignContract } from "./shared";

export function buildDeckGenerationPrompt(context: SessionDeckGenerationContext): string {
  const pageList = buildOutlinePageList(context);
  return [
    "Use the tools to write the deck content into each /page-x.html according to the user requirements and page outline below:",
    "",
    `Topic: ${context.topic}`,
    `Deck title: ${context.deckTitle}`,
    "Page outline:",
    pageList,
    "",
    "Additional user requirements:",
    context.userMessage,
    "",
    CONTENT_LANGUAGE_RULES,
    "",
    "Built-in capabilities are already available: anime.js v4, Tailwind CSS, Chart.js v4.5.0, KaTeX formula rendering, and PPT Runtime. Do not re-import local runtime scripts.",
    "Write math directly with LaTeX delimiters: inline \\( f'(x)>0 \\), block \\[ \\frac{dy}{dx} \\] or $$\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}$$. Do not use single $...$ delimiters, and do not render formulas as images.",
    "Do not use any CDN or external http/https script/link resources.",
    "",
    "Follow the page semantic structure: the outer fragment only needs the content semantic entry; put the title inside content and mark it with data-role=\"title\". The layout decides its position.",
    "data-role=\"title\" is not a fixed top header. Choose title position and layout per slide based on content and visual focus. Reuse effective structures when useful, but avoid mechanical repetition.",
    "",
    "Fill each slide strictly according to the content points in the page outline above.",
  ].join("\n");
}

export function buildSinglePageGenerationPrompt(args: {
  topic: string;
  deckTitle: string;
  pageId: string;
  pageNumber: number;
  pageTitle: string;
  pageOutline: string;
  sourceDocumentPaths?: string[];
  referenceDocumentSnippets?: string;
  isRetryMode?: boolean;
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
        "Retry fixes to prioritize:",
        `- This is retry ${args.retryContext.attempt}/${args.retryContext.maxRetries}.`,
        `- Previous failure: ${args.retryContext.previousError}`,
        "- Output only the page fragment. It must include section[data-page-scaffold] and main[data-block-id=\"content\"][data-role=\"content\"]. Do not output a full document, page shell, or runtime scripts.",
        "- If the previous issue was unclosed tags, simplify the structure and ensure every section/div/p/span/li tag is paired.",
        "- If the previous issue was page shell structure, do not include .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, or data-ppt-guard-root.",
        "- If the previous issue was animation/chart API usage, use PPT.animate, PPT.createTimeline, PPT.stagger, and PPT.createChart.",
      ]
    : [];
  const sourceDocumentInstructions =
    args.sourceDocumentPaths && args.sourceDocumentPaths.length > 0
      ? args.referenceDocumentSnippets && args.referenceDocumentSnippets.trim().length > 0
        ? [
            "",
            args.referenceDocumentSnippets.trim(),
            "",
            "Source document requirements:",
            "- This slide already has program-side retrieved snippets. Prioritize these snippets when generating slide content.",
            "- If the snippets cover this slide title and content points, you do not need to reread the entire source document.",
            `- If snippets are insufficient, conflicting, or missing key facts, use read_file to confirm the source document: ${args.sourceDocumentPaths.join(", ")}`,
            "- Use only source-document facts directly relevant to this slide outline. Do not move material for other slides into this slide.",
            args.isRetryMode
              ? "- This is a failed-slide retry. Match source material only around this slide title and content points; do not reconstruct the whole deck outline."
              : "",
            "- Do not expand only from the outline. Do not invent exact numbers, dates, system names, or status claims not present in the snippets or source document.",
          ].filter(Boolean)
        : [
            "",
            "Source document requirements:",
            `- No retrieved snippets matched this slide. Before generating the slide, use read_file to read the source document: ${args.sourceDocumentPaths.join(", ")}`,
            "- First extract keywords, business objects, time points, system names, and metrics from this slide title and content points; then match relevant source passages.",
            "- Do not copy the whole document indiscriminately. Use only source-document facts directly relevant to this slide outline.",
            args.isRetryMode
              ? "- This is a failed-slide retry. Match source material only around this slide title and content points; do not reconstruct the whole deck outline."
              : "",
            "- Do not expand only from the outline. Do not invent exact numbers, dates, system names, or status claims not present in the source document.",
          ].filter(Boolean)
      : [];
  return [
    "Generate and write only this slide. Do not modify other slides.",
    "",
    `Topic: ${args.topic}`,
    `Deck title: ${args.deckTitle}`,
    `Target page: ${args.pageId} (slide ${args.pageNumber})`,
    `Slide title: ${args.pageTitle}`,
    `Content points: ${args.pageOutline || "Expand from the topic with moderate information density."}`,
    ...sourceDocumentInstructions,
    "",
    CONTENT_LANGUAGE_RULES,
    "",
    "Deck-wide design contract. Follow it to keep pages visually consistent:",
    formatDesignContract(args.designContract),
    ...retryInstructions,
    "",
    "Expansion rules:",
    "- Treat content points as short seed phrases. Expand each seed into presentable modules such as headings, explanations, lists, charts, comparisons, or conclusions.",
    "- If there are 2-4 points, the final slide should cover all of them. You may add 1-2 supporting information blocks by priority.",
    "- You may complete reasonable data framing, examples, and structure, but do not drift away from the slide title and points.",
    "- Prefer visualization-friendly expression. When points involve trends, comparisons, or proportions, use charts or data cards when appropriate.",
    "",
    "强约束：",
    "- 只允许调用 update_single_page_file(pageId=目标页面, content)，禁止调用 update_page_file",
    "- content 参数必须是页面片段：包含 section[data-page-scaffold] 和 main[data-block-id=\"content\"][data-role=\"content\"]，标题放在 content 内并标记 data-role=\"title\"",
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
    "- 根容器 class 必须包含 p-2（默认 p-2），不要改成 p-8/p-12 这类大留白",
    "- 可用内容区约 1584×884；不要默认预留页脚/meta 区，页面主体只保留 content 语义入口",
    "- 页面主体用 h-full min-h-0 overflow-hidden；content 内可用 flex 或 grid 组织，标题可位于顶部、左侧、右侧、角落、卡片、图表旁、底部说明区或短竖排标签区；禁止主体滚动或内容溢出",
    "- data-role=\"title\" 只表示语义标题，不表示固定 header",
    "- 保持版式创意：根据内容、视觉重心和阅读路径自由选择上下、左右、居中、不对称、卡片式、图表旁标题等布局；可以复用有效结构，但不要机械重复",
    "- **硬约束：标题只要包含英文单词/英文缩写/年份/数字编号/中英混排，就禁止使用 writing-mode 竖排，必须横排显示**",
    "- 竖排只用于纯中文且 2-6 个字符的短标签；中文完整标题超过 8 个字必须横排。需要竖向视觉时，用短竖排标签 + 横排完整标题组合",
    "- 含英文标题需要侧边视觉时，只允许横排标题整体 rotate(-90deg/90deg) 或侧栏横排排版；禁止把英文、年份、数字逐字竖排",
    "- 内容超高时精简文字、减少卡片、降低图表高度或改紧凑 2 行布局；正文和关键数据必须在正常布局流内",
    "- **标题字号统一**：h1 标题必须使用 text-5xl（48px），禁止使用 text-6xl / text-7xl / text-8xl",
    "- 禁止使用大段 ASCII Art（<pre> 画图）充当主要视觉内容",
    "- 单个内容区最多 3 列；如果信息块超过 4 个，改为 2 列多行或主次分区布局",
    "- 优先保证留白与可读性，不要把页面塞满；卡片和模块之间保持清晰间距",
    "- 至少包含一段轻量入场动画（无闪烁、无无限循环）",
    "- 禁止默认隐藏态：不要使用 opacity-0 / invisible / style=\"opacity:0\" / style=\"visibility:hidden\"",
    "- 页面初始态必须可见；动画只做增强，不可依赖隐藏态作为前提",
    "- 可直接使用 anime.js v4、Tailwind CSS、Chart.js v4.5.0、KaTeX 公式渲染、PPT Runtime（均已预注入），禁止重复引入 runtime script",
    "- 禁止使用任何 CDN 外链资源（包括 script/link 的 http/https URL）",
    "- 动画、图表与公式统一使用固定本地资源：anime.js v4 + Tailwind CSS v3 + Chart.js v4.5.0 + KaTeX + PPT Runtime",
    "- `PPT.animate` 必须使用双参数签名：`PPT.animate(targets, params)`，禁止 `PPT.animate({ targets, ... })`",
    "- 时间线统一使用 `PPT.createTimeline(...)`；错峰统一使用 `PPT.stagger(...)`",
    "- 图表统一使用 `PPT.createChart(canvasOrSelector, config)`（Chart.js v4.5.0）",
    "- 允许按需使用 `PPT.updateChart(...)`、`PPT.destroyChart(...)`、`PPT.resizeCharts(...)`",
    "- 禁止旧写法 anime({ targets, ... }) / anime.timeline(...)",
    "- 禁止直接调用 new Chart(...)，请改用 PPT.createChart(canvasOrSelector, config)",
    "- 若使用图表，canvas 外层容器必须有明确高度（如 h-64 / h-[280px]）；不要仅依赖 canvas 的 flex-1/h-full",
    "- 图表 labels、ticks、tooltip 中的数字必须先格式化，避免显示 0.30000000000000004 这类 JS 浮点误差；小数建议用 Number(value.toFixed(3)) 或明确字符串标签",
    "- 数学公式请直接写 LaTeX 分隔符：行内用 \\( f'(x)>0 \\)，块级用 \\[ \\frac{dy}{dx} \\] 或 $$\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}$$；不要使用单 $...$，避免金额被误渲染；不要把公式做成图片",
    "- 优先使用 Tailwind utility class 组织布局与间距",
    "- 必须包含语义结构：一个 content 入口(data-block-id=content, data-role=content)；标题放在 content 内并标记 data-role=title，位置由版式决定",
    "- content 内所有主要可视元素都要有稳定唯一标识：可编辑子块必须添加唯一 data-block-id，同时为主要元素添加页面内唯一语义 class（如 ppt-chart-main / ppt-metric-1），便于检选、拖拽和局部编辑",
    "",
    CONTENT_LANGUAGE_RULES,
  ].join("\n");
}
