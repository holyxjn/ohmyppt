import { HumanMessage } from '@langchain/core/messages'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import log from 'electron-log/main.js'
import { resolveModel } from '../agent'
import { extractModelText } from '../ipc/utils'
import { isSupportedImageMimeType, normalizeImageMimeType } from '@shared/image-mime'

export async function invokeVisionModelText(args: {
  imageBase64: string
  mimeType: string
  prompt: string
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  modelTimeoutMs: number
  logTag: string
}): Promise<string> {
  const mimeType = normalizeImageMimeType(args.mimeType)
  const imageBase64 = String(args.imageBase64 || '').trim()
  if (!isSupportedImageMimeType(args.mimeType)) {
    throw new Error(`不支持的图片格式：${mimeType || 'unknown'}`)
  }
  if (!imageBase64) {
    throw new Error('图片数据为空')
  }

  const imageBytes = Buffer.byteLength(imageBase64, 'base64')
  log.info(`[${args.logTag}] invoke vision model`, {
    provider: args.provider,
    model: args.model,
    mimeType,
    imageBytes
  })

  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, 0.2)
  const imageUrl = `data:${mimeType};base64,${imageBase64}`
  const result = await model.invoke(
    [
      new HumanMessage({
        content: [
          { type: 'text', text: args.prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      })
    ],
    {
      signal: AbortSignal.timeout(resolveModelTimeoutMs(args.modelTimeoutMs, 'document'))
    }
  )
  return extractModelText(result)
}
