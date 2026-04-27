import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import {
  listStyleCatalog,
  getStyleDetail,
  createStyleSkill,
  updateStyleSkill,
  hasStyleSkill,
  deleteStyleSkill
} from '../utils/style-skills'
import type { IpcContext } from './context'

type StylePayload = {
  id: string
  label: string
  description: string
  category: string
  aliases: string[]
  prompt: string
}

export function registerStyleHandlers(ctx: IpcContext): void {
  const { db } = ctx

  ipcMain.handle('styles:get', async () => {
    log.info('[styles:get] requested')
    const styles = listStyleCatalog()
    const categories: Record<
      string,
      Array<{
        id: string
        label: string
        description: string
        source?: 'builtin' | 'custom' | 'override'
        editable?: boolean
      }>
    > = {}
    for (const style of styles) {
      const category = style.category
      if (!categories[category]) categories[category] = []
      categories[category].push({
        id: style.id,
        label: style.label,
        description: style.description,
        source: style.source,
        editable: style.editable
      })
    }
    const defaultStyle =
      styles.find((item) => item.styleKey === 'minimal-white')?.id ?? styles[0]?.id ?? ''
    return { categories, defaultStyle }
  })

  ipcMain.handle('styles:getDetail', async (_event, styleId: string) => {
    return getStyleDetail(styleId)
  })

  ipcMain.handle('styles:list', async () => {
    const rows = await db.listStyleRows()
    rows.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
    return {
      items: rows.map((row) => ({
        id: row.id,
        label: row.styleName,
        description: row.description,
        category: row.category || (row.source === 'builtin' ? '内置' : '自定义'),
        source: row.source,
        editable: row.source !== 'builtin',
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    }
  })

  const parseStylePayload = (payload: unknown): StylePayload => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    log.info('[styles:payload] requested', {
      styleId: record.id || ''
    })
    const id = String(record.id || '').trim()
    const label = String(record.label || '').trim()
    const description = String(record.description || '').trim()
    const category = String(record.category || '').trim()
    const styleSkill = String(record.styleSkill || '').trim()
    const aliases = Array.isArray(record.aliases)
      ? record.aliases
          .map((alias: unknown) => String(alias || '').trim())
          .filter((alias: string) => alias.length > 0)
      : []
    if (!id || !label) {
      throw new Error('保存风格失败：id 与 label 必填。')
    }
    if (!styleSkill) {
      throw new Error('保存风格失败：styleSkill 不能为空。')
    }
    return {
      id,
      label,
      description,
      category,
      aliases,
      prompt: styleSkill
    }
  }

  ipcMain.handle('styles:create', async (_event, payload) => {
    const parsed = parseStylePayload(payload)
    const result = await createStyleSkill(parsed)
    return { success: true, ...result }
  })

  ipcMain.handle('styles:update', async (_event, payload) => {
    const parsed = parseStylePayload(payload)
    const result = await updateStyleSkill(parsed)
    return { success: true, ...result }
  })

  ipcMain.handle('styles:delete', async (_event, styleId: string) => {
    const id = String(styleId || '').trim()
    if (!id) return { success: false, deleted: false }
    if (!hasStyleSkill(id)) {
      return { success: false, deleted: false, message: 'style 不存在' }
    }
    const result = await deleteStyleSkill(id)
    return {
      success: true,
      deleted: result.deleted,
      message: result.deleted ? undefined : '内置风格不可删除'
    }
  })
}
