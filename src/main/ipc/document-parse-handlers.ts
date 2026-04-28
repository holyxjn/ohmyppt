import { ipcMain } from 'electron'
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import log from 'electron-log/main.js'
import { nanoid } from 'nanoid'
import { resolveModel } from '../agent'
import { FilesystemBackend, createDeepAgent } from 'deepagents'
import { extractJsonBlock, extractModelText } from './utils'
import type { IpcContext } from './context'
import type { ParseDocumentPlanPayload, ParsedDocumentPlanResult } from '@shared/generation'

type PreparedSourceFile = ParsedDocumentPlanResult['files'][number] & {
  originalPath: string
  workspacePath: string
  virtualPath: string
}

const MAX_DOCUMENT_FILES = 1
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
const MAX_PAGE_COUNT = 40

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.text', '.csv', '.docx'])
const NULL_CHAR_PATTERN = new RegExp(String.fromCharCode(0), 'g')

const require = createRequire(import.meta.url)
const mammoth = require('mammoth') as typeof import('mammoth')
const TurndownService = require('turndown') as new (options?: Record<string, unknown>) => {
  use: (plugin: unknown) => void
  turndown: (html: string) => string
}
const { gfm } = require('@joplin/turndown-plugin-gfm') as { gfm: unknown }

const stripControlChars = (value: string): string =>
  value.replace(NULL_CHAR_PATTERN, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const compactText = (value: string): string =>
  stripControlChars(value)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

const stripInlineImagesFromHtml = (html: string): string =>
  html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt=(["'])(.*?)\1/i)?.[2]?.trim()
    return alt ? `<p>[图片：${alt}]</p>` : ''
  })

const stripMarkdownDataImages = (markdown: string): string =>
  markdown.replace(/!\[[^\]]*]\(data:[^)]+\)/gi, '').replace(/!\[[^\]]*]\(\s*\)/g, '')

const previewValue = (value: unknown, maxLength = 240): string => {
  const source =
    typeof value === 'string'
      ? value
      : value === undefined
        ? ''
        : (() => {
            try {
              return JSON.stringify(value)
            } catch {
              return String(value)
            }
          })()
  const compact = source.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact
}

const getObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const readMessageField = (message: Record<string, unknown>, key: string): unknown => {
  const direct = message[key]
  if (direct !== undefined) return direct
  const kwargs = getObject(message.kwargs)
  if (kwargs && kwargs[key] !== undefined) return kwargs[key]
  return undefined
}

const summarizeToolCall = (toolCall: unknown): {
  id: string
  name: string
  argsPreview: string
  argsLength: number
} | null => {
  const record = getObject(toolCall)
  if (!record) return null
  const functionRecord = getObject(record.function)
  const rawArgs = record.args ?? record.arguments ?? functionRecord?.arguments ?? ''
  const argsText = typeof rawArgs === 'string' ? rawArgs : previewValue(rawArgs, 10_000)
  const name = String(record.name ?? functionRecord?.name ?? '').trim()
  const id = String(record.id ?? record.tool_call_id ?? '').trim()
  if (!name && !id && !argsText) return null
  return {
    id,
    name,
    argsPreview: previewValue(argsText),
    argsLength: argsText.length
  }
}

