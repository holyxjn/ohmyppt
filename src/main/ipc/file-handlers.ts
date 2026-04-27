import { ipcMain, shell } from 'electron'
import fs from 'fs'
import { pathToFileURL } from 'url'
import type { IpcContext } from './context'

export function registerFileHandlers(ctx: IpcContext): void {
  const { parsePathPayload, normalizeSessionId, assertPathInAllowedRoots } = ctx

  ipcMain.handle('file:open', async (_event, payload, legacySessionId?: string) => {
    const parsed = parsePathPayload(payload, 'path')
    const sessionId = parsed.sessionId ?? normalizeSessionId(legacySessionId)
    const safePath = await assertPathInAllowedRoots({
      filePath: parsed.filePath,
      mode: 'read',
      sessionId
    })
    return fs.promises.readFile(safePath, 'utf-8')
  })

  ipcMain.handle('file:reveal', async (_event, payload, legacySessionId?: string) => {
    const parsed = parsePathPayload(payload, 'path')
    const sessionId = parsed.sessionId ?? normalizeSessionId(legacySessionId)
    const safePath = await assertPathInAllowedRoots({
      filePath: parsed.filePath,
      mode: 'read',
      sessionId
    })
    shell.showItemInFolder(safePath)
    return { success: true }
  })

  ipcMain.handle(
    'file:openInBrowser',
    async (_event, payloadOrPath, legacyHash?: string, legacySessionId?: string) => {
      const parsed = parsePathPayload(payloadOrPath, 'path')
      const sessionId = parsed.sessionId ?? normalizeSessionId(legacySessionId)
      const hashRaw = typeof legacyHash === 'string' ? legacyHash : parsed.hash
      const safePath = await assertPathInAllowedRoots({
        filePath: parsed.filePath,
        mode: 'read',
        sessionId,
        htmlOnly: true
      })
      const baseUrl = pathToFileURL(safePath).toString()
      const hashValue =
        typeof hashRaw === 'string' && hashRaw.trim().length > 0
          ? hashRaw.startsWith('#')
            ? hashRaw
            : `#${hashRaw}`
          : ''
      await shell.openExternal(`${baseUrl}${hashValue}`)
      return { success: true }
    }
  )

  ipcMain.handle('file:save', async (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('file:save 参数无效')
    }
    const record = payload as { path?: unknown; content?: unknown; sessionId?: unknown }
    const filePath = typeof record.path === 'string' ? record.path : ''
    const content = typeof record.content === 'string' ? record.content : ''
    const sessionId = normalizeSessionId(record.sessionId)
    const safePath = await assertPathInAllowedRoots({
      filePath,
      mode: 'write',
      sessionId
    })
    await fs.promises.writeFile(safePath, content, 'utf-8')
    return { success: true }
  })
}
