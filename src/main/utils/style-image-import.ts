import { HumanMessage } from '@langchain/core/messages'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { resolveModel } from '../agent'
import { extractModelText } from '../ipc/utils'
import { buildStyleImageImportPrompt } from '../prompt/style-image-import-prompt'
import { parseStyleImportResponse, retryFixJson } from './style-pptx-import'
import type { StyleParseResult } from './style-import'

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export async function parseStyleImage(args: {
  imageBase64: string
  mimeType: string
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  modelTimeoutMs: number
}): Promise<StyleParseResult> {
  const mimeType = String(args.mimeType || '').trim().toLowerCase()
  const imageBase64 = String(args.imageBase64 || '').trim()
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error(`不支持的图片格式：${mimeType || 'unknown'}`)
  }
  if (!imageBase64) {
    throw new Error('图片数据为空')
  }

  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, 0.2)
  const prompt = buildStyleImageImportPrompt()
  const imageUrl = `data:${mimeType};base64,${imageBase64}`

  let responseText = ''
  try {
    const result = await model.invoke(
      [
        new HumanMessage({
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        })
      ],
      {
        signal: AbortSignal.timeout(resolveModelTimeoutMs(args.modelTimeoutMs, 'document'))
      }
    )
    responseText = extractModelText(result)
  } catch (error) {
    if (isImageUnsupportedError(error)) {
      throw new Error('当前模型不支持图片解析，请在设置中切换到支持多模态的模型')
    }
    throw error
  }

  try {
    return parseStyleImportResponse(responseText)
  } catch (parseError) {
    const reason = parseError instanceof Error ? parseError.message : String(parseError)
    const fixedResponse = await retryFixJson({
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      modelTimeoutMs: args.modelTimeoutMs,
      brokenResponse: responseText,
      parseError: reason
    })
    return parseStyleImportResponse(fixedResponse)
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
