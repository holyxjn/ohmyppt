import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import log from 'electron-log/main.js'
import { Jieba } from '@node-rs/jieba'

type JiebaDictModule = {
  dict: Uint8Array
}

export type ReferenceDocumentSnippet = {
  sourcePath: string
  headingPath: string[]
  text: string
  startLine: number
  endLine: number
  score: number
}

type ReferenceChunk = {
  id: string
  sourcePath: string
  absolutePath: string
  headingPath: string[]
  text: string
  normalizedText: string
  normalizedHeading: string
  startLine: number
  endLine: number
}

type SearchInput = {
  pageId: string
  pageTitle: string
  pageOutline: string
  userMessage: string
}

type ReferenceDocumentRetriever = {
  search: (input: SearchInput) => ReferenceDocumentSnippet[]
}

let jiebaInstance: Jieba | null = null

const getJieba = (): Jieba => {
  if (!jiebaInstance) {
    const require = createRequire(import.meta.url)
    const { dict } = require('@node-rs/jieba/dict.js') as JiebaDictModule
    jiebaInstance = Jieba.withDict(dict)
  }
  return jiebaInstance
}

const MAX_CHUNK_CHARS = 1200
const MIN_CHUNK_CHARS = 300
const MAX_SNIPPETS = 5
const MAX_INJECTED_CHARS = 6000

const GENERIC_TERMS = new Set([
  '背景',
  '目标',
  '价值',
  '方案',
  '介绍',
  '说明',
  '分析',
  '概述',
  '总结',
  '规划',
  '设计',
  '能力',
  '功能',
  '核心',
  '重点',
  '整体',
  '业务',
  '内容',
  '页面',
  '展示'
])

const normalizeForSearch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、“”‘’（）【】《》,.!?;:"'()[\]<>]/g, '')
    .trim()

const cleanText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const isMostlyChinese = (value: string): boolean => /[\u4e00-\u9fff]/.test(value)

const isGenericTerm = (value: string): boolean => {
  const normalized = normalizeForSearch(value)
  if (!normalized) return true
  if (GENERIC_TERMS.has(normalized)) return true
  if (normalized.length <= 1) return true
  return false
}

const splitQueryPhrases = (input: string): string[] => {
  const phrases = input
    .split(/[\n\r。！？；;：:，,、|/\\()[\]【】《》<>]+/g)
    .map((item) => item.replace(/^\s*(?:第?\d+[.、）)]|[-*•]+)\s*/u, '').trim())
    .filter((item) => item.length > 0)
    .filter((item) => item.length >= 3 && item.length <= 40)
    .filter((item) => !isGenericTerm(item))
  return Array.from(new Set(phrases)).slice(0, 8)
}

const extractStructuredTokens = (input: string): string[] => {
  const tokenMatches = input.match(
    /(?:[Pp][0-9]+)|(?:\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)|(?:\d+(?:\.\d+)?%)|(?:\d+(?:\.\d+)?(?:万|亿|元|万元|亿元)?)|(?:[A-Za-z][A-Za-z0-9_-]{1,})/g
  )
  return Array.from(new Set(tokenMatches || [])).filter((item) => !isGenericTerm(item))
}

const extractWordQueries = (input: string): string[] => {
  const words = getJieba().cutForSearch(input, false)
  const structured = extractStructuredTokens(input)
  const candidates = [...words, ...structured]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => {
      if (isGenericTerm(item)) return false
      if (isMostlyChinese(item)) return item.length >= 2 && item.length <= 12
      return item.length >= 2 && item.length <= 32
    })
  return Array.from(new Set(candidates)).slice(0, 20)
}

const createQueries = (input: SearchInput): { phraseQueries: string[]; wordQueries: string[] } => {
  const source = [input.pageTitle, input.pageOutline, input.userMessage].filter(Boolean).join('\n')
  const phraseQueries = splitQueryPhrases(source)
  const wordQueries = extractWordQueries(source).filter(
    (word) => !phraseQueries.some((phrase) => normalizeForSearch(phrase) === normalizeForSearch(word))
  )
  return { phraseQueries, wordQueries }
}

