import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import log from 'electron-log/main.js'
import { nanoid } from 'nanoid'
import { FilesystemBackend, createDeepAgent } from 'deepagents'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { resolveModel } from '../agent'
import { importPptxToEditableHtml } from './pptx-importer'
import { buildStylePptxImportPrompt } from '../prompt/style-pptx-import-prompt'
import { extractJsonBlock, extractModelText } from '../ipc/utils'
import { logAgentToolEvents } from './agent-tool-logger'
import type { StyleParseResult } from './style-import'

const MAX_PPTX_SIZE = 80 * 1024 * 1024
const MAX_IMPORT_PAGES = 40

export async function parseStylePptx(args: {
  filePath: string
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  modelTimeoutMs: number
  tmpRootDir: string
}): Promise<StyleParseResult> {
  const sourcePath = path.resolve(args.filePath)
  const ext = path.extname(sourcePath).toLowerCase()
  if (ext !== '.pptx') throw new Error('不支持的文件格式，仅支持 .pptx')
  const stat = await fs.promises.stat(sourcePath)
  if (!stat.isFile()) throw new Error(`路径不是文件：${sourcePath}`)
  if (stat.size > MAX_PPTX_SIZE) {
    throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），PPTX 上限 80MB`)
  }

  await fs.promises.mkdir(args.tmpRootDir, { recursive: true })
  const taskDir = path.join(args.tmpRootDir, `${Date.now()}-${nanoid(8)}`)
  await fs.promises.mkdir(taskDir, { recursive: true })

  try {
    const imported = await importPptxToEditableHtml({
      filePath: sourcePath,
      projectDir: taskDir,
      title: path.basename(sourcePath, path.extname(sourcePath)),
      maxPages: MAX_IMPORT_PAGES
    })

    const samplePages = selectSamplePagePaths(
      imported.pages.map((page) => `/${path.basename(page.htmlPath)}`),
      sourcePath
    )
    const response = await runStylePptxImportAgent({
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      modelTimeoutMs: args.modelTimeoutMs,
      workspaceDir: taskDir,
      prompt: buildStylePptxImportPrompt({
        deckRootPath: '/',
        indexPath: '/index.html',
        samplePagePaths: samplePages
      })
    })

    try {
      return parseStyleImportResponse(response)
    } catch (parseError) {
      const reason = parseError instanceof Error ? parseError.message : String(parseError)
      log.info('[styles:parsePptx] first parse failed, retrying with fix prompt', { reason })

      const fixedResponse = await retryFixJson({
        provider: args.provider,
        apiKey: args.apiKey,
        model: args.model,
        baseUrl: args.baseUrl,
        modelTimeoutMs: args.modelTimeoutMs,
        brokenResponse: response,
        parseError: reason
      })
      return parseStyleImportResponse(fixedResponse)
    }
  } finally {
    await fs.promises.rm(taskDir, { recursive: true, force: true }).catch((error) => {
      log.warn('[styles:parsePptx] cleanup failed', {
        taskDir,
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }
}

function selectSamplePagePaths(pagePaths: string[], filePath: string): string[] {
  if (pagePaths.length <= 4) return pagePaths
  const sorted = [...pagePaths].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const middle = sorted.slice(1, -1)
  if (middle.length === 0) return [first, last]

  // 按比例抽样中间页：≤10 页取 2，11-20 页取 3，21-40 页取 4
  const middleCount = Math.min(
    middle.length,
    pagePaths.length <= 10 ? 2 : pagePaths.length <= 20 ? 3 : 4
  )

  const seedHex = crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 8)
  let seed = Number.parseInt(seedHex, 16) || 1
  const nextRand = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  const shuffledMiddle = [...middle]
  for (let i = shuffledMiddle.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRand() * (i + 1))
    const tmp = shuffledMiddle[i]
    shuffledMiddle[i] = shuffledMiddle[j]
    shuffledMiddle[j] = tmp
  }
  return [first, ...shuffledMiddle.slice(0, middleCount), last]
}

async function runStylePptxImportAgent(args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  modelTimeoutMs: number
  workspaceDir: string
  prompt: string
}): Promise<string> {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, 0.2)
  const agent = createDeepAgent({
    model,
    backend: new FilesystemBackend({
      rootDir: args.workspaceDir,
      virtualMode: true
    }),
    systemPrompt:
      'You are a style-import parsing agent for PPTX-derived HTML files. You must use grep and read_file tools before generating the result. Return strict JSON only: label, description, category, aliases, styleSkill.'
  })

  const stream = await agent.stream(
    {
      messages: [
        {
          role: 'user',
          content: args.prompt
        }
      ]
    },
    {
      streamMode: ['updates', 'messages'],
      subgraphs: true,
      signal: AbortSignal.timeout(resolveModelTimeoutMs(args.modelTimeoutMs, 'document'))
    }
  )

  let messageBuffer = ''
  let latestAssistantStateText = ''
  const seenToolEvents = new Set<string>()
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (!Array.isArray(chunk) || chunk.length < 3) continue
    const mode = chunk[1]
    const data = chunk[2]

    if (mode === 'updates') {
      logAgentToolEvents(data, seenToolEvents, { tag: 'styles:parsePptx', source: 'updates' })
      const assistantTexts = extractAssistantTextsFromState(data)
      const longestText = assistantTexts.sort((a, b) => b.length - a.length)[0] || ''
      if (longestText.length >= latestAssistantStateText.length) {
        latestAssistantStateText = longestText
      }
      continue
    }

    if (mode !== 'messages' || !Array.isArray(data)) continue
    logAgentToolEvents(data, seenToolEvents, { tag: 'styles:parsePptx', source: 'messages' })
    for (const message of data as Array<Record<string, unknown>>) {
      const content = extractModelText(message).trim()
      if (content) messageBuffer += content
    }
  }

  return latestAssistantStateText.length > messageBuffer.length ? latestAssistantStateText : messageBuffer
}

function parseStyleImportResponse(response: unknown): StyleParseResult {
  const text = extractModelText(response) || (typeof response === 'string' ? response : JSON.stringify(response))
  const jsonText = extractJsonBlock(text).trim()
  if (!jsonText) throw new Error('LLM 返回格式异常：未找到 JSON')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonText)
  } catch (parseError) {
    const hint = jsonText.length > 200 ? `${jsonText.slice(0, 200)}...` : jsonText
    const reason = parseError instanceof Error ? parseError.message : String(parseError)
    log.warn('[styles:parsePptx] JSON parse failed', { reason, jsonPreview: hint })
    throw new Error(`LLM 返回的 JSON 格式异常：${reason}`)
  }

  const label = String(parsed.label || '').trim()
  const styleSkill = String(parsed.styleSkill || '').trim()
  if (!label || !styleSkill) {
    throw new Error('LLM 返回缺少必填字段（label / styleSkill）')
  }

  return {
    label,
    description: String(parsed.description || '').trim(),
    category: String(parsed.category || '自定义').trim(),
    aliases: Array.isArray(parsed.aliases)
      ? parsed.aliases.map((item) => String(item || '').trim()).filter((item) => item.length > 0)
      : [],
    styleSkill
  }
}

async function retryFixJson(args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  modelTimeoutMs: number
  brokenResponse: string
  parseError: string
}): Promise<string> {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, 0.2)
  const result = await model.invoke([
    {
      role: 'user',
      content: `你上次输出的 JSON 格式有误，解析报错：${args.parseError}

请修复 JSON 格式并重新输出完整的 JSON（用 \`\`\`json ... \`\`\` 包裹）。不要修改内容，只修格式。

原始输出：
${args.brokenResponse}`
    }
  ], {
    signal: AbortSignal.timeout(resolveModelTimeoutMs(args.modelTimeoutMs, 'document'))
  })
  return extractModelText(result)
}

function extractAssistantTextsFromState(data: unknown): string[] {
  const texts: string[] = []
  const seen = new Set<object>()
  const getObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value as object)) return
    seen.add(value as object)

    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }

    const record = value as Record<string, unknown>
    const role = String(record.role || '').toLowerCase()
    const type = String(record.type || '').toLowerCase()
    const constructorName = String(
      getObject(record.lc_kwargs)?.type ?? getObject(record.kwargs)?.type ?? ''
    ).toLowerCase()
    const isAssistant =
      role === 'assistant' || type === 'ai' || type === 'assistant' || constructorName === 'ai'
    const isToolOrHuman =
      role === 'tool' ||
      role === 'user' ||
      role === 'system' ||
      type === 'tool' ||
      type === 'human' ||
      type === 'system'
    if (!isAssistant || isToolOrHuman) {
      for (const nested of Object.values(record)) {
        if (nested && typeof nested === 'object') visit(nested)
      }
      return
    }
    const text = extractModelText(record).trim()
    if (text) texts.push(text)

    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') visit(nested)
    }
  }

  visit(data)
  return texts
}
