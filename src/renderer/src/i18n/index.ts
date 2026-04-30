import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSettingsStore } from '../store'
import { en } from './en'
import { zh } from './zh'

export type Lang = 'zh' | 'en'

export type DeepStringShape<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringShape<T[K]>
}

type DotKeys<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, unknown>
      ? `${K}.${DotKeys<T[K]>}`
      : never
}[keyof T & string]

export type I18nKey = DotKeys<typeof zh>
export type TranslationParams = Record<string, string | number>

interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: I18nKey, params?: TranslationParams) => string
}

const LANG_STORAGE_KEY = 'oh-my-ppt:lang'
const messages = { zh, en } as const

const LangContext = createContext<LangContextValue | null>(null)

function normalizeLang(value: unknown): Lang | null {
  return value === 'en' || value === 'zh' ? value : null
}

function readStoredLang(): Lang | null {
  if (typeof window === 'undefined') return null
  return normalizeLang(window.localStorage.getItem(LANG_STORAGE_KEY))
}

function writeStoredLang(lang: Lang): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LANG_STORAGE_KEY, lang)
}

function getByPath(obj: unknown, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)

  return typeof value === 'string' ? value : undefined
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  )
}

export function LangProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const fetchSettings = useSettingsStore((state) => state.fetchSettings)
  const [lang, setLangState] = useState<Lang>(
    () => normalizeLang(useSettingsStore.getState().settings?.locale) || readStoredLang() || 'zh'
  )

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    return useSettingsStore.subscribe((state) => {
      const nextLocale = normalizeLang(state.settings?.locale)
      if (!nextLocale) return
      setLangState(nextLocale)
      writeStoredLang(nextLocale)
    })
  }, [])

  const setLang = useCallback((nextLang: Lang) => {
    setLangState(nextLang)
    writeStoredLang(nextLang)
    void useSettingsStore.getState().saveSettings({ locale: nextLang })
  }, [])

  const t = useCallback(
    (key: I18nKey, params?: TranslationParams) => {
      const template = getByPath(messages[lang], key) || getByPath(messages.zh, key) || key
      return interpolate(template, params)
    },
    [lang]
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])

  return createElement(LangContext.Provider, { value }, children)
}

export function useLang(): LangContextValue {
  const value = useContext(LangContext)
  if (!value) throw new Error('useLang must be used within LangProvider')
  return value
}

export function useT(): LangContextValue['t'] {
  return useLang().t
}
