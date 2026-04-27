# Changelog

## 2026-04-27

### 中文

- 支持部分页面生成失败后继续进入编辑页，已成功页面会被保留。
- 失败页可以在详情页中直接用“当前页”编辑逻辑继续修复。
- 新增生成记录，记录每次任务和每页成功/失败状态。
- 统一使用系统设置中的模型配置，避免旧会话配置干扰生成。
- 优化失败重试、进度恢复和本地模型 JSON 解析稳定性。

### English

- Added partial-failure recovery so completed pages can still be edited.
- Failed pages can now be repaired from the detail page through the normal page-edit flow.
- Added generation records for run-level and page-level status tracking.
- Model settings now always come from system settings to avoid stale session config.
- Improved retry handling, progress recovery, and JSON parsing for local models.

## 2026-04-26

### 中文

- 支持本地 HTML 幻灯片生成、逐页预览和 PDF 导出。
- 支持对话式单页编辑、元素检选和图片素材引用。
- 内置多种风格 Skill，并提供风格管理页面。
- 优化生成页动画、左侧缩略图、中间预览和右侧 AI 面板体验。
- 补充 Ollama / OpenAI 兼容模型与未签名应用打开说明。

### English

- Added local HTML slide generation, page preview, and PDF export.
- Added chat-based page editing, element inspection, and image asset references.
- Added built-in style skills and a style management page.
- Improved generation animation, thumbnails, preview canvas, and AI panel UX.
- Added notes for Ollama / OpenAI-compatible models and unsigned app startup.
