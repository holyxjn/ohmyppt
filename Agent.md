# Agent.md

## Project

Electron 桌面应用，主进程 (`src/main/`) + 渲染进程 (`src/renderer/`) + 共享类型 (`src/shared/`)。

## Code Style

- `singleQuote`, `no semi`, `printWidth: 100`, `trailingComma: none`
- 路径别名: `@shared/*`, `@renderer/*`

## Constraints

1. **pageNumber**: 读写 metadata 必须用 `derivePageNumber(pageId, fallback)`，不能直接用存储值
2. **retry 模式**: 不持久化用户消息，不更新 session status，userMessage 中英双语
3. **类型安全**: 禁止 `as any`
4. **运行态保护**: `startingSessionIds` / `beginSessionRunState` / `finalizeGenerationFailure` / `agentManager.removeSession` 不可删

## File Conventions

```
src/main/ipc/generation/xxx-flow.ts  → 每个 flow = resolveXxxContext + executeXxxGeneration
src/main/ipc/generation/types.ts     → 所有生成类型定义
src/main/ipc/generation/metadata-parser.ts → derivePageNumber
src/renderer/lib/ipc.ts             → 前端 IPC 封装
src/renderer/store/                  → Zustand stores
```