const logDocumentPlanToolEvents = (
  data: unknown,
  seenToolEvents: Set<string>,
  source: 'updates' | 'messages'
): void => {
  const visitMessage = (message: unknown) => {
    const record = getObject(message)
    if (!record) return
    const toolCallsSources = [
      readMessageField(record, 'tool_calls'),
      readMessageField(record, 'tool_call_chunks'),
      getObject(readMessageField(record, 'additional_kwargs'))?.tool_calls
    ]
    for (const calls of toolCallsSources) {
      if (!Array.isArray(calls)) continue
      for (const call of calls) {
        const summary = summarizeToolCall(call)
        if (!summary) continue
        const key = `call:${summary.id}:${summary.name}:${summary.argsPreview}`
        if (seenToolEvents.has(key)) continue
        seenToolEvents.add(key)
        log.info('[documents:parsePlan] tool_call', {
          source,
          toolCallId: summary.id || null,
          toolName: summary.name || null,
          argsLength: summary.argsLength,
          argsPreview: summary.argsPreview
        })
      }
    }

    const messageType = String(
      readMessageField(record, 'type') ?? readMessageField(record, 'role') ?? ''
    )
    const toolCallId = String(readMessageField(record, 'tool_call_id') ?? '').trim()
    const toolName = String(readMessageField(record, 'name') ?? '').trim()
    if (toolCallId || messageType === 'tool') {
      const content = readMessageField(record, 'content')
      const contentText = typeof content === 'string' ? content : previewValue(content, 10_000)
      const key = `result:${toolCallId}:${toolName}:${contentText.length}`
      if (!seenToolEvents.has(key)) {
        seenToolEvents.add(key)
        log.info('[documents:parsePlan] tool_result', {
          source,
          toolCallId: toolCallId || null,
          toolName: toolName || null,
          contentLength: contentText.length
        })
      }
    }
  }

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const record = getObject(value)
    if (!record) return
    if (
      readMessageField(record, 'tool_calls') !== undefined ||
      readMessageField(record, 'tool_call_chunks') !== undefined ||
      readMessageField(record, 'tool_call_id') !== undefined ||
      readMessageField(record, 'role') === 'tool' ||
      readMessageField(record, 'type') === 'tool'
    ) {
      visitMessage(record)
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') visit(nested)
    }
  }

  visit(data)
}

const convertDocxToMarkdown = async (filePath: string): Promise<string> => {
  const result = await mammoth.convertToHtml({ path: filePath })
  if (result.messages.length > 0) {
    log.info('[documents:parsePlan] mammoth warnings', {
      filePath,
      messages: result.messages.map((message) => message.message)
    })
  }
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  })
  turndown.use(gfm)
  return compactText(
    stripMarkdownDataImages(turndown.turndown(stripInlineImagesFromHtml(result.value)))
  )
}

const toSafeFileName = (value: string): string =>
  value
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'source'

const prepareSourceFile = async (
  file: { path?: unknown; name?: unknown },
  workspaceDir: string
): Promise<PreparedSourceFile> => {
  const rawPath = typeof file.path === 'string' ? file.path.trim() : ''
  if (!rawPath) throw new Error('无法读取文档路径')
  const filePath = path.resolve(rawPath)
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) throw new Error(`文档不是文件: ${filePath}`)
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error('单个文档不能超过 10MB')

  const ext = path.extname(filePath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error('暂只支持 md、txt、csv、docx 文档')
  }
  log.info('[documents:parsePlan] read source file', {
    fileName: path.basename(filePath),
    extension: ext,
    size: stat.size
  })

  const name =
    typeof file.name === 'string' && file.name.trim().length > 0
      ? file.name.trim()
      : path.basename(filePath)
  const type: PreparedSourceFile['type'] =
    ext === '.docx' ? 'docx' : ext === '.md' ? 'markdown' : ext === '.csv' ? 'csv' : 'text'

  const safeBaseName = toSafeFileName(path.basename(name, ext))
  const stamp = Date.now()
  const uniqueId = nanoid(8)
  const workspaceName =
    ext === '.docx'
      ? `${stamp}-${uniqueId}-${safeBaseName || 'source'}.md`
      : `${stamp}-${uniqueId}-${safeBaseName}${ext}`
  const workspacePath = path.join(workspaceDir, workspaceName)
  let characterCount = stat.size

  if (ext === '.docx') {
    const markdown = await convertDocxToMarkdown(filePath)
    if (!markdown) throw new Error(`${name} 未解析出可用文本`)
    await fs.promises.writeFile(
      workspacePath,
      [
        `# ${path.basename(name, ext)}`,
        '',
        '> Converted from Word .docx for agent reading. Inline images were omitted; image alt text may be preserved when available.',
        '',
        markdown
      ].join('\n'),
      'utf-8'
    )
    characterCount = markdown.length
    log.info('[documents:parsePlan] docx converted for reading', {
      originalName: name,
      workspaceName,
      characterCount
    })
  } else {
    if (path.resolve(filePath) !== path.resolve(workspacePath)) {
      await fs.promises.copyFile(filePath, workspacePath)
    }
    log.info('[documents:parsePlan] text source prepared for reading', {
      originalName: name,
      workspaceName,
      characterCount
    })
  }

  return {
    name,
    type,
    characterCount,
    path: workspacePath,
    originalPath: filePath,
    workspacePath,
    virtualPath: `/${workspaceName}`
  }
}

