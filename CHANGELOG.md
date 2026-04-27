# 更新日志 / Changelog

## 2026-04-27

### 中文

- 新增版本提醒：应用启动后会检查 GitHub Releases，如有新版本会提示用户前往下载。
- 优化生成恢复逻辑：应用意外或者退出后，可以根据已完成页面继续恢复进度。
- 优化失败处理：全部失败时提示重新生成；部分完成时提示继续生成剩余页面。
- 优化重试链路：只重试未完成页面，并保留用户补充说明。
- 优化编辑稳定性：编辑时会校验页面结构，避免坏页面被误标记为完成。
- 优化模型配置：生成与编辑统一使用系统设置中的最新模型配置。
- 优化模型稳定性：增强大纲规划与 JSON 输出解析，减少弱模型或本地模型格式异常导致的失败。

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

## 2026-04-27

### English

- Added update notifications: the app checks GitHub Releases on startup and lets users open the release page when a newer version is available.
- Improved generation recovery: progress can be restored from completed pages after an unexpected app exit.
- Improved failure handling: fully failed sessions prompt regeneration, while partially completed sessions can continue remaining pages.
- Improved retry flow: only unfinished pages are retried, and user retry notes are preserved.
- Improved edit stability: page structure is validated before marking edits as completed.
- Unified model settings: generation and editing now always use the latest model configuration from Settings.
- Improved model stability: outline planning and JSON output parsing are more tolerant of malformed local/weak-model responses.

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
