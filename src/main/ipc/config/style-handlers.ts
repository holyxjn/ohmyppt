import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { customAlphabet } from 'nanoid'
import {
  listStyleCatalog,
  getStyleDetail,
  createStyleSkill,
  updateStyleSkill,
  hasStyleSkill,
  deleteStyleSkill
} from '../../utils/style-skills'
import type { IpcContext } from '../context'
import { resolveActiveModelConfig, resolveGlobalModelTimeouts } from './model-config-utils'
import { parseStyleFile } from '../../utils/style-import'
import { parseStyleImage } from '../../utils/style-image-import'
import { parseStylePptx } from '../../utils/style-pptx-import'

const nanoidLower = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)
const MAX_STYLE_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

type StyleBasePayload = {
  label: string
  description: string
  category: string
  aliases: string[]
  prompt: string
}

type StylePayload = StyleBasePayload & {
  id: string
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

  const parseBasePayload = (payload: unknown): StyleBasePayload => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const label = String(record.label || '').trim()
    const description = String(record.description || '').trim()
    const category = String(record.category || '').trim()
    const styleSkill = String(record.styleSkill || '').trim()
    const aliases = Array.isArray(record.aliases)
      ? record.aliases
          .map((alias: unknown) => String(alias || '').trim())
          .filter((alias: string) => alias.length > 0)
      : []
    if (!label) {
      throw new Error('保存风格失败：label 必填。')
    }
    if (!styleSkill) {
      throw new Error('保存风格失败：styleSkill 不能为空。')
    }
    return {
      label,
      description,
      category,
      aliases,
      prompt: styleSkill
    }
  }

  const parseCreatePayload = (payload: unknown): StyleBasePayload => {
    log.info('[styles:create] payload requested')
    return parseBasePayload(payload)
  }

  const parseUpdatePayload = (payload: unknown): StylePayload => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const id = String(record.id || '').trim()
    if (!id) {
      throw new Error('保存风格失败：id 必填。')
    }
    log.info('[styles:update] payload requested', { styleId: id })
    return {
      ...parseBasePayload(payload),
      id
    }
  }

  ipcMain.handle('styles:parseFile', async (_event, payload) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : ''
    if (!filePath) throw new Error('文件路径为空')
    const activeModel = await resolveActiveModelConfig(ctx)
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const styleImportDir = path.join(await ctx.resolveStoragePath(), 'style-import')
    await fs.promises.mkdir(styleImportDir, { recursive: true })
    return await parseStyleFile({
      filePath,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      modelTimeoutMs: modelTimeouts.document,
      workspaceDir: styleImportDir
    })
  })

  ipcMain.handle('styles:parsePptx', async (_event, payload) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : ''
    if (!filePath) throw new Error('文件路径为空')
    const activeModel = await resolveActiveModelConfig(ctx)
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const tmpRootDir = path.join(await ctx.resolveStoragePath(), 'tmpStyle')
    await fs.promises.mkdir(tmpRootDir, { recursive: true })
    return await parseStylePptx({
      filePath,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      modelTimeoutMs: modelTimeouts.document,
      tmpRootDir
    })
  })

  ipcMain.handle('styles:parseImage', async (_event, payload) => {
    const imageBase64 = typeof payload?.imageBase64 === 'string' ? payload.imageBase64.trim() : ''
    const mimeType =
      typeof payload?.mimeType === 'string' ? payload.mimeType.trim().toLowerCase() : ''
    if (!imageBase64) throw new Error('图片数据为空')
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(`不支持的图片格式：${mimeType || 'unknown'}`)
    }
    let imageBuffer: Buffer
    try {
      imageBuffer = Buffer.from(imageBase64, 'base64')
    } catch {
      throw new Error('图片数据格式无效')
    }
    if (!imageBuffer.length) {
      throw new Error('图片数据为空')
    }
    if (imageBuffer.length > MAX_STYLE_IMAGE_SIZE_BYTES) {
      throw new Error(
        `图片过大（${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB），图片上限 5MB`
      )
    }

    const activeModel = await resolveActiveModelConfig(ctx)
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    return await parseStyleImage({
      imageBase64,
      mimeType,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      modelTimeoutMs: modelTimeouts.document
    })
  })

  ipcMain.handle('styles:create', async (_event, payload) => {
    const parsed = parseCreatePayload(payload)
    let id = `style-${nanoidLower()}`
    while (hasStyleSkill(id)) {
      id = `style-${nanoidLower()}`
    }
    const result = await createStyleSkill({
      ...parsed,
      id
    })
    return { success: true, ...result }
  })

  ipcMain.handle('styles:update', async (_event, payload) => {
    const parsed = parseUpdatePayload(payload)
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
