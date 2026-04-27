import { BrowserWindow, dialog, ipcMain } from 'electron'
import log from 'electron-log/main.js'
import { resolveModel } from '../agent'
import type { IpcContext } from './context'

export function registerSettingsHandlers(ctx: IpcContext): void {
  const { mainWindow, db, encryptApiKey, decryptApiKey } = ctx

  ipcMain.handle('settings:get', async () => {
    log.info('[settings:get] requested')
    const settings = await db.getAllSettings()
    const storagePath =
      typeof settings.storage_path === 'string' && settings.storage_path.trim().length > 0
        ? settings.storage_path.trim()
        : ''
    const providerConfigs = {
      anthropic: {
        model: typeof settings.model_anthropic === 'string' ? settings.model_anthropic : '',
        apiKey: decryptApiKey(settings.api_key_anthropic),
        baseUrl: typeof settings.base_url_anthropic === 'string' ? settings.base_url_anthropic : ''
      },
      openai: {
        model: typeof settings.model_openai === 'string' ? settings.model_openai : '',
        apiKey: decryptApiKey(settings.api_key_openai),
        baseUrl: typeof settings.base_url_openai === 'string' ? settings.base_url_openai : ''
      }
    }

    return {
      provider: settings.provider || 'openai',
      theme: settings.theme || 'light',
      autoSave: settings.auto_save ?? true,
      storagePath,
      providerConfigs
    }
  })

  ipcMain.handle('settings:save', async (_event, settings) => {
    log.info('[settings:save] received', {
      provider: settings?.provider,
      hasStoragePath:
        typeof settings?.storagePath === 'string' && settings.storagePath.trim().length > 0,
      providers: settings?.providerConfigs ? Object.keys(settings.providerConfigs) : []
    })
    if (settings.provider !== undefined) await db.setSetting('provider', settings.provider)
    if (settings.theme !== undefined) await db.setSetting('theme', settings.theme)
    if (settings.autoSave !== undefined) await db.setSetting('auto_save', settings.autoSave)
    if (typeof settings.storagePath === 'string' && settings.storagePath.trim().length > 0) {
      await db.setStoragePath(settings.storagePath)
    }
    if (settings.providerConfigs && typeof settings.providerConfigs === 'object') {
      const providerConfigs = settings.providerConfigs as Record<
        string,
        { model?: unknown; apiKey?: unknown; baseUrl?: unknown }
      >
      for (const [provider, config] of Object.entries(providerConfigs)) {
        if (typeof config.model === 'string') await db.setSetting(`model_${provider}`, config.model)
        if (typeof config.apiKey === 'string') {
          await db.setSetting(`api_key_${provider}`, encryptApiKey(config.apiKey))
        }
        if (typeof config.baseUrl === 'string')
          await db.setSetting(`base_url_${provider}`, config.baseUrl)
      }
    }
    return { success: true }
  })

  ipcMain.handle('settings:verifyApiKey', async (_event, { provider, apiKey, model, baseUrl }) => {
    log.info('[settings:verifyApiKey] received', {
      provider,
      model,
      hasApiKey: typeof apiKey === 'string' && apiKey.trim().length > 0,
      baseUrl: typeof baseUrl === 'string' ? baseUrl : ''
    })

    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return { valid: false, message: '请先填写 api_key。' }
    }
    if (typeof model !== 'string' || model.trim().length === 0) {
      return { valid: false, message: '请先填写 model。' }
    }

    try {
      const client = resolveModel(
        provider,
        apiKey.trim(),
        model.trim(),
        typeof baseUrl === 'string' ? baseUrl.trim() : ''
      )
      await client.invoke('Reply with OK.')
      log.info('[settings:verifyApiKey] success', { provider, model })
      return { valid: true, message: '连接验证成功。' }
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0
          ? error.message
          : '连接验证失败，请检查 api_key、model 或 base_url。'
      log.error('[settings:verifyApiKey] failed', {
        provider,
        model,
        baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
        message
      })
      return { valid: false, message }
    }
  })

  ipcMain.handle('settings:chooseStoragePath', async (event) => {
    log.info('[settings:chooseStoragePath] received')
    const targetWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow

    try {
      const settings = await db.getAllSettings()
      const currentStoragePath =
        typeof settings.storage_path === 'string' && settings.storage_path.trim().length > 0
          ? settings.storage_path.trim()
          : ''
      const result = await dialog.showOpenDialog(targetWindow, {
        title: '选择 OpenPPT 存储目录',
        buttonLabel: '选择目录',
        ...(currentStoragePath ? { defaultPath: currentStoragePath } : {}),
        properties: ['openDirectory', 'createDirectory', 'promptToCreate']
      })
      if (!result.canceled && result.filePaths.length > 0) {
        return { path: result.filePaths[0] }
      }
      return { path: null }
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0
          ? error.message
          : '无法打开系统目录选择器。'
      log.error('[settings:chooseStoragePath] failed', { message })
      return { path: null, error: message }
    }
  })
}
