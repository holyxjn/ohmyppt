import { BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import type { IpcContext } from '../context'

export function registerAssetHandlers(ctx: IpcContext): void {
  const { mainWindow, uploadImageAssets } = ctx

  ipcMain.handle('assets:upload', async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const files = Array.isArray(record.files)
      ? (record.files as Array<Record<string, unknown>>)
      : []
    return { assets: await uploadImageAssets(sessionId, files) }
  })

  ipcMain.handle('assets:chooseAndUpload', async (event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    if (!sessionId) throw new Error('sessionId 不能为空')

    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    const result = await dialog.showOpenDialog(win, {
      title: '选择图片素材',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { assets: [], cancelled: true }
    }
    const assets = await uploadImageAssets(
      sessionId,
      result.filePaths.map((filePath) => ({
        path: filePath,
        name: path.basename(filePath)
      }))
    )
    return { assets, cancelled: false }
  })
}
