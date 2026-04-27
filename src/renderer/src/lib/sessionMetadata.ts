type SessionLike = {
  status?: string | null
  page_count?: number | null
  metadata?: string | null
}

type SessionMetadata = {
  generatedPages?: unknown[]
  failedPages?: unknown[]
}

export interface EditorGate {
  canEdit: boolean
  generatedCount: number
  failedCount: number
  totalCount: number
  requiredCount: number
}

export const parseSessionMetadata = (metadata: string | null | undefined): SessionMetadata => {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata) as SessionMetadata
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const getEditorGate = (session: SessionLike | null | undefined, threshold = 0.5): EditorGate => {
  const metadata = parseSessionMetadata(session?.metadata)
  const generatedCount = Array.isArray(metadata.generatedPages) ? metadata.generatedPages.length : 0
  const failedCount = Array.isArray(metadata.failedPages) ? metadata.failedPages.length : 0
  const explicitTotal = Number(session?.page_count ?? 0)
  const totalCount = Math.max(
    Number.isFinite(explicitTotal) ? Math.floor(explicitTotal) : 0,
    generatedCount + failedCount,
    generatedCount
  )
  const requiredCount = Math.max(1, Math.ceil(Math.max(1, totalCount) * threshold))
  const canEdit = generatedCount > 0 && (session?.status === 'completed' || generatedCount >= requiredCount)

  return {
    canEdit,
    generatedCount,
    failedCount,
    totalCount: Math.max(1, totalCount),
    requiredCount,
  }
}
