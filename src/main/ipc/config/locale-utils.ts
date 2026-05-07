import type { IpcContext } from '../context'

export type AppLocale = 'zh' | 'en'

export const uiText = (locale: AppLocale, zh: string, en: string): string =>
  locale === 'en' ? en : zh

export async function readAppLocale(ctx: Pick<IpcContext, 'db'>): Promise<AppLocale> {
  const locale = await ctx.db.getSetting<string>('locale').catch(() => 'zh')
  return locale === 'en' ? 'en' : 'zh'
}