const normalizeGeneratedPlan = (
  rawText: string,
  fallback: {
    topic: string
    pageCount: number | null
    briefText: string
  }
): Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'> => {
  const parsed = (() => {
    try {
      return JSON.parse(extractJsonBlock(rawText)) as unknown
    } catch {
      return null
    }
  })()
  const object =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}

  const topic = String(object.topic || object.title || fallback.topic || '').trim()
  const rawPageCount = Number(object.pageCount)
  const pageCount = Number.isFinite(rawPageCount)
    ? Math.min(MAX_PAGE_COUNT, Math.max(1, Math.round(rawPageCount)))
    : fallback.pageCount || 5
  const briefText = String(object.briefText || object.brief || object.description || '').trim()

  if (!topic) throw new Error('文档解析完成，但模型未返回 topic')
  if (!briefText) throw new Error('文档解析完成，但模型未返回 briefText')

  return {
    topic,
    pageCount,
    briefText
  }
}

const buildDocumentPlanPrompt = (args: {
  topic: string
  pageCount: number | null
  existingBrief: string
  file: PreparedSourceFile
}): string =>
  [
    '请使用文件系统工具读取用户上传的文档，并生成 PPT 创建页需要的固定结构。',
    '',
    '只返回 JSON 对象，不要输出 Markdown、解释或额外字段。',
    '必须严格使用字段：topic、pageCount、briefText。',
    '',
    '字段规则：',
    '- topic：适合作为创建页「主题」输入框的短标题，12-36 个中文字符左右。',
    `- pageCount：适合作为创建页「页数」的整数，范围 1-${MAX_PAGE_COUNT}。`,
    '- briefText：适合作为创建页「详细描述」输入框的中文内容。',
    '- briefText 用于创建会话前填充「详细描述」，应是简明但有结构的大纲，不需要展开全部原文细节。',
    '- briefText 建议 500-1200 中文字，包含：演示目标、受众/场景、核心观点、建议大纲、每页要点、必须保留的事实/数字/术语、风格或表达注意事项。',
    '- “建议大纲”和“每页要点”必须尽量对齐源文档章节结构，输出接近 pageCount 的页级标题和要点，减少后续规划阶段自由发挥。',
    '- 每页要点不要只写“背景/目标/价值”这类空泛词，应写出该页对应的源文档主题、功能、流程、时间节点或结论。',
    '- 后续真正生成 PPT 时会优先读取源文档，所以 briefText 只负责建立生成方向和页结构。',
    '- 如果文档中有功能清单、上线时间、优先级、流程、角色、系统名、指标、风险、结论，请在 briefText 中点名保留。',
    '- 可以压缩原文，但不要大段粘贴原文。',
    '- 保留文档中的关键事实、数字、专有名词、结论和结构。',
    '- 不要编造文档里没有的精确数据。',
    args.pageCount
      ? `- 如果文档没有强烈反对，pageCount 优先使用 ${args.pageCount}。`
      : '- 根据文档结构自行判断 pageCount。',
    '',
    '读取要求：',
    `- 文档路径：${args.file.virtualPath}`,
    '- 必须调用 read_file 读取文档内容后再生成结果。',
    '- 如果文件较长，请多次调用 read_file 分段阅读并逐步归纳，不要只读开头。',
    '- 如果文档是 Word 文件，它已经被转换成 Markdown 文本供你读取。',
    args.topic ? `\n用户填写的主题：${args.topic}` : '\n用户未填写明确主题，请从文档中推断。',
    args.existingBrief ? `\n用户已有描述：\n${args.existingBrief}` : '',
    '',
    '返回格式示例：',
    '{"topic":"某某项目路演方案","pageCount":8,"briefText":"演示目标：...\\n受众/场景：...\\n核心观点：...\\n建议大纲：\\n1. ...\\n2. ...\\n每页要点：\\n第1页：...\\n第2页：...\\n必须保留的事实/数字/术语：...\\n风格或表达注意事项：..."}'
  ].join('\n')

