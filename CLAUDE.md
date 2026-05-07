# CLAUDE.md

## Project

Oh My PPT — 本地优先的 AI 幻灯片生成与编辑工具。Electron + React + TypeScript。

## Commands

```bash
pnpm dev          # 开发
pnpm build        # 构建
pnpm typecheck    # 类型检查
pnpm lint         # ESLint
pnpm format       # Prettier
```

## Code Style

- Prettier: `singleQuote`, `no semi`, `printWidth: 100`, `trailingComma: none`
- 路径别名: `@shared/*` → `src/shared/*`, `@renderer/*` → `src/renderer/src/*`

## Key Constraints

- **pageNumber 一致性**: metadata 读写必须通过 `derivePageNumber(pageId, fallback)` 从 pageId 提取，不能直接使用存储值
- **retry 模式**: 不持久化用户消息，不调用 `updateSessionStatus('active')`，userMessage 保持中英双语
- **类型安全**: 禁止 `as any`，使用对应 flow context 类型
- **运行态保护**: `startingSessionIds` / `beginSessionRunState` / `finalizeGenerationFailure` / `agentManager.removeSession` 不能删除

