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
    "你可直接使用已内置能力：anime.js v4 + Tailwind CSS + Chart.js v4.5.0 + KaTeX 公式渲染 + PPT Runtime；不要重复引入本地 runtime script。",
    "数学公式请直接写 LaTeX 分隔符：行内用 \\( f'(x)>0 \\)，块级用 \\[ \\frac{dy}{dx} \\] 或 $$\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}$$；不要使用单 $...$，避免金额被误渲染；不要把公式做成图片。",
    "禁止使用任何 CDN 外链资源（包括 script/link 的 http/https URL）。",
    "",
    "请遵守页面语义结构：外层只需要 content 语义入口；标题放在 content 内并标记 data-role=\"title\"，由页面版式决定位置。",
    "注意：data-role=\"title\" 不是固定顶部标题区。每页根据内容和视觉重心自由决定标题位置与版式；可以复用有效结构，但不要机械重复。",
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
        "失败重试修正（本次必须优先处理）：",
        `- 当前是第 ${args.retryContext.attempt}/${args.retryContext.maxRetries} 次重试。`,
        `- 上次失败原因：${args.retryContext.previousError}`,
        "- 本次只输出页面片段，必须包含 section[data-page-scaffold] 和 main[data-block-id=\"content\"][data-role=\"content\"]；不要输出完整文档、页面骨架或运行时脚本。",
        "- 如果上次是标签闭合问题，请主动精简结构，确保每个 section/div/p/span/li 等标签成对闭合。",
        "- 如果上次是骨架问题，请不要包含 .ppt-page-root、.ppt-page-content、.ppt-page-fit-scope 或 data-ppt-guard-root。",
        "- 如果上次是动画/图表 API 问题，请统一使用 PPT.animate / PPT.createTimeline / PPT.stagger / PPT.createChart。",
      ]
    : [];
  const sourceDocumentInstructions =
    args.sourceDocumentPaths && args.sourceDocumentPaths.length > 0
      ? args.referenceDocumentSnippets && args.referenceDocumentSnippets.trim().length > 0
        ? [
            "",
            args.referenceDocumentSnippets.trim(),
            "",
            "源文档要求（必须优先执行）：",
            "- 本页已有程序侧预检索片段。请优先基于这些片段生成页面内容。",
            "- 如果片段已经覆盖本页标题和内容要点，不需要重复读取整份源文档。",
            `- 如果片段不足、互相冲突，或缺少关键事实，必须使用 read_file 读取源文档补充确认：${args.sourceDocumentPaths.join("、")}`,
            "- 只使用与本页大纲直接相关的源文档事实，不把其他页面的材料提前塞入本页。",
            args.isRetryMode
              ? "- 当前是失败页重试，只围绕本页标题和内容要点在源文档中匹配补充材料，不重构整套大纲。"
              : "",
            "- 不要只根据大纲扩写；不得编造片段和源文档没有的精确数字、日期、系统名或功能状态。",
          ].filter(Boolean)
        : [
            "",
            "源文档要求（必须优先执行）：",
            `- 本页没有命中预检索片段。生成页面前必须先用 read_file 读取源文档：${args.sourceDocumentPaths.join("、")}`,
            "- 先从本页标题和内容要点中提取关键词、业务对象、时间节点、系统名和指标，再到源文档中匹配相关段落。",
            "- 不要无差别搬运全文，只使用与本页大纲直接相关的源文档事实。",
            args.isRetryMode
              ? "- 当前是失败页重试，只围绕本页标题和内容要点在源文档中匹配补充材料，不重构整套大纲。"
              : "",
            "- 不要只根据大纲扩写；不得编造源文档没有的精确数字、日期、系统名或功能状态。",
          ].filter(Boolean)
      : [];
  return [
    "请只生成并写入这一页，不要修改其他页面。",
    "",
    `主题：${args.topic}`,
    `标题：${args.deckTitle}`,
    `目标页面：${args.pageId}（第 ${args.pageNumber} 页）`,
    `页面标题：${args.pageTitle}`,
    `内容要点：${args.pageOutline || "按主题自行扩展，但保持信息密度适中"}`,
    ...sourceDocumentInstructions,
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
  ].join("\n");
}
