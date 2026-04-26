import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { FolderOpen, Trash2, Clock, MessageSquare, RotateCcw } from 'lucide-react'
import { useSessionStore } from '../store'

export function SessionsPage() {
  const navigate = useNavigate()
  const { sessions, fetchSessions, deleteSession } = useSessionStore()

  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])

  const sortedSessions = [...sessions].sort((a, b) => b.updated_at - a.updated_at)
  const statusLabel = (status: string) => {
    if (status === 'failed') return '失败'
    if (status === 'completed') return '完成'
    if (status === 'active') return '生成中'
    return status
  }
  const getSessionRoute = (session: { id: string; status: string }) =>
    session.status === 'completed' ? `/sessions/${session.id}` : `/sessions/${session.id}/generating`

  const buildRetryPrompt = (session: { topic: string | null; page_count: number | null; styleId: string | null }) => {
    const topic = (session.topic || '').trim()
    const pageCount = session.page_count || 5
    const styleId = session.styleId || 'minimal-white'
    if (topic) {
      return `请围绕“${topic}”重新生成一份 ${pageCount} 页演示稿，风格为 ${styleId}。请从头构建并输出完整可预览页面。`
    }
    return `请重新生成当前会话内容，输出 ${pageCount} 页演示稿，风格为 ${styleId}，并确保页面可直接预览。`
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
          {sortedSessions.map((session) => (
            <Card
              key={session.id}
              className="cursor-pointer transition-all hover:translate-y-[-1px] hover:shadow-[0_14px_28px_rgba(90,72,52,0.16)]"
              onClick={() => navigate(getSessionRoute(session))}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="truncate text-base">{session.title}</CardTitle>
                  <div className="flex items-center gap-1">
                    {session.status === 'failed' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/sessions/${session.id}/generating`, {
                            state: {
                              initialPrompt: buildRetryPrompt(session),
                              retry: true,
                            },
                          })
                        }}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        重新生成
                      </Button>
                    )}
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
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="soft-pill inline-flex items-center gap-1 rounded-lg px-3 py-1 text-secondary-foreground">
                    <MessageSquare className="h-3 w-3" />
                    {session.status === 'completed' ? '进入会话' : '继续生成'}
                  </span>
                  <span>{session.topic || '无主题'}</span>
                  <span>•</span>
                  <span>{session.page_count || '?'} 页</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(session.updated_at * 1000).toLocaleString()}
                  </span>
                  <span>•</span>
                  <span>{statusLabel(session.status)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
