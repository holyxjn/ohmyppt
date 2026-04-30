# 更新日志 / Changelog

## 2026-04-30

- 优化页面调整体验：万物皆可拖拽和调整大小，可直接拖拽和缩放更多页面元素，包括文字、图片、公式、列表项、数据标签和图表容器。
- 调整改为手动确认：拖拽或缩放后不会立即保存，可继续调整多个元素，最后统一保存或退出不保存。
- 优化 AI 生成版式：标题和页面更加自由创意。
- 优化图表显示：减少小数标签出现过长浮点数的问题，让坐标轴、tooltip 和标签更清爽。

## 2026-04-29

- 新增 PPTX 导入：可把本地 PPTX 转成应用内可编辑的演示稿，再继续预览、调整和对话修改。
- 优化从文档创建演示：上传文档后会更稳定地整理主题、页数和详细描述，大纲页数会更贴近实际内容。
- 新增数学公式渲染：生成的页面可直接显示常见 LaTeX 公式，导出时也会尽量保留公式效果。
- 优化可编辑 PPTX 导出：减少文字重叠问题，提升中英文混排和公式页面的导出效果。
- 优化首页入口：文档解析和 PPTX 导入入口更清晰，并提示本地文档只会在本机处理。
- 优化会话列表：可区分 AI 创建和 PPTX 导入的演示稿，并支持修改演示稿名称。


## 2026-04-28

### 中文

- 新增页面元素拖拽调整：在预览中开启“调整位置”后，可直接拖拽带结构标识的页面模块并保存位置。
- 新增从文档创建演示：可上传 txt、md、csv、docx 文档，自动整理主题、页数和详细描述。
- 补充动画能力文档：说明基于 Anime.js v4 的基础整元素动画，并加入示例 GIF。
- 优化文档生成体验：上传较长文档后，每页内容会更贴近原文对应部分，生成速度和稳定性更好。
- 优化 OpenAI 兼容模型体验：默认关闭 thinking，减少文档解析、工具调用和重试生成时的兼容报错。
- 优化会话详情页结构：拆分页面侧栏、预览区、顶部工具栏和消息面板。

## 2026-04-27

### 中文

- 新增版本提醒：应用启动后会检查 GitHub Releases，如有新版本会提示用户前往下载。
- 优化生成恢复逻辑：应用意外或者退出后，可以根据已完成页面继续恢复进度。
- 优化失败处理：全部失败时提示重新生成；部分完成时提示继续生成剩余页面。
- 优化重试链路：只重试未完成页面，并保留用户补充说明。
- 优化编辑稳定性：编辑时会校验页面结构，避免坏页面被误标记为完成。
- 优化模型配置：生成与编辑统一使用系统设置中的最新模型配置。
- 优化模型稳定性：增强大纲规划与 JSON 输出解析，减少弱模型或本地模型格式异常导致的失败。
- 新增可编辑 PPTX 导出：尽量保留文字、图片、颜色与基础布局，方便在 PowerPoint / Keynote 中继续编辑。
- 新增批量 PNG 导出：一键将当前 deck 的所有页面导出为图片。
- 优化 PDF / PNG / PPTX 导出稳定性：导出时尽量使用静态页面状态，减少动画对输出结果的影响。
- 优化页面生成约束：生成时按固定 16:9 画布和内容高度预算组织页面，减少元素超出画布的问题。
- 优化 README 文档：补充多格式导出说明，并完善 macOS / Windows 未签名应用打开指引。

## 2026-04-26

### 中文

- 支持通过一句话生成本地 HTML 幻灯片。
- 支持逐页预览、演示模式和键盘切换。
- 支持对话式修改当前页内容。
- 支持检选页面元素后精准修改。
- 支持图片素材上传到本地会话目录并在编辑时引用。
- 支持一键导出 PDF。
- 新增风格管理，可查看、编辑和新增风格 Skill。
- 优化生成页动画、缩略图列表、预览画布和右侧 AI 面板体验。
- 补充 Ollama / OpenAI 兼容模型使用说明。
- 补充 macOS 与 Windows 未签名应用打开说明。

---

## 2026-04-30

- Improved slide adjustment: more visible elements can now be dragged and resized, including text, images, formulas, list items, data labels, and chart containers.
- Changed adjustments to manual confirmation: drag or resize multiple elements first, then save all changes together or exit without saving.
- Improved preview refresh behavior: exiting without saving now reloads only the current slide instead of refreshing every thumbnail.
- Improved AI layout variety: titles are no longer treated as fixed top headers, allowing side titles, corner titles, title cards, and chart-adjacent titles.
- Improved chart readability: reduced overly long floating-point labels in axes, tooltips, and chart labels.

## 2026-04-29

- Added PPTX import: convert local PPTX files into editable in-app presentations for previewing, positioning, and chat-based editing.
- Improved document-based creation: uploaded documents now produce more reliable topics, page counts, and descriptions, with outlines that better match the content.
- Added math formula rendering: generated pages can display common LaTeX formulas, and exports try to preserve formula visuals.
- Improved editable PPTX export: reduced text overlap and improved mixed Chinese/English and formula-heavy slides.
- Improved the Home page: document parsing and PPTX import are easier to find, with clearer local-document privacy messaging.
- Improved the session list: imported PPTX sessions are easier to identify, and presentation names can be renamed.


## 2026-04-28

### English

- Added drag-to-position editing: enable Adjust Position in preview to drag structured page blocks and persist their layout.
- Added document-based creation: upload txt, md, csv, or docx files to automatically prepare the topic, page count, and description.
- Added animation documentation: describes basic Anime.js v4-powered whole-element animations with an example GIF.
- Improved document-based creation: pages now stay closer to the relevant parts of long uploaded documents, with better speed and stability.
- Improved OpenAI-compatible model behavior: thinking mode is disabled by default to reduce compatibility errors during document parsing, tool calls, and retry generation.
- Improved the session detail architecture: split the page sidebar, preview stage, top toolbar, and message panel, and added a page-level UI store for local state.

## 2026-04-27

### English

- Added update notifications: the app checks GitHub Releases on startup and lets users open the release page when a newer version is available.
- Improved generation recovery: progress can be restored from completed pages after an unexpected app exit.
- Improved failure handling: fully failed sessions prompt regeneration, while partially completed sessions can continue remaining pages.
- Improved retry flow: only unfinished pages are retried, and user retry notes are preserved.
- Improved edit stability: page structure is validated before marking edits as completed.
- Unified model settings: generation and editing now always use the latest model configuration from Settings.
- Improved model stability: outline planning and JSON output parsing are more tolerant of malformed local/weak-model responses.
- Added editable PPTX export: preserves text, images, colors, and basic layout where possible for continued editing in PowerPoint / Keynote.
- Added batch PNG export: export every slide in the current deck as images with one click.
- Improved PDF / PNG / PPTX export stability: exports use a static slide state where possible to reduce animation-related output issues.
- Improved generation layout constraints: slides now follow a fixed 16:9 canvas and content-height budget to reduce overflow.
- Updated README docs: added multi-format export notes and clearer macOS / Windows unsigned-app instructions.

## 2026-04-26

### English

- Added one-prompt local HTML slide generation.
- Added page-by-page preview, presentation mode, and keyboard navigation.
- Added chat-based editing for the current page.
- Added element inspection for more precise edits.
- Added local image asset uploads for use during page editing.
- Added one-click PDF export.
- Added style management for viewing, editing, and creating style skills.
- Improved the generation animation, thumbnail list, preview canvas, and AI message panel.
- Added usage notes for Ollama / OpenAI-compatible models.
- Added notes for opening unsigned macOS and Windows builds.
