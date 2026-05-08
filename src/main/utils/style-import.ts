import fs from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { nanoid } from 'nanoid'
import { FilesystemBackend, createDeepAgent } from 'deepagents'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { resolveModel } from '../agent'
import { buildStyleImportPrompt } from '../prompt/style-import-prompt'
import { extractJsonBlock, extractModelText } from '../ipc/utils'

export interface StyleParseResult {
  label: string
  description: string
  category: string
  aliases: string[]
  styleSkill: string
}

const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.html', '.htm'])
const MAX_FILE_SIZE = 1024 * 1024

type PreparedStyleSourceFile = {
  name: string
  ext: string
  workspacePath: string
  virtualPath: string
}

export async function parseStyleFile(args: {
  filePath: string
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  modelTimeoutMs: number
  workspaceDir: string
}): Promise<StyleParseResult> {
  await fs.promises.mkdir(args.workspaceDir, { recursive: true })
  const sourceFile = await prepareStyleSourceFile(args.filePath, args.workspaceDir)
  const responseText = await runStyleImportAgent({
    provider: args.provider,
    apiKey: args.apiKey,
    model: args.model,
    baseUrl: args.baseUrl,
    modelTimeoutMs: args.modelTimeoutMs,
    workspaceDir: args.workspaceDir,
    file: sourceFile
  })
  return parseStyleImportResponse(responseText)
}

async function prepareStyleSourceFile(
  sourcePathInput: string,
  workspaceDir: string
): Promise<PreparedStyleSourceFile> {
  const resolvedPath = path.resolve(sourcePathInput)
  const ext = path.extname(resolvedPath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的文件格式：${ext}，仅支持 ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`)
  }

  const stat = await fs.promises.stat(resolvedPath)
  if (!stat.isFile()) {
    throw new Error(`路径不是文件：${resolvedPath}`)
  }
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`文件过大（${(stat.size / 1024).toFixed(0)}KB），上限 ${MAX_FILE_SIZE / 1024}KB`)
  }
  log.info('[styles:parseFile] read source file', {
    fileName: path.basename(resolvedPath),
    extension: ext,
    size: stat.size
  })

  const workspaceName = `${Date.now()}-${nanoid(8)}-${path.basename(resolvedPath)}`
  const workspacePath = path.join(workspaceDir, workspaceName)
  await fs.promises.copyFile(resolvedPath, workspacePath)

  return {
    name: path.basename(resolvedPath),
    ext,
    workspacePath,
    virtualPath: `/${workspaceName}`
  }
}

async function runStyleImportAgent(args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  modelTimeoutMs: number
  workspaceDir: string
  file: PreparedStyleSourceFile
}): Promise<string> {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, 0.2)
  const prompt = buildStyleImportPrompt(args.file.virtualPath)
  log.info('[styles:parseFile] agent read_file requested', {
    virtualPath: args.file.virtualPath,
    workspaceName: path.basename(args.file.workspacePath)
  })

  const agent = createDeepAgent({
    model,
    backend: new FilesystemBackend({
      rootDir: args.workspaceDir,
      virtualMode: true
    }),
    systemPrompt:
      'You are a style-import parsing agent. You must use read_file to read the uploaded file before generating the result. Return strict JSON only: label, description, category, aliases, styleSkill.'
  })

  const stream = await agent.stream(
    {
      messages: [
        {
          role: 'user',
          content: prompt
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
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (!Array.isArray(chunk) || chunk.length < 3) continue
    const mode = chunk[1]
    const data = chunk[2]

    if (mode === 'updates') {
      const assistantTexts = extractAssistantTextsFromState(data)
      const longestText = assistantTexts.sort((a, b) => b.length - a.length)[0] || ''
      if (longestText.length >= latestAssistantStateText.length) {
        latestAssistantStateText = longestText
      }
      continue
    }

    if (mode !== 'messages' || !Array.isArray(data)) continue
    for (const message of data as Array<Record<string, unknown>>) {
      const content = extractModelText(message).trim()
      if (content) messageBuffer += content
    }
  }

  if (latestAssistantStateText.length > messageBuffer.length) {
    return latestAssistantStateText
  }
  return messageBuffer
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
    log.warn('[styles:parseFile] JSON parse failed', { reason, jsonPreview: hint })
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