const splitLongText = (text: string): string[] => {
  const normalized = text.trim()
  if (normalized.length <= MAX_CHUNK_CHARS) return [normalized]
  const parts = normalized
    .split(/(?<=[。！？；;.!?])\s*/u)
    .map((item) => item.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const part of parts.length > 0 ? parts : [normalized]) {
    if (current && `${current}${part}`.length > MAX_CHUNK_CHARS) {
      chunks.push(current.trim())
      current = ''
    }
    current = current ? `${current}${part}` : part
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [normalized.slice(0, MAX_CHUNK_CHARS)]
}

const createChunk = (args: {
  sourcePath: string
  absolutePath: string
  headingPath: string[]
  text: string
  startLine: number
  endLine: number
  index: number
}): ReferenceChunk => {
  const text = cleanText(args.text)
  const headingPath = args.headingPath.filter(Boolean)
  return {
    id: `${args.sourcePath}:${args.startLine}-${args.endLine}:${args.index}`,
    sourcePath: args.sourcePath,
    absolutePath: args.absolutePath,
    headingPath,
    text,
    normalizedText: normalizeForSearch(text),
    normalizedHeading: normalizeForSearch(headingPath.join(' ')),
    startLine: args.startLine,
    endLine: args.endLine
  }
}

const chunkDocument = (args: {
  sourcePath: string
  absolutePath: string
  content: string
}): ReferenceChunk[] => {
  const lines = args.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const chunks: ReferenceChunk[] = []
  const headingPath: string[] = []
  let buffer: string[] = []
  let bufferStartLine = 1
  let chunkIndex = 0

  const pushBuffer = (endLine: number) => {
    const text = buffer.join('\n').trim()
    if (!text) {
      buffer = []
      return
    }
    for (const part of splitLongText(text)) {
      chunks.push(
        createChunk({
          sourcePath: args.sourcePath,
          absolutePath: args.absolutePath,
          headingPath,
          text: part,
          startLine: bufferStartLine,
          endLine,
          index: chunkIndex
        })
      )
      chunkIndex += 1
    }
    buffer = []
  }

  const appendLine = (line: string, lineNumber: number) => {
    if (buffer.length === 0) bufferStartLine = lineNumber
    buffer.push(line)
    const currentLength = buffer.join('\n').length
    if (currentLength >= MAX_CHUNK_CHARS) {
      pushBuffer(lineNumber)
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineNumber = index + 1
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    if (headingMatch) {
      pushBuffer(lineNumber - 1)
      const level = headingMatch[1].length
      headingPath.splice(level - 1)
      headingPath[level - 1] = headingMatch[2].trim()
      continue
    }
    if (!line.trim()) {
      pushBuffer(lineNumber - 1)
      continue
    }
    appendLine(line, lineNumber)
  }
  pushBuffer(lines.length)

  const merged: ReferenceChunk[] = []
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.text.length < MIN_CHUNK_CHARS &&
      chunk.text.length < MIN_CHUNK_CHARS &&
      prev.sourcePath === chunk.sourcePath &&
      prev.headingPath.join('/') === chunk.headingPath.join('/')
    ) {
      const text = `${prev.text}\n${chunk.text}`.trim()
      merged[merged.length - 1] = {
        ...prev,
        text,
        normalizedText: normalizeForSearch(text),
        endLine: chunk.endLine
      }
      continue
    }
    merged.push(chunk)
  }
  return merged
}

const resolveSourcePath = (projectDir: string, sourceDocumentPath: string): string | null => {
  if (!sourceDocumentPath.startsWith('/docs/')) return null
  const absolutePath = path.resolve(projectDir, sourceDocumentPath.replace(/^\/+/, ''))
  const relativeToProject = path.relative(projectDir, absolutePath)
  if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) return null
  return absolutePath
}