const runDocumentPlanAgent = async (args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  workspaceDir: string
  file: PreparedSourceFile
  topic: string
  pageCount: number | null
  existingBrief: string
}): Promise<string> => {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, 0.2)
  const prompt = buildDocumentPlanPrompt({
    topic: args.topic,
    pageCount: args.pageCount,
    existingBrief: args.existingBrief,
    file: args.file
  })
  log.info('[documents:parsePlan] agent read_file requested', {
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
      '你是文档到 PPT 创建表单的解析 agent。你必须使用 read_file 读取用户提供的文件，必要时分段阅读，提取主题、页数建议和结构化大纲，然后只输出严格 JSON：topic、pageCount、briefText。后续生成 PPT 会继续读取源文档，所以 briefText 保持清晰大纲即可。'
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
      signal: AbortSignal.timeout(5 * 60_000)
    }
  )

  let messageBuffer = ''
  const seenToolEvents = new Set<string>()
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (!Array.isArray(chunk) || chunk.length < 3) continue
    const mode = chunk[1] as string
    const data = chunk[2]
    if (mode === 'updates') {
      logDocumentPlanToolEvents(data, seenToolEvents, 'updates')
      continue
    }
    if (mode !== 'messages' || !Array.isArray(data)) continue
    logDocumentPlanToolEvents(data, seenToolEvents, 'messages')
    for (const message of data as Array<Record<string, unknown>>) {
      const content = extractModelText(message).trim()
      if (content) {
        messageBuffer += content
      }
    }
  }
  return messageBuffer
}

export function registerDocumentParseHandlers(ctx: IpcContext): void {
  const { db, decryptApiKey, resolveStoragePath } = ctx

  ipcMain.handle('documents:parsePlan', async (_event, payload: ParseDocumentPlanPayload) => {
    const input = payload && typeof payload === 'object' ? payload : { files: [] }
    const files = Array.isArray(input.files) ? input.files.slice(0, MAX_DOCUMENT_FILES) : []
    if (files.length === 0) throw new Error('请先选择要解析的文档')
    log.info('[documents:parsePlan] invoke', {
      files: files.map((file) => ({
        name: typeof file.name === 'string' ? file.name : path.basename(String(file.path || '')),
        pathProvided: typeof file.path === 'string' && file.path.trim().length > 0
      }))
    })

    const docsDir = path.join(await resolveStoragePath(), 'docs')
    await fs.promises.mkdir(docsDir, { recursive: true })
    const preparedFiles = await Promise.all(files.map((file) => prepareSourceFile(file, docsDir)))
    const [sourceFile] = preparedFiles
    if (!sourceFile) throw new Error('请先选择要解析的文档')

    const settings = await db.getAllSettings()
    const provider = String(settings.provider || '').trim()
    if (!provider) throw new Error('请先前往系统设置选择 provider。')
    const model = String(settings[`model_${provider}`] || '').trim()
    const baseUrl = String(settings[`base_url_${provider}`] || '').trim()
    const apiKey = decryptApiKey(settings[`api_key_${provider}`]).trim()
    if (!model) throw new Error('请先前往系统设置填写 model。')
    if (!apiKey) throw new Error('请先前往系统设置填写 api_key。')

    const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
    const existingBrief = typeof input.existingBrief === 'string' ? input.existingBrief.trim() : ''
    const pageCount =
      typeof input.pageCount === 'number' && Number.isFinite(input.pageCount)
        ? Math.min(MAX_PAGE_COUNT, Math.max(1, Math.floor(input.pageCount)))
        : null

    const responseText = (
      await runDocumentPlanAgent({
        provider,
        apiKey,
        model,
        baseUrl,
        workspaceDir: docsDir,
        file: sourceFile,
        topic,
        pageCount,
        existingBrief
      })
    ).trim()
    if (!responseText) throw new Error('文档解析完成，但模型未返回可用内容')
    log.info('[documents:parsePlan] agent response received', {
      responseLength: responseText.length,
      sourceVirtualPath: sourceFile.virtualPath
    })
    const plan = normalizeGeneratedPlan(responseText, {
      topic: topic || path.basename(sourceFile.name, path.extname(sourceFile.name)),
      pageCount,
      briefText: existingBrief
    })

    return {
      ...plan,
      files: preparedFiles.map(({ name, type, characterCount, workspacePath }) => ({
        name,
        type,
        characterCount,
        path: workspacePath
      }))
    } satisfies ParsedDocumentPlanResult
  })
}
