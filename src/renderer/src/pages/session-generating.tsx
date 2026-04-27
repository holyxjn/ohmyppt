import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Sparkles, Loader2, CheckCircle2, CircleAlert, Home, ChevronRight, ChevronLeft } from 'lucide-react'
import { ipc } from '@renderer/lib/ipc'
import type { GenerateChunkEvent } from '@shared/generation.js'
import { Button } from '../components/ui/Button'
import { ScrollArea } from '../components/ui/ScrollArea'
import videoSrc from '../assets/images/video.mp4'
import dayjs from 'dayjs'
import { getEditorGate, type EditorGate } from '../lib/sessionMetadata'

type LocationState = {
  initialPrompt?: string
  retry?: boolean
  rerunToken?: number
}

const STAGE_LABELS: Record<string, string> = {
  preflight: '理解需求',
  planning: '规划结构',
  rendering: '逐页生成页面',
}

const NOISY_REPEATED_PATTERNS = [
  /^模型正在构思第\s*\d+\s*页/,
  /^正在写入第\s*\d+\s*页/,
  /^验证完成状态/,
  /^当前页面已填充/,
]

const extractFailedPages = (message: string | null): string[] => {
  if (!message) return []
  const matches = Array.from(message.matchAll(/page-\d+\([^)]+\)/g))
  return matches.map((match) => match[0]).slice(0, 12)
}

const isSessionFullyGenerated = (gate: EditorGate) =>
  gate.generatedCount >= gate.totalCount && gate.failedCount === 0

