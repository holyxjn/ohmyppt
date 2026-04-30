# 更新日志 / Changelog

## 2026-04-30

- 优化页面调整体验：一切皆可拖拽，现在可以直接拖拽和缩放，调整文字、图片、公式、列表、数据标签和图表更顺手。
- 优化调整保存流程：页面调整不会立即保存，可连续微调多个元素后统一确认，也可以退出并放弃本次调整。
- 优化 AI 生成版式：页面标题和内容布局更灵活，生成结果不再局限于固定的顶部标题模板。
- 优化图表展示效果：坐标轴、提示信息和数据标签更清爽，减少过长数字和图表显示异常。
- 新增中英文界面语言：应用界面可切换中文或英文，生成内容仍会根据用户输入和资料自行判断语言。
- 优化生成进度展示：进度日志更简洁统一，减少重复、混杂或过度解释的状态信息。
- 优化页面版式延续性：生成、编辑和重试时会更好地延续每页原本的内容结构和视觉方向。
- 优化模型设置体验：常用模型配置更清晰，高级超时参数独立收纳，适合本地模型或响应较慢的模型按需调整。
- 优化会话详情页体验：顶部工具、预览标题、右侧消息面板和整体圆角更克制，界面层次更清爽。
- 优化图表生成稳定性：减少图表高度异常、被压缩或显示不完整的问题。

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

- Improved slide adjustment: more slide content can now be moved and resized directly, making text, images, formulas, lists, data labels, and charts easier to refine.
- Improved the adjustment flow: layout edits are no longer saved immediately, so users can make several changes and then confirm or discard them together.
- Improved AI-generated layouts: titles and content placement are more flexible, moving beyond a fixed top-title template.
- Improved chart presentation: axes, tooltips, and data labels are cleaner, with fewer overly long numbers and fewer visual glitches.
- Added Chinese and English interface languages: the app UI can switch languages while generated content still follows the user's prompt and source materials.
- Improved generation progress: progress logs are cleaner and more consistent, with less repetition and fewer overly verbose status messages.
- Improved slide layout continuity: generation, editing, and retries now better preserve each slide's content structure and visual direction.
- Improved model settings: common model fields are easier to scan, while advanced timeout controls are tucked away for slower or local models.
- Improved the session detail experience: toolbar buttons, preview titles, the message panel, and overall corner radii now feel more restrained and easier to read.
- Fixed duplicate messages during single-slide editing: current-slide edits now show a cleaner, more stable conversation flow.
- Improved chart stability: reduced cases where charts appear compressed, clipped, or lose their intended height.

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
