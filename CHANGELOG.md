# 更新日志 / Changelog

## 2026-05-11 · v2.0.5

### 中文

- 新增页面支持拖拽排序调整位置功能
- 新增可以删除页面的功能
- 优化历史版本体验：让历史列表更像一条清楚的创作时间线（增加更多操作日志记录）。
- 优化回退体验：回退到历史版本后，页面列表、页面顺序和预览内容更稳定。
- 优化老会话体验：从旧版本创建或切换过输出目录的会话，在预览、编辑、回退时更稳定。
- 优化页面编辑稳定性：单页编辑、全局修改和局部修改更稳，系统会更主动地修正不完整的编辑结果。
- 优化生成和编辑的错误提示：用户看到的是可理解的进度和失败提示。
- 优化导入和历史会话编辑：PPTX 导入会话和历史会话在继续编辑时更稳定。
- 优化风格表达：生成结果更强调情绪、叙事和表达，更加感性。

### English

- Added drag-and-drop page reordering.
- Added page deletion.
- Added history entries for page deletion.
- Improved the version history experience so the timeline reads like a clear creation story.
- Improved rollback reliability so the page list, page order, and preview stay consistent after reverting.
- Improved older sessions created in previous versions or sessions affected by output directory changes, making previewing, editing, and rollback more stable.
- Improved edit reliability for single-slide edits, deck-wide edits, and element-level edits, with more proactive recovery for incomplete edit results.
- Improved error messages for generation and editing so users see clear progress and understandable failures.
- Improved continuing edits for PPTX-imported sessions and historical sessions.
- Improved style expression so results feel more emotional, narrative, and expressive.

## 2026-05-09

### 中文

- 新增图片解析创建：首页上传图片（png/jpg/jpeg/webp）后，系统自动从图片内容生成演示提纲，同时提取视觉风格并保存为自定义风格 Skill，创建表单一键回填。
- 新增图片导入风格：风格编辑页支持直接导入图片，自动提取配色、字体、版式、组件等视觉规则并回填表单。
- 新增版本历史：每次生成或编辑自动记录历史版本，支持查看和回退到任意历史版本，即使改错也能回退到之前版本。
- 新增主会话编辑：主会话现在可以统一修改一个或多个页面，不再仅限于单页编辑，即使改错也能回退到之前版本。
- 新增视频素材插入：会话详情页支持上传 mp4/webm/ogg 视频素材，并可在页面编辑中引用本地视频路径插入到指定位置。
- 优化编辑稳定性：页面编辑和主会话编辑进入自动修复阶段，遇到页面校验失败时会带错误信息自动重试一次，减少坏页面和手动重试。
- 优化删除提示：会话列表删除和历史版本回退等操作改为弹窗二次确认。

### English

- Added image-based creation and image style import.
- Added version history and main-session editing.
- Added video assets for page edits (mp4/webm/ogg).
- Improved edit reliability with one automatic retry after page validation failures.
- Improved delete and rollback confirmations.

## 2026-05-08

### 中文

 - 新增风格提取：导入文件或 PPTX 后，自动提取配色、字体和布局风格，保存为独立的风格 Skill。
 - 优化 PPTX 导入：导入 PPTX 后自动提取原稿视觉风格Skill保存到系统中，新增页面时自动继承原 PPTX 的配色、字体和布局。

### English

- Added style extraction: imported files and PPTX presentations automatically have their visual style extracted and saved as a reusable Style Skill.
- Improved PPTX import: newly added pages now inherit the imported PPTX's original colors, typography, and layout.

## 2026-05-07

### 中文

 - 新增编辑页：可以新增页面，每个页面可以包含多个元素。
 - 优化pptx：优化了导出pptx的流程，支持更多pptx的元素导出。
 - 优化性能： 优化整个应用的性能和稳定性。

### English

- Added page insertion: add new pages to an existing deck, each supporting multiple elements.
- Improved PPTX export: refined the export pipeline to support a wider range of PPTX elements.
- Improved performance: overall app performance and stability improvements.

## 2026-05-06

### 中文

- 新增文字编辑：双击选中页面文字后可直接修改内容和样式，修改结果实时同步到页面。
- 新增生成取消：创意生成过程中可随时取消。
- 优化检选模式：选中元素后的操作更精准，修改体验更顺畅。
- 优化编辑模式：完善单页编辑流程，编辑结果更稳定。
- 优化生成进度：底部新增阶段指示（准备 → 规划 → 生成 → 校验），实时显示页面完成进度。
- 优化生成日志：日志更简洁，只保留关键进度和结果，减少刷屏。
- 优化生成速度和稳定性：整体生成速度提升约 20%-40%，提升模型的生成成功率，单页编辑响应更快。
- 优化会话列表：显示每次生成的耗时，方便对比不同配置的生成效果。

