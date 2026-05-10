type SessionLike = {
  status?: string | null
  page_count?: number | null
  generated_count?: number | null
  generatedCount?: number | null
  failed_count?: number | null
  failedCount?: number | null
  metadata?: string | null
}

type SessionMetadata = {
  source?: unknown
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
  const explicitGenerated = Number(session?.generated_count ?? session?.generatedCount)
  const explicitFailed = Number(session?.failed_count ?? session?.failedCount)
  const generatedCount = Number.isFinite(explicitGenerated)
    ? Math.max(0, Math.floor(explicitGenerated))
    : 0
  const failedCount = Number.isFinite(explicitFailed)
    ? Math.max(0, Math.floor(explicitFailed))
    : 0
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
