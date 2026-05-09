import { buildStyleImageImportPrompt } from '../prompt/style-image-import-prompt'
import { parseStyleImportResponse, retryFixJson } from './style-pptx-import'
import type { StyleParseResult } from './style-import'
import { invokeVisionModelText } from './vision-model'
import { isSupportedImageMimeType, normalizeImageMimeType } from '@shared/image-mime'

export async function parseStyleImage(args: {
  imageBase64: string
  mimeType: string
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  modelTimeoutMs: number
}): Promise<StyleParseResult> {
  const mimeType = normalizeImageMimeType(args.mimeType)
  const imageBase64 = String(args.imageBase64 || '').trim()
  if (!isSupportedImageMimeType(args.mimeType)) {
    throw new Error(`不支持的图片格式：${mimeType || 'unknown'}`)
  }
  if (!imageBase64) {
    throw new Error('图片数据为空')
  }

  const prompt = buildStyleImageImportPrompt()

  let responseText = ''
  try {
    responseText = await invokeVisionModelText({
      ...args,
      mimeType,
      imageBase64,
      prompt,
      logTag: 'styles:parseImage'
    })
  } catch (error) {
    if (isImageUnsupportedError(error)) {
      throw new Error('当前模型不支持图片解析，请在设置中切换到支持多模态的模型')
    }
    throw error
  }

  const parsed = await parseStyleImageResponseWithRepairs(responseText, args)
  assertImageWasRead(`${parsed.label}\n${parsed.description}\n${parsed.styleSkill}`)
  return parsed
}

async function parseStyleImageResponseWithRepairs(
  responseText: string,
  args: {
    provider: string
    apiKey: string
    model: string
    baseUrl: string
    modelTimeoutMs: number
  }
): Promise<StyleParseResult> {
  let candidate = responseText
  const maxRepairAttempts = 2
  for (let repairAttempt = 0; repairAttempt <= maxRepairAttempts; repairAttempt += 1) {
    try {
      return parseStyleImportResponse(candidate)
    } catch (parseError) {
      if (repairAttempt >= maxRepairAttempts) throw parseError
      const reason = parseError instanceof Error ? parseError.message : String(parseError)
      candidate = await retryFixJson({
        provider: args.provider,
        apiKey: args.apiKey,
        model: args.model,
        baseUrl: args.baseUrl,
        modelTimeoutMs: args.modelTimeoutMs,
        brokenResponse: candidate,
        parseError: reason
      })
    }
  }
  throw new Error('LLM 返回格式异常：JSON 修复失败')
}

export function assertImageWasRead(text: string): void {
  const normalized = text.toLowerCase()
  const missingImagePatterns = [
    /未提供图片/,
    /未上传图片/,
    /未发现可分析的图片/,
    /未检测到图片/,
    /没有图片/,
    /无法完成图片分析/,
    /无法分析图片/,
    /图片文件未上传/,
    /no image/,
    /image (?:was )?not (?:provided|uploaded|attached)/,
    /cannot (?:analyze|inspect|see|view) (?:the )?image/,
    /unable to (?:analyze|inspect|see|view) (?:the )?image/
  ]
  if (missingImagePatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error('当前模型未能读取图片，请在设置中切换到支持多模态的模型后重试')
  }
}

export function isImageUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()
  return [
    /invalid_image/i,
    /image not supported/i,
    /does not support images/i,
    /unsupported content type/i,
    /multimodal/i,
    /vision/i
  ].some((pattern) => pattern.test(normalized))
}
