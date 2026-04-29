import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { FileText, FileUp, FolderOpen, MessageSquare, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { type Session, useSessionStore } from '../store'
import { useToastStore } from '../store'
import { getEditorGate, parseSessionMetadata } from '../lib/sessionMetadata'

const getSourceTag = (session: Session) => {
  const metadata = parseSessionMetadata(session.metadata)
  const source = typeof metadata.source === 'string' ? metadata.source : ''
  if (source === 'pptx-import' || session.provider === 'import' || session.model === 'pptx-import') {
    return {
      label: 'PPTX 导入',
      Icon: FileUp,
      className: 'border-[#bdd2e6]/80 bg-[#eef6ff] text-[#3e6685]'
    }
  }
  if (session.referenceDocumentPath || session.reference_document_path) {
    return {
      label: '文档创建',
      Icon: FileText,
      className: 'border-[#cbd9b7]/80 bg-[#f3fae9] text-[#526f35]'
    }
  }
  return {
    label: 'AI 创建',
    Icon: Sparkles,
    className: 'border-[#e1d1b7]/80 bg-[#fff7e8] text-[#7c6a4c]'
  }
}

export function SessionsPage() {
  const navigate = useNavigate()
  const { sessions, fetchSessions, deleteSession, updateSessionTitle } = useSessionStore()
  const { success, error } = useToastStore()
  const [renameSession, setRenameSession] = useState<Session | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])

  const sortedSessions = [...sessions].sort((a, b) => b.updated_at - a.updated_at)
  const isFullyGenerated = (session: { status: string; metadata: string | null; page_count: number | null }) => {
    const gate = getEditorGate(session)
    return session.status === 'completed' || (gate.generatedCount >= gate.totalCount && gate.failedCount === 0)
  }

  const getSessionRoute = (session: { id: string; status: string; metadata: string | null; page_count: number | null }) =>
    isFullyGenerated(session) ? `/sessions/${session.id}` : `/sessions/${session.id}/generating`

  const openRenameDialog = (session: Session): void => {
    setRenameSession(session)
    setRenameTitle(session.title)
  }

  const closeRenameDialog = (): void => {
    if (renaming) return
    setRenameSession(null)
    setRenameTitle('')
  }

  const handleRenameSubmit = async (): Promise<void> => {
    if (!renameSession) return
    const title = renameTitle.trim()
    if (!title) {
      error('名称不能为空')
      return
    }
    if (title.length > 120) {
      error('名称过长', { description: '会话名称不能超过 120 个字符。' })
      return
    }
    setRenaming(true)
    try {
      await updateSessionTitle({ sessionId: renameSession.id, title })
      success('会话名称已更新')
      setRenameSession(null)
      setRenameTitle('')
    } catch (err) {
      error('重命名失败', {
        description: err instanceof Error ? err.message : '请稍后重试'
      })
    } finally {
      setRenaming(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Sessions</p>
          <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">会话列表</h1>
        </div>
        <Button onClick={() => navigate('/')}>
          <FolderOpen className="mr-2 h-4 w-4" />
          新建会话
        </Button>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">暂无会话</h3>
            <p className="mb-4 text-muted-foreground">创建你的第一个演示文稿任务</p>
          
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {sortedSessions.map((session) => {
            const isComplete = isFullyGenerated(session)
            const editorGate = getEditorGate(session)
            const hasCompletedPages = editorGate.generatedCount > 0
            const isContinuable = !isComplete && hasCompletedPages
            const statusText = isComplete ? '已完成' : isContinuable ? '可继续生成' : '需重新生成'
            const actionText = isComplete ? '进入会话' : isContinuable ? '继续生成' : '重新生成'
            const sourceTag = getSourceTag(session)
            const SourceIcon = sourceTag.Icon
            const statusClassName = isComplete
              ? 'border-[#bad8b7]/80 bg-[#eef9ec] text-[#4a7a46]'
              : isContinuable
                ? 'border-[#d6c08d]/80 bg-[#fff3cf] text-[#7a5a19] shadow-[0_0_0_1px_rgba(214,192,141,0.14)]'
                : 'border-[#d7b5ae]/70 bg-[#fbf1ee] text-[#93564f]'
            return (
              <Card
                key={session.id}
                className="cursor-pointer transition-all hover:translate-y-[-1px] hover:shadow-[0_14px_28px_rgba(90,72,52,0.16)]"
                onClick={() => navigate(getSessionRoute(session))}
              >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="truncate text-base">{session.title}</CardTitle>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="编辑会话名称"
                      onClick={(e) => {
                        e.stopPropagation()
                        openRenameDialog(session)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(session.id)
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="soft-pill inline-flex items-center gap-1 rounded-lg px-3 py-1 text-secondary-foreground">
                    <MessageSquare className="h-3 w-3" />
                    {actionText}
                  </span>
                  <span className={`rounded-lg border px-2 py-1 font-semibold ${statusClassName}`}>
                    {statusText}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-semibold ${sourceTag.className}`}>
                    <SourceIcon className="h-3 w-3" />
                    {sourceTag.label}
                  </span>
                  <span className="rounded-lg border border-[#e1d1b7]/80 bg-[#fff7e8]/75 px-2 py-1 text-[#7c6a4c]">
                    {editorGate.generatedCount}/{editorGate.totalCount} 页
                  </span>
                  {!isComplete && editorGate.failedCount > 0 && (
                    <span className="rounded-lg border border-[#d7b5ae]/70 bg-[#fff7f2]/80 px-2 py-1 text-[#93564f]">
                      失败 {editorGate.failedCount}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
            )
          })}
        </div>
      )}
      {renameSession ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1f261d]/35 p-4 backdrop-blur-sm"
          onClick={closeRenameDialog}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#d8cfbc]/80 bg-[#fffaf0] p-5 shadow-[0_24px_60px_rgba(64,52,38,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#3e4a32]">编辑会话名称</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  只会修改列表和导出时使用的会话名称，不会重新生成页面内容。
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeRenameDialog} disabled={renaming}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleRenameSubmit()
              }}
            >
              <Input
                autoFocus
                value={renameTitle}
                maxLength={120}
                placeholder="输入新的会话名称"
                onChange={(event) => setRenameTitle(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={closeRenameDialog} disabled={renaming}>
                  取消
                </Button>
                <Button type="submit" size="sm" disabled={renaming}>
                  {renaming ? '保存中…' : '保存'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
