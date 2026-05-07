export interface SessionGeneratedPage {
  pageNumber: number
  title: string
  pageId?: string
  htmlPath?: string
}

export interface SessionFailedPage {
  pageId?: string
  title?: string
  reason?: string
}

export interface SessionMetadata {
  lastRunId?: string
  entryMode?: 'multi_page' | 'single_page'
  generatedPages?: SessionGeneratedPage[]
  failedPages?: SessionFailedPage[]
  indexPath?: string
  projectId?: string
  // pptx-import specific
  source?: string
  importedAt?: number
  originalFileName?: string
  warnings?: string[]
}

export function parseSessionMetadata(raw: string | undefined | null): SessionMetadata {
  if (!raw || !raw.trim()) return {}
  try {
    return JSON.parse(raw) as SessionMetadata
  } catch {
    return {}
  }
}

/**
 * Derive a stable pageNumber from pageId when it follows the `page-N` convention.
 * Falls back to `fallback` when pageId doesn't match the pattern.
 */
export function derivePageNumber(pageId: string | undefined, fallback: number): number {
  if (pageId) {
    const n = Number(pageId.match(/^page-(\d+)$/i)?.[1])
    if (n > 0) return n
  }
  return fallback
}