### English

- Added text editing: select text on a slide to edit content and styling directly, with changes synced in real time.
- Improved element selection: selecting and modifying elements is more precise and fluid.
- Improved editing mode: refined the single-slide editing workflow for more reliable results.
- Improved generation progress: a new step indicator (Prepare → Plan → Generate → Validate) shows the current stage and real-time page count.
- Improved generation logs: cleaner log output showing only key milestones and results.
- Improved generation speed: overall generation is approximately 20–40% faster, with quicker single-slide edits.
- Improved generation reliability: enhanced page-write validation with automatic retries on failure.
- Added generation cancellation: cancel an in-progress generation at any time.
- Improved session list: generation duration is shown for each session.

---

## 2026-05-01

### 中文

- 新增多模型列表管理：可以在设置中添加多个模型，并把常用模型设为默认模型，随意切换模型（Breaking change）。
- 优化生成稳定性： 生成的稳定性得到了显著提升，减少了直接失败的情况。
- 优化错误提示：设置和生成相关提示会跟随当前界面语言显示中文或英文。
- 优化生成页日志：日志面板滚动更稳定，连续生成时更容易看到最新进度。
- 优化pptx导出：对于pptx导出进一步做优化策略，进一步提升导出效果（未引入ocr识别）。

### English

- Added multi-model list management: add multiple models in Settings, choose a default model, and switch between models freely.
- Improved generation stability: generation is noticeably more reliable, with fewer cases that fail outright.
- Improved error messages: Settings and generation errors now follow the current interface language.
- Improved generation logs: the log panel scrolls more reliably and keeps the latest progress easier to see.
- Improved PPTX export: added further export optimizations without introducing OCR.

---

## 2026-04-30

### 中文

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

### English

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

---

## 2026-04-29

### 中文

- 新增 PPTX 导入：可把本地 PPTX 转成应用内可编辑的演示稿，再继续预览、调整和对话修改。
- 优化从文档创建演示：上传文档后会更稳定地整理主题、页数和详细描述，大纲页数会更贴近实际内容。
- 新增数学公式渲染：生成的页面可直接显示常见 LaTeX 公式，导出时也会尽量保留公式效果。
- 优化可编辑 PPTX 导出：减少文字重叠问题，提升中英文混排和公式页面的导出效果。
- 优化首页入口：文档解析和 PPTX 导入入口更清晰，并提示本地文档只会在本机处理。
- 优化会话列表：可区分 AI 创建和 PPTX 导入的演示稿，并支持修改演示稿名称。

### English

- Added PPTX import: convert local PPTX files into editable in-app presentations for previewing, positioning, and chat-based editing.
- Improved document-based creation: uploaded documents now produce more reliable topics, page counts, and descriptions, with outlines that better match the content.
- Added math formula rendering: generated pages can display common LaTeX formulas, and exports try to preserve formula visuals.
- Improved editable PPTX export: reduced text overlap and improved mixed Chinese/English and formula-heavy slides.
- Improved the Home page: document parsing and PPTX import are easier to find, with clearer local-document privacy messaging.
- Improved the session list: imported PPTX sessions are easier to identify, and presentation names can be renamed.

---

## 2026-04-28

### 中文

- 新增页面元素拖拽调整：在预览中开启“调整位置”后，可直接拖拽带结构标识的页面模块并保存位置。
- 新增从文档创建演示：可上传 txt、md、csv、docx 文档，自动整理主题、页数和详细描述。
- 补充动画能力文档：说明基于 Anime.js v4 的基础整元素动画，并加入示例 GIF。
- 优化文档生成体验：上传较长文档后，每页内容会更贴近原文对应部分，生成速度和稳定性更好。
- 优化 OpenAI 兼容模型体验：默认关闭 thinking，减少文档解析、工具调用和重试生成时的兼容报错。
- 优化会话详情页结构：拆分页面侧栏、预览区、顶部工具栏和消息面板。

### English

- Added drag-to-position editing: enable Adjust Position in preview to drag structured page blocks and persist their layout.
- Added document-based creation: upload txt, md, csv, or docx files to automatically prepare the topic, page count, and description.
- Added animation documentation: describes basic Anime.js v4-powered whole-element animations with an example GIF.
- Improved document-based creation: pages now stay closer to the relevant parts of long uploaded documents, with better speed and stability.
- Improved OpenAI-compatible model behavior: thinking mode is disabled by default to reduce compatibility errors during document parsing, tool calls, and retry generation.
- Improved the session detail architecture: split the page sidebar, preview stage, top toolbar, and message panel, and added a page-level UI store for local state.

---

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

---

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
