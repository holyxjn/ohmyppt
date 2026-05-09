export type HistoryOperationKind =
  | 'generate'
  | 'edit'
  | 'addPage'
  | 'retry'
  | 'import'
  | 'rollback'

export type HistoryOperationScope = 'session' | 'deck' | 'page' | 'selector' | 'shell'

export type ChangedHistoryFile = {
  path: string
  changeType: 'added' | 'modified' | 'deleted'
  pageId?: string
}

export type HistoryVersion = {
  id: string
  sessionId: string
  operationId: string
  commit: string
  title: string
  description: string
  kind: HistoryOperationKind
  scope: HistoryOperationScope
  createdAt: number
  changedFiles: ChangedHistoryFile[]
  changedPages: string[]
  isCurrent: boolean
  isRestorable: boolean
}

export type RollbackHistoryResult = {
  versionId: string
  operationId: string
  beforeCommit: string
  targetCommit: string
  afterCommit: string
  changedFiles: ChangedHistoryFile[]
  changedPages: string[]
}