const scoreChunk = (
  chunk: ReferenceChunk,
  queries: { phraseQueries: string[]; wordQueries: string[] }
): number => {
  let score = 0
  const seen = new Set<string>()
  for (const phrase of queries.phraseQueries) {
    const normalized = normalizeForSearch(phrase)
    if (!normalized || seen.has(`phrase:${normalized}`)) continue
    seen.add(`phrase:${normalized}`)
    if (chunk.normalizedText.includes(normalized)) score += 2
    if (chunk.normalizedHeading.includes(normalized)) score += 2
  }
  for (const word of queries.wordQueries) {
    const normalized = normalizeForSearch(word)
    if (!normalized || seen.has(`word:${normalized}`)) continue
    seen.add(`word:${normalized}`)
    if (chunk.normalizedText.includes(normalized)) score += 1
    if (chunk.normalizedHeading.includes(normalized)) score += 2
  }
  return score
}

const selectSnippets = (
  chunks: ReferenceChunk[],
  queries: { phraseQueries: string[]; wordQueries: string[] }
): { snippets: ReferenceDocumentSnippet[]; matchedChunkCount: number } => {
  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queries) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.startLine - b.chunk.startLine)

  const snippets: ReferenceDocumentSnippet[] = []
  let injectedChars = 0
  for (const item of scored) {
    if (snippets.length >= MAX_SNIPPETS) break
    if (injectedChars >= MAX_INJECTED_CHARS) break
    const text =
      item.chunk.text.length > 1400 ? `${item.chunk.text.slice(0, 1400).trimEnd()}...` : item.chunk.text
    snippets.push({
      sourcePath: item.chunk.sourcePath,
      headingPath: item.chunk.headingPath,
      text,
      startLine: item.chunk.startLine,
      endLine: item.chunk.endLine,
      score: item.score
    })
    injectedChars += text.length
  }
  return { snippets, matchedChunkCount: scored.length }
}

export const formatReferenceDocumentSnippets = (
  snippets: ReferenceDocumentSnippet[]
): string => {
  if (snippets.length === 0) return ''
  return [
    '参考文档检索片段（程序侧根据当前页标题和大纲预检索，优先使用）：',
    '',
    ...snippets.flatMap((snippet, index) => [
      `[片段 ${index + 1}] ${snippet.sourcePath}#L${snippet.startLine}-L${snippet.endLine}`,
      snippet.headingPath.length > 0 ? `标题路径：${snippet.headingPath.join(' / ')}` : '',
      `内容：${snippet.text}`,
      ''
    ])
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export const createReferenceDocumentRetriever = async (args: {
  sessionId: string
  projectDir: string
  sourceDocumentPaths?: string[]
}): Promise<ReferenceDocumentRetriever | null> => {
  const sourceDocumentPaths = (args.sourceDocumentPaths || []).filter(Boolean)
  if (sourceDocumentPaths.length === 0) return null

  const chunkCache = new Map<string, ReferenceChunk[]>()
  for (const sourcePath of sourceDocumentPaths) {
    const absolutePath = resolveSourcePath(args.projectDir, sourcePath)
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      log.warn('[referenceDocument:grep] source missing', {
        sessionId: args.sessionId,
        sourcePath
      })
      continue
    }
    try {
      const content = await fs.promises.readFile(absolutePath, 'utf-8')
      const chunks = chunkDocument({ sourcePath, absolutePath, content })
      chunkCache.set(sourcePath, chunks)
      log.info('[referenceDocument:grep] chunked', {
        sessionId: args.sessionId,
        sourcePath,
        chunkCount: chunks.length,
        characterCount: content.length
      })
    } catch (error) {
      log.warn('[referenceDocument:grep] read failed', {
        sessionId: args.sessionId,
        sourcePath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const chunks = Array.from(chunkCache.values()).flat()
  if (chunks.length === 0) return null

  return {
    search: (input: SearchInput): ReferenceDocumentSnippet[] => {
      const queries = createQueries(input)
      const { snippets, matchedChunkCount } = selectSnippets(chunks, queries)
      log.info('[referenceDocument:grep] search', {
        sessionId: args.sessionId,
        pageId: input.pageId,
        sourceDocumentPaths,
        phraseQueryCount: queries.phraseQueries.length,
        wordQueryCount: queries.wordQueries.length,
        chunkCount: chunks.length,
        matchedChunkCount,
        injectedChunkCount: snippets.length
      })
      return snippets
    }
  }
}
