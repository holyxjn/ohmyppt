import { create } from 'zustand'
import { ipc } from '@renderer/lib/ipc'

interface Settings {
  provider: string
  theme: string
  locale: 'zh' | 'en'
  autoSave: boolean
  storagePath: string
  providerConfigs: Record<string, { model: string; apiKey: string; baseUrl: string }>
}

interface SettingsStore {
  settings: Settings | null
  apiKey: string
  model: string
  baseUrl: string
  verificationMessage: string | null
  storagePathError: string | null
  loading: boolean

  fetchSettings: () => Promise<void>
  saveSettings: (settings: Partial<Settings>) => Promise<void>
  setApiKey: (apiKey: string) => void
  setModel: (model: string) => void
  setBaseUrl: (baseUrl: string) => void
  setVerificationMessage: (message: string | null) => void
  loadProviderConfig: (provider: string) => void
  verifyApiKey: (
    provider: string,
    apiKey: string,
    model: string,
    baseUrl: string
  ) => Promise<boolean>
  chooseStoragePath: () => Promise<string | null>
}

const readStoredLocale = (): 'zh' | 'en' => {
  if (typeof window === 'undefined') return 'zh'
  return window.localStorage.getItem('oh-my-ppt:lang') === 'en' ? 'en' : 'zh'
}

const fallbackMessage = (zh: string, en: string): string => (readStoredLocale() === 'en' ? en : zh)

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  apiKey: '',
  model: '',
  baseUrl: '',
  verificationMessage: null,
  storagePathError: null,
  loading: false,

  fetchSettings: async () => {
    try {
      const settings = await ipc.getSettings()
      const typedSettings = settings as unknown as Settings
      const locale = typedSettings.locale === 'en' ? 'en' : 'zh'
      set({
        settings: { ...typedSettings, locale },
        apiKey: typedSettings.providerConfigs?.[typedSettings.provider]?.apiKey || '',
        model: typedSettings.providerConfigs?.[typedSettings.provider]?.model || '',
        baseUrl: typedSettings.providerConfigs?.[typedSettings.provider]?.baseUrl || '',
        storagePathError: null,
        verificationMessage: null
      })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('读取设置失败。', 'Failed to read settings.')
      set({ verificationMessage: message })
    }
  },

  saveSettings: async (newSettings) => {
    const settings = get().settings
    const settingsToSave: Partial<Settings> = { ...newSettings }
    if (newSettings.providerConfigs) {
      const activeProvider = newSettings.provider || settings?.provider || 'openai'
      settingsToSave.providerConfigs = {
        ...(settings?.providerConfigs || {}),
        ...newSettings.providerConfigs,
        [activeProvider]: {
          ...(settings?.providerConfigs?.[activeProvider] || {}),
          ...(newSettings.providerConfigs[activeProvider] || {})
        }
      }
    }

    try {
      await ipc.saveSettings(settingsToSave)
      await get().fetchSettings()
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('保存设置失败。', 'Failed to save settings.')
      set({ verificationMessage: message })
    }
  },

  setApiKey: (apiKey) => set({ apiKey, verificationMessage: null }),
  setModel: (model) => set({ model, verificationMessage: null }),
  setBaseUrl: (baseUrl) => set({ baseUrl, verificationMessage: null }),
  setVerificationMessage: (message) => set({ verificationMessage: message }),

  loadProviderConfig: (provider) => {
    const config = get().settings?.providerConfigs?.[provider] || {
      apiKey: '',
      model: '',
      baseUrl: ''
    }
    set({
      apiKey: config.apiKey || '',
      model: config.model || '',
      baseUrl: config.baseUrl || '',
      verificationMessage: null
    })
  },

  verifyApiKey: async (provider, apiKey, model, baseUrl) => {
    try {
      const { valid, message } = await ipc.verifyApiKey({ provider, apiKey, model, baseUrl })
      set({ verificationMessage: message || null })
      return valid
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('发送验证请求失败。', 'Failed to send verification request.')
      set({ verificationMessage: message })
      return false
    }
  },

  chooseStoragePath: async () => {
    set({ storagePathError: null })
    try {
      const { path, error } = await ipc.chooseStoragePath()
      set({ storagePathError: error || null })
      return path
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('选择文件夹失败。', 'Failed to choose folder.')
      set({ storagePathError: message })
      return null
    }
  }
}))
