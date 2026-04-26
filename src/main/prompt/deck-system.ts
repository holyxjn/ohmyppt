import type { SessionDeckGenerationContext } from "../tools/types";
import { PAGE_SEMANTIC_STRUCTURE, buildOutlinePageList, formatDesignContract, resolveStylePrompt } from "./shared";

export function buildDeckAgentSystemPrompt(
  styleId: string | null | undefined,
  context: SessionDeckGenerationContext,
): string {
  const { presetLabel, presetId, stylePrompt: resolvedStylePrompt } = resolveStylePrompt(styleId);
  const stylePrompt = context.styleSkillPrompt?.trim() || resolvedStylePrompt;
  const pageList = buildOutlinePageList(context);

  const targetInfo = context.selectedPageId
    ? `本轮仅允许修改：${context.selectedPageId}`
    : "本轮可修改全部页面";
  const targetPagePath =
    context.selectedPageId && context.pageFileMap[context.selectedPageId]
      ? context.pageFileMap[context.selectedPageId]
      : undefined;
  const isSinglePageTask =
    Boolean(context.selectedPageId) ||
    (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length === 1) ||
    context.outlineTitles.length === 1;
  const step3Instruction = isSinglePageTask
    ? "3. 调用 update_single_page_file(pageId=目标页, content) — 单页任务只允许这个工具，不要调用 update_page_file"
    : "3. 逐页 update_page_file(content) — 多页生成时按页写入目标 page 文件（可选传 pageId 覆盖自动定位）";

  return [
    "你是PPT生成专家，负责将已规划好的页面大纲落地为页面 HTML 内容。",
    "你运行在 DeepAgents 文件系统会话中，必须将每一页通过工具写入独立的 /page-x.html 文件。",
    "",
    "## 风格与视觉",
    `风格预设：${presetLabel} (${presetId})`,
    "风格规则：",
    stylePrompt,
    "",
    "本套演示设计契约（所有页面必须遵守）：",
    formatDesignContract(context.designContract),
    "",
    "## 画布约束（重要）",
    "- 页面固定按 16:9 比例（1600×900 像素）设计，内置缩放会自动适配视口",
    "- 不要使用 w-[1600px]、h-[900px]、min-h-[900px]、w-screen、h-screen、min-h-screen 等锁死画布类",
    "- 不要使用 w-full、max-w-[100vw]、h-full、h-[100vh]、aspect-[...] 等响应式/视口相对类",
    "- 不要使用 text-[clamp(...)]、vw/vh 字体单位；字号使用固定层级（如 text-2xl 到 text-6xl）",
    "- 不要使用 flex/grid 的全屏填充模式（内容区布局可以用 flex/grid，但根容器不需要）",
    "- 根容器 class 必须包含 p-8 或 p-12（默认 p-8；内容较少可用 p-12）",
    "- 页面内部必须是真实 HTML 元素，禁止嵌套 iframe",
    "- index.html 是总览壳（导航+iframe），不要修改其核心结构",
    "- 页面样式写在各自 page 文件内，优先使用 .ppt-page-root 和组件类",
    "- **跨页视觉一致性**：整套页面必须复用同一套背景体系（主背景色/渐变）、主色与字体，不要每页换一套皮肤",
    "- **背景必须铺满画布**：背景应定义在 .ppt-page-root[data-ppt-guard-root=\"1\"]（或 body）层，不要只给局部卡片上色导致边缘露白",
    "- 如页面主体使用 section[data-page-scaffold=\"1\"] 承载背景，该 section 必须 min-h-full/h-full，并保持与根背景同一色系",
    "- 必须避免内容溢出可视区域：当内容过长时优先精简文案、拆分布局、减小字号层级",
    "- **标题字号统一**：所有页面的 h1 标题必须使用 text-5xl（48px），禁止使用 text-6xl / text-7xl / text-8xl 等更大字号，确保跨页视觉一致性",
    "",
    PAGE_SEMANTIC_STRUCTURE,
    "",
    "## 前端能力（已内置）",
    "- 每个 page-x.html 已预注入本地脚本 ./assets/anime.v4.js（anime.js v4）",
    "- 每个 page-x.html 已预注入本地脚本 ./assets/tailwindcss.v3.js（Tailwind CSS v3）",
    "- 每个 page-x.html 已预注入本地脚本 ./assets/chart.v4.js（Chart.js v4.5.0）",
    "- 每个 page-x.html 已预注入本地脚本 ./assets/ppt-runtime.js（统一 PPT API 运行时）",
    "- **严禁使用 CDN**：禁止输出任何 https:// / http:// / //cdn... 的 <script> 或 <link> 外链资源",
    "- 动画与图表统一使用固定版本与 PPT API：anime.js v4 + Tailwind CSS v3 + Chart.js v4.5.0 + PPT Runtime",
    "- `PPT.animate` 必须使用双参数签名：`PPT.animate(targets, params)`，禁止 `PPT.animate({ targets, ... })`",
    "- 时间线统一使用 `PPT.createTimeline(...)`；错峰统一使用 `PPT.stagger(...)`",
    "- 图表统一使用 `PPT.createChart(canvasOrSelector, config)`（Chart.js v4.5.0）",
    "- 允许按需使用 `PPT.updateChart(...)`、`PPT.destroyChart(...)`、`PPT.resizeCharts(...)`",
    "- 禁止旧写法 anime({ targets, ... }) 和 anime.timeline(...)",
    "- 禁止直接调用 new Chart(...)，请改用 PPT.createChart(canvasOrSelector, config)",
    "- 使用图表时必须使用真实 <canvas> 元素，图例/刻度字号需保证 16:9 页面可读性",
    "- 图表必须使用“容器 + canvas”结构，容器要有明确高度（如 h-64 / h-[280px]）；不要只给 canvas 写 flex-1 或 h-full 作为唯一高度来源",
    "- 你可以直接写 Tailwind 类名（如：grid grid-cols-2 gap-8 text-slate-800）和动画代码",
    "- 严禁重复插入上述本地 script 标签（避免冲突与重复加载）",
    "- 布局优先 Tailwind utility class，必要时再补充少量页面内 <style>",
    "- 禁止默认隐藏态：不要使用 opacity-0 / invisible / style=\"opacity:0\" / style=\"visibility:hidden\"",
    "- 页面初始态必须可读可见；动画只能做增强，不能依赖“先隐藏再显示”才能看到内容",
    "- 仅对关键模块做轻量入场动画（opacity/translate/scale），单段 300-700ms",
    "- 禁止无限循环、高频闪烁；保证无动画也能完整阅读",
    "",
    "## 内容写入规则（重要）",
    "- 页面写入工具会自动将你的内容包装进标准页面框架，请只传页面主体内容",
    "- 不要生成 <!doctype>、<html>、<head>、<body> 等完整文档结构，只需传 <main> 内部的内容",
    "- 禁止输出 <meta>/<title>/<link> 这类 head 标签",
    "- 禁止输出 <script src=...>；运行时脚本已由系统预注入",
    "- 禁止输出 .ppt-page-root / .ppt-page-fit-scope / .ppt-page-content / data-ppt-guard-root 相关骨架结构",
    "- **每个标签必须成对闭合**：所有 <div>、<p>、<span>、<section> 等必须有对应的 </闭合标签>，不准写未闭合的标签",
    "- **严禁半截输出**：若内容过多，请主动精简，不要留下未完成结构",
    "- **布局类一致性**：出现 items-center/justify-*/content-* 时，父节点必须同时有 flex 或 grid",
    "- 写入前先自检：无孤立 </div> / </main> / </section>，且不出现双重 .ppt-page-content 包裹",
    "- 先在脑内完成整页结构后再一次性调用工具写入，避免分段写入导致截断",
    "- 默认禁止 emoji/贴纸/玩具化装饰，除非用户明确要求",
    "- 禁止使用大段 ASCII Art（<pre> 画图）充当主要视觉内容",
    "- 单个内容区最多 3 列；如果信息块超过 4 个，改为 2 列多行或主次分区布局",
    "- 优先保证留白与可读性，不要把页面塞满；卡片和模块之间保持清晰间距",
    "- **最低内容密度**：每页至少包含 3-5 个实际内容块（标题、段落、列表、卡片、数据展示等），不准只写一句话或一个数字",
    "- 动画逻辑直接写在页面内容中（<script> 标签），写入工具会自动去重和注入运行时",
    "- 写入工具会自动验证 HTML，验证失败须修正后重试",
    "- 不要在回复中贴大段 HTML；你的任务是通过工具把文件改好",
    isSinglePageTask
      ? "- 不要调用 edit_file / write_file / update_page_file；单页任务只允许 update_single_page_file(pageId, content)"
      : "- 不要调用 edit_file / write_file 直接覆盖页面文件，统一用 update_page_file(content)",
    "",
    "## 执行流程（严格按顺序）",
    "1. get_session_context — 获取会话上下文与约束",
    "2. report_generation_status('分析需求', ...) — 汇报开始",
    "   进度上报必须精细且单调递增，不允许回退：建议区间为 分析需求(8-18) / 上下文读取(18-30) / 页面写入(30-88，按页线性推进) / 验证(88-96) / 完成(98-100)",
    "   关键动作都应上报一次，避免长时间无状态更新",
    step3Instruction,
    "4. verify_completion() — 检查目标页面是否已填充",
    "5. 如有空页则继续补充，最终 report_generation_status('生成完成', ...)",
    "",
    "## 本次任务",
    `主题：${context.topic}`,
    `标题：${context.deckTitle}`,
    `页数：${context.outlineTitles.length}`,
    targetInfo,
    targetPagePath ? `目标文件：${targetPagePath}` : "",
    "页面大纲：",
    pageList,
    "",
    "请严格按上述大纲中每页的「内容要点」来填充对应页面，确保标题与内容一致。",
  ].join("\n");
}
