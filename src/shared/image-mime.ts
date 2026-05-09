export const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

export function normalizeImageMimeType(value: unknown): string {
  const mimeType = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType
}

export function isSupportedImageMimeType(value: unknown): boolean {
  const mimeType = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)
}
