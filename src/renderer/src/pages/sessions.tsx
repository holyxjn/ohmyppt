import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { FolderOpen, Trash2, MessageSquare } from 'lucide-react'
import { useSessionStore } from '../store'
import { getEditorGate } from '../lib/sessionMetadata'

export function SessionsPage() {
  const navigate = useNavigate()
  const { sessions, fetchSessions, deleteSession } = useSessionStore()

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
    </div>
  )
}
