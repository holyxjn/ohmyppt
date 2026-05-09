import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import { GitHistoryService } from '../../history/git-history-service'

export function registerHistoryHandlers(ctx: IpcContext): void {
  const { db, resolveSessionProjectDir, sessionRunStates } = ctx

  ipcMain.handle(
    'history:listVersions',
    async (_event, payload: { sessionId?: unknown; limit?: unknown }) => {
      const sessionId =
        typeof payload?.sessionId === 'string' && payload.sessionId.trim().length > 0
          ? payload.sessionId.trim()
          : ''
      if (!sessionId) throw new Error('缺少 sessionId')
      const limit = Math.max(1, Math.min(50, Math.floor(Number(payload?.limit) || 10)))
      const projectDir = await resolveSessionProjectDir(sessionId)
      const service = new GitHistoryService(db)
      await service.ensureBaseline(sessionId, projectDir).catch((error) => {
        log.warn('[history:listVersions] ensureBaseline failed', {
          sessionId,
          message: error instanceof Error ? error.message : String(error)
        })
      })
      return service.listVersions(sessionId, limit)
    }
  )

  ipcMain.handle(
    'history:rollbackToVersion',
    async (_event, payload: { sessionId?: unknown; versionId?: unknown }) => {
      const sessionId =
        typeof payload?.sessionId === 'string' && payload.sessionId.trim().length > 0
          ? payload.sessionId.trim()
          : ''
      const versionId =
        typeof payload?.versionId === 'string' && payload.versionId.trim().length > 0
          ? payload.versionId.trim()
          : ''
      if (!sessionId || !versionId) throw new Error('缺少历史版本参数')
      const runState = sessionRunStates.get(sessionId)
      if (runState?.status === 'running') {
        throw new Error('当前会话正在生成或编辑，暂时不能回退。')
      }
      const projectDir = await resolveSessionProjectDir(sessionId)
      return new GitHistoryService(db).rollbackToVersion({ sessionId, projectDir, versionId })
    }
  )

  ipcMain.handle(
    'history:recordSnapshot',
    async (
      _event,
      payload: {
        sessionId?: unknown
        type?: unknown
        scope?: unknown
        prompt?: unknown
        metadata?: unknown
      }
    ) => {
      const sessionId =
        typeof payload?.sessionId === 'string' && payload.sessionId.trim().length > 0
          ? payload.sessionId.trim()
          : ''
      if (!sessionId) throw new Error('缺少 sessionId')
      const projectDir = await resolveSessionProjectDir(sessionId)
      const type = payload?.type === 'retry' || payload?.type === 'rollback' || payload?.type === 'addPage' || payload?.type === 'generate' || payload?.type === 'import'
        ? payload.type
        : 'edit'
      const scope = payload?.scope === 'deck' || payload?.scope === 'selector' || payload?.scope === 'shell' || payload?.scope === 'session'
        ? payload.scope
        : 'page'
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt : null
      const metadata =
        payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? (payload.metadata as Record<string, unknown>)
          : {}
      return new GitHistoryService(db).recordOperation({
        sessionId,
        projectDir,
        type,
        scope,
        prompt,
        metadata
      })
    }
  )
}