export function SessionGeneratingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state as LocationState | null) || null
  const startedSessionRef = useRef<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const terminalStatusRef = useRef<'completed' | 'failed' | null>(null)
  const eventsContainerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  const [status, setStatus] = useState<'running' | 'completed' | 'failed'>('running')
  const [progress, setProgress] = useState(0)
  const [events, setEvents] = useState<Array<{ text: string; time?: string }>>([
    { text: '生成任务已创建，正在启动引擎…', time: new Date().toISOString() },
  ])
  const [error, setError] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState<string>('当前会话')
  const [, setTotalPages] = useState<number>(1)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [editorGate, setEditorGate] = useState<EditorGate>(() => getEditorGate(null))

  const appendEvent = (line: string, timestamp?: string) => {
    setEvents((prev) => {
      const normalized = line.replace(/\s+/g, ' ').trim()
      const normalizedPrev = prev.map((item) => item.text.replace(/\s+/g, ' ').trim())
      if (normalizedPrev[normalizedPrev.length - 1] === normalized) {
        return prev
      }
      const noisyPattern = NOISY_REPEATED_PATTERNS.find((pattern) => pattern.test(normalized))
      if (noisyPattern) {
        const hasRecentNoisy = normalizedPrev.slice(-12).some((item) => noisyPattern.test(item))
        if (hasRecentNoisy) {
          return prev
        }
      }
      const recent = normalizedPrev.slice(-4)
      if (recent.includes(normalized) && NOISY_REPEATED_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return prev
      }
      const next = [...prev, { text: line, time: timestamp }]
      return next.length > 300 ? next.slice(next.length - 300) : next
    })
  }

  useEffect(() => {
    const el = eventsContainerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [events])

  useEffect(() => {
    if (!id) {
      navigate('/sessions')
      return
    }
    let active = true

    const initialPrompt =
      state?.initialPrompt?.trim() ||
      '请生成一份结构清晰、可直接预览的演示文稿初稿。'
    const explicitRerun = typeof state?.rerunToken === 'number'
    if (state?.retry || explicitRerun) {
      startedSessionRef.current = null
      activeRunIdRef.current = null
      terminalStatusRef.current = null
      setStatus('running')
      setProgress(0)
      setError(null)
      setEvents([{ text: '生成任务已创建，正在启动引擎…', time: new Date().toISOString() }])
    }

    const applyChunk = (event: GenerateChunkEvent, options?: { replay?: boolean }) => {
      if (import.meta.env.DEV) {
        console.debug('[generate:chunk] received', event)
      }
      if (event.payload.sessionId && event.payload.sessionId !== id) return
      const incomingRunId = event.payload.runId
      if (activeRunIdRef.current && incomingRunId && incomingRunId !== activeRunIdRef.current) return
      if (!options?.replay && !activeRunIdRef.current && incomingRunId) {
        activeRunIdRef.current = incomingRunId
      }
      const applyProgress = (next: number | undefined, options?: { allowTerminal?: boolean }) => {
        const hardMax = options?.allowTerminal ? 100 : 90
        const value = Math.max(0, Math.min(hardMax, Math.round(next ?? 0)))
        setProgress((prev) => Math.max(prev, value))
      }
      const applyTotalPages = (next: number | undefined) => {
        if (!Number.isFinite(next)) return
        const pages = Math.max(1, Math.floor(next as number))
        setTotalPages((prev) => Math.max(prev, pages))
      }
      if (event.type === 'stage_started' || event.type === 'stage_progress') {
        applyProgress(event.payload.progress)
        applyTotalPages(event.payload.totalPages)
        appendEvent(`${STAGE_LABELS[event.payload.stage] || event.payload.stage} · ${event.payload.label}`, event.payload.timestamp)
        return
      }

      if (event.type === 'llm_status') {
        applyProgress(event.payload.progress)
        applyTotalPages(event.payload.totalPages)
        appendEvent(`${event.payload.label}${event.payload.detail ? ` · ${event.payload.detail}` : ''}`, event.payload.timestamp)
        return
      }

      if (event.type === 'page_generated') {
        applyProgress(event.payload.progress)
        applyTotalPages(Math.max(event.payload.totalPages ?? 0, event.payload.pageNumber))
        appendEvent(`第 ${event.payload.pageNumber} 页已完成：${event.payload.title}`, event.payload.timestamp)
        return
      }

      if (event.type === 'assistant_message') {
        appendEvent(event.payload.content, event.payload.timestamp)
        return
      }

      if (event.type === 'run_completed') {
        if (!active) return
        terminalStatusRef.current = 'completed'
        setStatus('completed')
        applyProgress(100, { allowTerminal: true })
        applyTotalPages(event.payload.totalPages)
        appendEvent('整份演示已生成完成。', event.payload.timestamp)
        if (options?.replay) return
        window.setTimeout(() => {
          if (!active) return
          navigate(`/sessions/${id}`)
        }, 850)
        return
      }

      if (event.type === 'run_error') {
        if (options?.replay && state?.retry) return
        if (!active) return
        terminalStatusRef.current = 'failed'
        setStatus('failed')
        setError(event.payload.message)
        appendEvent('生成失败，请点击重试或返回会话列表。', event.payload.timestamp)
        void ipc.getSession(id).then(({ session }) => {
          if (!active) return
          setEditorGate(getEditorGate(session as { status?: string; page_count?: number | null; metadata?: string | null } | null))
        }).catch(() => {})
      }
    }

    const unsubscribe = ipc.onGenerateChunk((event) => applyChunk(event))

    const startRun = () => {
      const runKey = `${id}:${state?.retry ? 'retry' : 'generate'}:${state?.rerunToken ?? 'initial'}`
      if (startedSessionRef.current === runKey) return
      startedSessionRef.current = runKey
      setStatus('running')
      setError(null)
      terminalStatusRef.current = null
      if (import.meta.env.DEV) {
        console.info('[generate:start] request', { sessionId: id, retry: Boolean(state?.retry), hasInitialPrompt: Boolean(initialPrompt) })
      }
      const request = state?.retry
        ? ipc.retryFailedPages({
            sessionId: id,
            userMessage: state.initialPrompt?.trim() || undefined
          })
        : ipc.startGenerate({ sessionId: id, userMessage: initialPrompt, type: 'deck' })
      void request
        .then((result) => {
          if (result?.runId) {
            activeRunIdRef.current = result.runId
          }
          if (result?.alreadyRunning) {
            appendEvent('检测到该会话仍在后台生成，已恢复连接。', new Date().toISOString())
            return
          }
          if (import.meta.env.DEV) {
            console.info('[generate:start] promise resolved', { sessionId: id })
          }
          if (!active || terminalStatusRef.current) return
          appendEvent('任务已启动，正在逐页生成中…', new Date().toISOString())
        })
        .catch((e) => {
          if (import.meta.env.DEV) {
            console.error('[generate:start] promise rejected', {
              sessionId: id,
              message: e instanceof Error ? e.message : String(e),
            })
          }
          if (!active) return
          const message = e instanceof Error ? e.message : '生成失败'
          appendEvent('生成失败，请点击重试或返回会话列表。', new Date().toISOString())
          setStatus('failed')
          setError(message)
          void ipc.getSession(id).then(({ session }) => {
            if (!active) return
            setEditorGate(getEditorGate(session as { status?: string; page_count?: number | null; metadata?: string | null } | null))
          }).catch(() => {})
        })
    }

    void Promise
      .all([
        ipc.getSession(id),
        ipc.getGenerateState(id).catch(() => null),
      ])
      .then(([{ session }, runState]) => {
        if (!active) return
        const snapshot = (session || {}) as { status?: string; title?: string | null; page_count?: number | null; metadata?: string | null }
        const currentStatus = snapshot.status || 'active'
        const snapshotGate = getEditorGate(snapshot)
        setEditorGate(snapshotGate)
        if (snapshot.title && snapshot.title.trim().length > 0) {
          setSessionTitle(snapshot.title)
        }
        if (typeof snapshot.page_count === 'number' && snapshot.page_count > 0) {
          setTotalPages(Math.floor(snapshot.page_count))
        }

        if (runState) {
          const shouldHydrateFromSnapshot = !state?.retry || runState.hasActiveRun

          if (runState.hasActiveRun && runState.runId) {
            activeRunIdRef.current = runState.runId
          }
          if (shouldHydrateFromSnapshot && typeof runState.totalPages === 'number' && runState.totalPages > 0) {
            setTotalPages((prev) => Math.max(prev, Math.floor(runState.totalPages)))
          }
          if (shouldHydrateFromSnapshot && typeof runState.progress === 'number' && runState.progress > 0) {
            const safeProgress =
              runState.status === 'completed'
                ? Math.min(100, Math.floor(runState.progress))
                : Math.min(90, Math.floor(runState.progress))
            setProgress((prev) => Math.max(prev, safeProgress))
          }
          if (shouldHydrateFromSnapshot && runState.status === 'failed' && runState.error) {
            setError(runState.error)
          }
          if (shouldHydrateFromSnapshot && Array.isArray(runState.events) && runState.events.length > 0) {
            for (const event of runState.events) {
              applyChunk(event, { replay: true })
            }
          }
          if (runState.status === 'completed' && !state?.retry && !explicitRerun) {
            navigate(`/sessions/${id}`, { replace: true })
            return
          }
          if (runState.status === 'failed' && !state?.retry && !explicitRerun) {
            setStatus('failed')
            setError(runState.error || '该会话上一次生成失败，你可以直接重试。')
            appendEvent('检测到该会话未成功完成，保留在生成页以便继续处理。', new Date().toISOString())
            return
          }
          if (runState.hasActiveRun) {
            setStatus('running')
            appendEvent('检测到任务仍在后台运行，已恢复实时进度。', new Date().toISOString())
            return
          }
        }

        const hasManualStartIntent = Boolean(
          state?.retry ||
          explicitRerun ||
          (state?.initialPrompt && state.initialPrompt.trim().length > 0)
        )
        const fullyGenerated = isSessionFullyGenerated(snapshotGate)

        if (fullyGenerated && !state?.retry && !explicitRerun) {
          navigate(`/sessions/${id}`, { replace: true })
          return
        }
        if (currentStatus === 'completed' && !state?.retry && !explicitRerun) {
          navigate(`/sessions/${id}`, { replace: true })
          return
        }
        if (!fullyGenerated && !hasManualStartIntent) {
          setStatus('failed')
          if (snapshotGate.generatedCount > 0) {
            setError(`会话尚未完成：已完成 ${snapshotGate.generatedCount}/${snapshotGate.totalCount} 页。请选择继续生成剩余页。`)
            appendEvent('检测到会话部分完成。请继续生成剩余页。', new Date().toISOString())
          } else {
            setError(`会话尚未完成：当前 0/${snapshotGate.totalCount} 页。请重新生成。`)
            appendEvent('检测到会话尚未产出有效页面。请重新生成。', new Date().toISOString())
          }
          return
        }
        if (currentStatus === 'failed' && !state?.retry && !explicitRerun && !hasManualStartIntent) {
          setStatus('failed')
          setError('该会话上一次生成失败，你可以直接重试。')
          appendEvent('检测到该会话未成功完成，保留在生成页以便继续处理。', new Date().toISOString())
          return
        }
        startRun()
      })
      .catch(() => {
        startRun()
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [id, navigate, location.key, state?.initialPrompt, state?.retry, state?.rerunToken])

  const displayProgress = Math.max(0, Math.min(100, Math.round(progress)))
  const failedPages = extractFailedPages(error)
  const fullyGenerated = isSessionFullyGenerated(editorGate)
  const hasGeneratedPages = editorGate.generatedCount > 0

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(165deg,#d8edf8_0%,#cce6ee_38%,#e9e3d1_100%)]">
      <style>{`
        @keyframes gen-shimmer-move { 0% { background-position: 0% 50%; } 100% { background-position: 100% 50%; } }
      `}</style>

      <div className="app-drag-region app-titlebar relative z-10 flex items-center bg-[#fff9ef]/92 backdrop-blur-sm" />

      {/* ── Main content area: video background ── */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Looping video background */}
        <video
          src={videoSrc}
          controls={false}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Info panel — top-left overlay */}
        <div className="app-no-drag absolute left-6 top-16 z-10 flex max-w-[460px] items-start gap-3 rounded-xl border border-[#d4d9be]/80 bg-[#fff9ef]/72 px-4 py-3 text-[#4f613f] shadow-[0_10px_22px_rgba(79,97,63,0.18)] backdrop-blur-sm">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#d8ccb5]/80 bg-[#fff9ef]/78 text-[#5d6b4d] transition-colors hover:bg-[#fff7e8] hover:text-[#3e4a32]"
            aria-label="返回首页"
            title="返回首页"
          >
            <Home className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-[#7d8b63]">Generating</p>
            <p className="mt-1 organic-serif text-2xl font-semibold leading-none">
              AI 正在生成你的创意
            </p>
            <p className="mt-2 max-w-[380px] truncate text-xs text-[#7b8963]">{sessionTitle}</p>
          </div>
        </div>

        {/* ── Right-side log panel ── */}
        {panelCollapsed ? (
          <button
            type="button"
            onClick={() => setPanelCollapsed(false)}
            className="app-no-drag absolute right-6 top-[calc(var(--app-titlebar-height)+12px)] z-30 inline-flex items-center gap-2 rounded-xl border border-[#d8ccb5]/75 bg-[#fff9ef]/86 px-3 py-2 text-[#5f7550] shadow-[0_14px_30px_rgba(83,73,57,0.24)] backdrop-blur-sm transition-colors hover:bg-[#fff6e8]"
            aria-label="展开日志面板"
            title="展开日志面板"
          >
            {status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#6f8159]" />}
            {status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
            {status === 'failed' && <CircleAlert className="h-3.5 w-3.5 text-[#b86966]" />}
            <ChevronLeft className="h-4 w-4" />
            <span className="text-xs font-semibold tracking-wide">成长记录</span>
          </button>
        ) : (
          <aside className="app-no-drag absolute bottom-6 right-6 top-[calc(var(--app-titlebar-height)+12px)] z-20 flex w-[320px] min-h-0 flex-col rounded-xl border border-[#d8ccb5]/70 bg-[#fff9ef]/74 p-3 shadow-[0_20px_46px_rgba(88,74,54,0.26)] backdrop-blur-xl">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-[#495a3b]">
                <Sparkles className="h-4 w-4 text-[#6f8159]" />
                成长记录
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-[#d8ccb5]/80 bg-[#fff9ef]/84 p-2">
                  {status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-[#6f8159]" />}
                  {status === 'completed' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {status === 'failed' && <CircleAlert className="h-4 w-4 text-[#b86966]" />}
                </div>
                <button
                  type="button"
                  onClick={() => setPanelCollapsed(true)}
                  className="rounded-full border border-[#d8ccb5]/80 bg-[#fff9ef]/84 p-2 transition-colors hover:bg-[#fff7e8]"
                  aria-label="收起日志面板"
                  title="收起日志面板"
                >
                  <ChevronRight className="h-4 w-4 text-[#6f8159]" />
                </button>
              </div>
            </div>

            <ScrollArea
              className="min-h-0 flex-1"
              viewportRef={eventsContainerRef}
              onViewportScroll={(e) => {
                const el = e.currentTarget
                const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                stickToBottomRef.current = distanceToBottom < 16
              }}
              viewportClassName="pr-2 scroll-smooth"
            >
              <div className="space-y-2">
                {events.map((event, index) => (
                  <div
                    key={`${event.text}-${index}`}
                    className="relative rounded-lg border border-[#e4d9c3]/70 bg-white/42 px-2.5 py-1.5 text-xs leading-5 text-[#5a674c]"
                  >
                    {event.time && (
                      <div className="mb-0.5 text-[10px] leading-4 text-[#a09882]">{dayjs(event.time).format('HH:mm:ss')}</div>
                    )}
                    <div className="break-words">{event.text}</div>
                  </div>
                ))}
                {status === 'running' && (
                  <div className="flex items-center gap-2 rounded-lg border border-[#e4d9c3]/70 bg-white/42 px-2.5 py-1.5 text-xs text-[#a09882]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Growing...</span>
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>
        )}
      </div>

      {/* ── Bottom progress bar ── */}
      <div className="relative z-20 border-t border-[#d8ccb5]/65 bg-[#fff7e7]/88 px-6 py-2 backdrop-blur-sm">
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-[#617350]">
            <span>{status === 'completed' ? '已完成' : status === 'failed' ? '已中断' : '成长进度'}</span>
            <span className="font-semibold">{displayProgress}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full border border-[#d8ccb5]/80 bg-[#fff9ef]/75 shadow-[inset_0_1px_2px_rgba(74,58,40,0.12)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#9ecf8a_0%,#6f9f59_52%,#4f7b3f_100%)] bg-[length:200%_100%] transition-[width] duration-500"
              style={{ width: `${Math.max(2, displayProgress)}%`, animation: 'gen-shimmer-move 2.8s linear infinite' }}
            />
          </div>

          {status === 'failed' && (
            <div className="mt-2 rounded-lg border border-[#d7b5ae] bg-[#fbf1ee] px-4 py-3 text-sm text-[#93564f]">
              <div>{error || '生成失败，请重试。'}</div>
              {failedPages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {failedPages.map((page) => (
                    <span
                      key={page}
                      className="rounded-md border border-[#d7b5ae]/70 bg-[#fff8f4]/75 px-2 py-1 text-xs text-[#8e5a53]"
                    >
                      {page}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                {!fullyGenerated && hasGeneratedPages && (
                  <Button
                    size="sm"
                    onClick={() => navigate(`/sessions/${id}/generating`, {
                      replace: true,
                      state: {
                        retry: true,
                        rerunToken: Date.now(),
                      },
                    })}
                  >
                    继续生成剩余页
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/sessions', { replace: true })}
                >
                  返回会话列表
                </Button>
                {!hasGeneratedPages && (
                  <Button
                    size="sm"
                    onClick={() => navigate(`/sessions/${id}/generating`, {
                      replace: true,
                      state: {
                        initialPrompt: state?.initialPrompt,
                        retry: false,
                        rerunToken: Date.now(),
                      },
                    })}
                  >
                    重新生成
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
