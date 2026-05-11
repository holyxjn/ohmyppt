import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  CircleAlert,
  Home,
  ChevronRight,
  ChevronLeft
} from 'lucide-react'
import { ipc } from '@renderer/lib/ipc'
import type { GenerateChunkEvent } from '@shared/generation.js'
import { Button } from '../components/ui/Button'
import { ScrollArea } from '../components/ui/ScrollArea'
import videoSrc from '../assets/images/video.mp4'
import dayjs from 'dayjs'
import { getEditorGate, type EditorGate } from '../lib/sessionMetadata'
import { useLang, type Lang } from '../i18n'

type LocationState = {
  initialPrompt?: string
  retry?: boolean
  rerunToken?: number
}

const NEUTRAL_GENERATION_PROMPT =
  'Create a clear first draft that can be previewed directly. Determine the content language from the session topic, outline, detailed brief, and source documents; do not infer it from the application UI language or this instruction language.'

const extractFailedPages = (message: string | null): string[] => {
  if (!message) return []
  const matches = Array.from(message.matchAll(/\S+\([^)]+\)/g))
  return matches.map((match) => match[0]).slice(0, 12)
}

const isSessionFullyGenerated = (gate: EditorGate): boolean =>
  gate.generatedCount >= gate.totalCount && gate.failedCount === 0

const LOG_AUTO_SCROLL_THRESHOLD = 48

const isNearLogBottom = (el: HTMLDivElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= LOG_AUTO_SCROLL_THRESHOLD

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const eventDedupeKey = (value: string): string =>
  compactWhitespace(value)
    .replace(/\s*·\s*\d{1,3}%$/g, '')
    .replace(/\s+\d{1,3}%$/g, '')

const hasTechnicalDetail = (message: string): boolean => {
  const compact = compactWhitespace(message)
  if (compact.length > 160 || message.includes('\n')) return true
  return /Received tool input did not match expected schema|Error invoking tool|ZodError|expected schema|HTML 验证失败|HTML 落盘校验失败|页面编辑结果验证失败|ERR_FILE_NOT_FOUND|Failed to load URL|文件不存在|at\s+\S+.*:\d+:\d+|<html|<!doctype|data-ppt/i.test(
    compact
  ) || /HTML 末尾|未闭合标签|开闭标签数量不一致|内容可能被截断|<\/?[a-z][\w:-]*(\s|>|\/>)/i.test(compact)
}

const friendlyText = (lang: Lang, zh: string, en: string): string => (lang === 'en' ? en : zh)

const friendlyProgressDetail = (detail: string, lang: Lang): string => {
  const compact = compactWhitespace(detail)
  if (!compact) return ''
  const pageMatch = compact.match(/(\d+)\/(\d+)\s*(页|pages?)/i)
  if (pageMatch) {
    return friendlyText(
      lang,
      `已处理 ${pageMatch[1]}/${pageMatch[2]} 页`,
      `Processed ${pageMatch[1]}/${pageMatch[2]} pages`
    )
  }
  if (/没有检测到.*变化|without any detected page changes|no page changes/i.test(compact)) {
    return friendlyText(lang, '刚才没有写入变化，正在换一种方式重试。', 'No changes were written yet; trying another way.')
  }
  if (/HTML 末尾|未闭合标签|开闭标签数量不一致|内容可能被截断|<\/?[a-z][\w:-]*(\s|>|\/>)/i.test(compact)) {
    return friendlyText(
      lang,
      '页面结构检查未通过，正在尝试修复。',
      'The page structure needs a fix; trying to repair it.'
    )
  }
  if (/schema|工具调用参数|tool call/i.test(compact)) {
    return friendlyText(lang, '工具参数需要修正，正在自动重试。', 'Tool arguments need a quick fix; retrying automatically.')
  }
  if (/校验|验证|validat/i.test(compact)) {
    return friendlyText(lang, '页面结构需要修正，正在自动重试。', 'The page structure needs a fix; retrying automatically.')
  }
  if (/重试|retry/i.test(compact)) {
    return friendlyText(lang, '处理中遇到问题，正在自动重试。', 'Something needs another pass; retrying automatically.')
  }
  if (/准备完成|ready/i.test(compact)) {
    return friendlyText(lang, '准备完成，开始生成页面。', 'Ready. Starting page generation.')
  }
  const pageTitleMatch = compact.match(/^page-[\w-]+\s*·\s*(.+)$/i)
  if (pageTitleMatch?.[1]) {
    const title = pageTitleMatch[1].trim()
    return friendlyText(lang, `正在处理「${title}」`, `Processing "${title}"`)
  }
  return hasTechnicalDetail(compact) ? '' : compact
}

const isFailureProgress = (label: string | undefined, detail: string): boolean =>
  /失败|failed|fail|error|错误/i.test(`${label || ''} ${detail}`)

const friendlyProgressLabel = (label: string | undefined, detail: string, lang: Lang): string => {
  const compactLabel = compactWhitespace(label || '')
  if (isFailureProgress(label, detail)) {
    return friendlyText(lang, '检查页面', 'Checking pages')
  }
  return compactLabel
}

const friendlyFailureProgressDetail = (lang: Lang): string =>
  friendlyText(
    lang,
    '页面结构检查未通过，正在尝试修复。',
    'The page structure needs a fix; trying to repair it.'
  )

const friendlyFailureMessage = (message: string | null | undefined, lang: Lang): string => {
  const compact = compactWhitespace(message || '')
  if (!compact) {
    return friendlyText(lang, '生成没有完成，请重试。', 'Generation did not finish. Please retry.')
  }
  if (/API Key|api key|provider|模型|model|timeout|timed out|ECONN|network|fetch failed/i.test(compact)) {
    return friendlyText(
      lang,
      '模型服务暂时不可用，请检查设置后重试。',
      'The model service is not available. Check settings and retry.'
    )
  }
  if (/文件不存在|ERR_FILE_NOT_FOUND|Failed to load URL|ENOENT/i.test(compact)) {
    return friendlyText(
      lang,
      '页面文件暂时不可用，请返回会话后重试。',
      'The page files are not available. Return to the session and retry.'
    )
  }
  if (/schema|tool call|工具调用参数/i.test(compact)) {
    return friendlyText(
      lang,
      '生成工具调用失败，请重试一次。',
      'The generation tool call failed. Please retry.'
    )
  }
  if (/校验|验证|validat|HTML/i.test(compact)) {
    return friendlyText(
      lang,
      '页面结果没有通过检查，请重试一次。',
      'The page result did not pass checks. Please retry.'
    )
  }
  return hasTechnicalDetail(compact)
    ? friendlyText(lang, '生成没有完成，请重试。', 'Generation did not finish. Please retry.')
    : compact
}

const progressLine = (args: {
  label?: string
  detail?: string
}): string => {
  const label = compactWhitespace(args.label || '')
  const detail = compactWhitespace(args.detail || '')
  const parts = [label, detail].filter(Boolean)
  return parts.join(' · ')
}

export function SessionGeneratingPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { lang, t } = useLang()
  const state = (location.state as LocationState | null) || null
  const startedSessionRef = useRef<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const terminalStatusRef = useRef<'completed' | 'failed' | null>(null)
  const eventsContainerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const shouldAutoScrollRef = useRef(true)
  const currentStageRef = useRef<string>('preflight')
  const lastProgressLogRef = useRef<{ stage: string; progress: number; time: number } | null>(null)

  const [status, setStatus] = useState<'running' | 'completed' | 'failed'>('running')
  const [progress, setProgress] = useState(0)
  const [events, setEvents] = useState<Array<{ text: string; time?: string }>>([
    { text: t('generating.created'), time: new Date().toISOString() }
  ])
  const [error, setError] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState<string>(t('generating.currentSession'))
  const [totalPages, setTotalPages] = useState<number>(1)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [editorGate, setEditorGate] = useState<EditorGate>(() => getEditorGate(null))
  const [currentStage, setCurrentStage] = useState<string>('preflight')
  const [completedPageCount, setCompletedPageCount] = useState<number>(0)

  const appendEvent = (line: string, timestamp?: string): void => {
    const el = eventsContainerRef.current
    shouldAutoScrollRef.current = !el || stickToBottomRef.current || isNearLogBottom(el)
    setEvents((prev) => {
      const normalized = line.replace(/\s+/g, ' ').trim()
      if (!normalized) return prev
      const normalizedKey = eventDedupeKey(normalized)
      const normalizedPrev = prev.map((item) => eventDedupeKey(item.text))
      const previousKey = normalizedPrev[normalizedPrev.length - 1]
      if (previousKey === normalizedKey || previousKey?.startsWith(`${normalizedKey} · `)) {
        return prev
      }
      if (previousKey && normalizedKey.startsWith(`${previousKey} · `)) {
        const next = [...prev.slice(0, -1), { text: line, time: timestamp }]
        return next.length > 300 ? next.slice(next.length - 300) : next
      }
      const recent = normalizedPrev.slice(-4)
      if (
        recent.some(
          (item) =>
            item === normalizedKey ||
            item.startsWith(`${normalizedKey} · `) ||
            normalizedKey.startsWith(`${item} · `)
        )
      ) {
        return prev
      }
      const next = [...prev, { text: line, time: timestamp }]
      return next.length > 300 ? next.slice(next.length - 300) : next
    })
  }

  const scrollLogToBottom = (): void => {
    const el = eventsContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    window.requestAnimationFrame(() => {
      const next = eventsContainerRef.current
      if (!next) return
      next.scrollTop = next.scrollHeight
      stickToBottomRef.current = true
    })
  }

  useLayoutEffect(() => {
    if (panelCollapsed || !shouldAutoScrollRef.current) return
    scrollLogToBottom()
  }, [events, panelCollapsed, status])

  useEffect(() => {
    if (!id) {
      navigate('/sessions')
      return
    }
    let active = true

    const initialPrompt = state?.initialPrompt?.trim() || NEUTRAL_GENERATION_PROMPT
    const explicitRerun = typeof state?.rerunToken === 'number'
    if (state?.retry || explicitRerun) {
      startedSessionRef.current = null
      activeRunIdRef.current = null
      terminalStatusRef.current = null
      window.setTimeout(() => {
        setStatus('running')
        setProgress(0)
        setError(null)
        setEvents([{ text: t('generating.created'), time: new Date().toISOString() }])
      }, 0)
    }

    const applyChunk = (event: GenerateChunkEvent, options?: { replay?: boolean }): void => {
      if (import.meta.env.DEV) {
        console.debug('[generate:chunk] received', event)
      }
      if (event.payload.sessionId && event.payload.sessionId !== id) return
      const incomingRunId = event.payload.runId
      if (activeRunIdRef.current && incomingRunId && incomingRunId !== activeRunIdRef.current)
        return
      if (!options?.replay && !activeRunIdRef.current && incomingRunId) {
        activeRunIdRef.current = incomingRunId
      }
      const applyProgress = (
        next: number | undefined,
        options?: { allowTerminal?: boolean }
      ): void => {
        const hardMax = options?.allowTerminal ? 100 : 90
        const value = Math.max(0, Math.min(hardMax, Math.round(next ?? 0)))
        setProgress((prev) => Math.max(prev, value))
      }
      const applyTotalPages = (next: number | undefined): void => {
        if (!Number.isFinite(next)) return
        const pages = Math.max(1, Math.floor(next as number))
        setTotalPages((prev) => Math.max(prev, pages))
      }
      if (event.type === 'stage_started' || event.type === 'stage_progress') {
        applyProgress(event.payload.progress)
        applyTotalPages(event.payload.totalPages)
        const prevStage = currentStageRef.current
        const stageChanged = event.payload.stage && event.payload.stage !== prevStage
        if (event.payload.stage) {
          currentStageRef.current = event.payload.stage
          setCurrentStage(event.payload.stage)
        }
        const now = Date.now()
        const previousLog = lastProgressLogRef.current
        const progressValue = Math.round(event.payload.progress ?? 0)
        const shouldLogProgress =
          stageChanged ||
          event.type === 'stage_started' ||
          !previousLog ||
          progressValue - previousLog.progress >= 6 ||
          now - previousLog.time >= 8000
        if (shouldLogProgress) {
          lastProgressLogRef.current = {
            stage: event.payload.stage || currentStageRef.current,
            progress: progressValue,
            time: now
          }
          appendEvent(
            progressLine({
              label: event.payload.label
            }),
            event.payload.timestamp
          )
        }
        return
      }

      if (event.type === 'llm_status') {
        applyProgress(event.payload.progress)
        applyTotalPages(event.payload.totalPages)

        // Track stage changes (compare before updating)
        const prevStage = currentStageRef.current
        const stageChanged = event.payload.stage && event.payload.stage !== prevStage
        if (event.payload.stage) {
          currentStageRef.current = event.payload.stage
          setCurrentStage(event.payload.stage)
        }

        // Parse page completion count from detail
        const detail = event.payload.detail || ''
        const failureProgress = isFailureProgress(event.payload.label, detail)
        const friendlyDetail = failureProgress
          ? friendlyFailureProgressDetail(lang)
          : friendlyProgressDetail(detail, lang)
        const pageMatch = detail.match(/(\d+)\/(\d+)\s*(页|pages?)/)
        if (pageMatch) {
          setCompletedPageCount(parseInt(pageMatch[1], 10))
        }

        // Filter: only append meaningful events to log
        const hasPageCompletion = Boolean(pageMatch)
        const now = Date.now()
        const previousLog = lastProgressLogRef.current
        const progressValue = Math.round(event.payload.progress ?? 0)
        const progressMoved =
          !previousLog ||
          progressValue - previousLog.progress >= 6 ||
          (event.payload.stage || currentStageRef.current) !== previousLog.stage
        const progressTimedOut = !previousLog || now - previousLog.time >= 8000
        const isValidationOrError =
          Boolean(friendlyDetail) ||
          detail.includes('校验') || detail.includes('validat') ||
          detail.includes('失败') || detail.includes('fail') ||
          detail.includes('重试') || detail.includes('retry') ||
          detail.includes('准备完成') || detail.includes('ready')
        const isRetryLabel =
          event.payload.label?.includes('重试') || event.payload.label?.includes('retry')
        const friendlyLabel = friendlyProgressLabel(event.payload.label, detail, lang)

        if (
          stageChanged ||
          hasPageCompletion ||
          isValidationOrError ||
          isRetryLabel ||
          progressMoved ||
          progressTimedOut
        ) {
          lastProgressLogRef.current = {
            stage: event.payload.stage || currentStageRef.current,
            progress: progressValue,
            time: now
          }
          appendEvent(
            progressLine({
              label: friendlyLabel,
              detail: friendlyDetail
            }),
            event.payload.timestamp
          )
        }
        return
      }

      if (event.type === 'page_generated' || event.type === 'page_updated') {
        applyProgress(event.payload.progress)
        applyTotalPages(Math.max(event.payload.totalPages ?? 0, event.payload.pageNumber))
        appendEvent(
          `${event.payload.label} · ${t('generating.pageDetail', { pageNumber: event.payload.pageNumber, title: event.payload.title })}`,
          event.payload.timestamp
        )
        return
      }

      if (event.type === 'assistant_message') {
        return
      }

      if (event.type === 'run_completed') {
        if (!active) return
        terminalStatusRef.current = 'completed'
        setStatus('completed')
        applyProgress(100, { allowTerminal: true })
        applyTotalPages(event.payload.totalPages)
        appendEvent(t('generating.completed'), event.payload.timestamp)
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
        setError(friendlyFailureMessage(event.payload.message, lang))
        appendEvent(t('generating.failedRetryOrBack'), event.payload.timestamp)
        void ipc
          .getSession(id)
          .then(({ session }) => {
            if (!active) return
            setEditorGate(
              getEditorGate(
                session as {
                  status?: string
                  page_count?: number | null
                  metadata?: string | null
                } | null
              )
            )
          })
          .catch(() => {})
      }
    }

    const unsubscribe = ipc.onGenerateChunk((event) => applyChunk(event))

    const startRun = (): void => {
      const runKey = `${id}:${state?.retry ? 'retry' : 'generate'}:${state?.rerunToken ?? 'initial'}`
      if (startedSessionRef.current === runKey) return
      startedSessionRef.current = runKey
      setStatus('running')
      setError(null)
      terminalStatusRef.current = null
      if (import.meta.env.DEV) {
        console.info('[generate:start] request', {
          sessionId: id,
          retry: Boolean(state?.retry),
          hasInitialPrompt: Boolean(initialPrompt)
        })
      }
      const request = state?.retry
        ? ipc.retryFailedPages({
            sessionId: id,
            userMessage: state.initialPrompt?.trim() || undefined
          })
        : ipc.startGenerate({
            sessionId: id,
            userMessage: initialPrompt,
            type: 'deck'
          })
      void request
        .then((result) => {
          if (result?.runId) {
            activeRunIdRef.current = result.runId
          }
          if (result?.alreadyRunning) {
            appendEvent(t('generating.stillRunning'), new Date().toISOString())
            return
          }
          if (import.meta.env.DEV) {
            console.info('[generate:start] promise resolved', { sessionId: id })
          }
          if (!active || terminalStatusRef.current) return
          appendEvent(t('generating.started'), new Date().toISOString())
        })
        .catch((e) => {
          if (import.meta.env.DEV) {
            console.error('[generate:start] promise rejected', {
              sessionId: id,
              message: e instanceof Error ? e.message : String(e)
            })
          }
          if (!active) return
          const rawMessage = e instanceof Error ? e.message : t('generating.failed')
          const message = friendlyFailureMessage(rawMessage, lang)
          appendEvent(t('generating.failedRetryOrBack'), new Date().toISOString())
          setStatus('failed')
          setError(message)
          void ipc
            .getSession(id)
            .then(({ session }) => {
              if (!active) return
              setEditorGate(
                getEditorGate(
                  session as {
                    status?: string
                    page_count?: number | null
                    metadata?: string | null
                  } | null
                )
              )
            })
            .catch(() => {})
        })
    }

    void Promise.all([ipc.getSession(id), ipc.getGenerateState(id).catch(() => null)])
      .then(([{ session }, runState]) => {
        if (!active) return
        const snapshot = (session || {}) as {
          status?: string
          title?: string | null
          page_count?: number | null
          metadata?: string | null
        }
        const currentStatus = snapshot.status || 'active'
        const snapshotGate = getEditorGate(snapshot)
        setEditorGate(snapshotGate)
        if (snapshot.title && snapshot.title.trim().length > 0) {
          setSessionTitle(snapshot.title)
        }
        if (typeof snapshot.page_count === 'number' && snapshot.page_count > 0) {
          setTotalPages(Math.floor(snapshot.page_count))
        }

        const hasManualStartIntent = Boolean(
          state?.retry ||
          explicitRerun ||
          (state?.initialPrompt && state.initialPrompt.trim().length > 0)
        )

        if (runState) {
          const shouldHydrateFromSnapshot = !hasManualStartIntent || runState.hasActiveRun

          if (runState.hasActiveRun && runState.runId) {
            activeRunIdRef.current = runState.runId
          }
          if (
            shouldHydrateFromSnapshot &&
            typeof runState.totalPages === 'number' &&
            runState.totalPages > 0
          ) {
            setTotalPages((prev) => Math.max(prev, Math.floor(runState.totalPages)))
          }
          if (
            shouldHydrateFromSnapshot &&
            typeof runState.progress === 'number' &&
            runState.progress > 0
          ) {
            const safeProgress =
              runState.status === 'completed'
                ? Math.min(100, Math.floor(runState.progress))
                : Math.min(90, Math.floor(runState.progress))
            setProgress((prev) => Math.max(prev, safeProgress))
          }
          if (shouldHydrateFromSnapshot && runState.status === 'failed' && runState.error) {
            setError(friendlyFailureMessage(runState.error, lang))
          }
          if (
            shouldHydrateFromSnapshot &&
            Array.isArray(runState.events) &&
            runState.events.length > 0
          ) {
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
            setError(
              runState.error
                ? friendlyFailureMessage(runState.error, lang)
                : t('generating.previousFailed')
            )
            appendEvent(t('generating.keptFailed'), new Date().toISOString())
            return
          }
          if (runState.hasActiveRun) {
            setStatus('running')
            appendEvent(t('generating.resumed'), new Date().toISOString())
            return
          }
        }

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
            setError(
              t('generating.incompleteSome', {
                generated: snapshotGate.generatedCount,
                total: snapshotGate.totalCount
              })
            )
            appendEvent(t('generating.continueRemainingEvent'), new Date().toISOString())
          } else {
            setError(t('generating.incompleteNone', { total: snapshotGate.totalCount }))
            appendEvent(t('generating.noValidPagesEvent'), new Date().toISOString())
          }
          return
        }
        if (
          currentStatus === 'failed' &&
          !state?.retry &&
          !explicitRerun &&
          !hasManualStartIntent
        ) {
          setStatus('failed')
          setError(t('generating.previousFailed'))
          appendEvent(t('generating.keptFailed'), new Date().toISOString())
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
  }, [id, navigate, location.key, state?.initialPrompt, state?.retry, state?.rerunToken, lang, t])

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
            aria-label={t('generating.backHome')}
            title={t('generating.backHome')}
          >
            <Home className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-[#7d8b63]">
              {t('generating.eyebrow')}
            </p>
            <p className="mt-1 organic-serif text-2xl font-semibold leading-none">
              {t('generating.title')}
            </p>
            <p className="mt-2 max-w-[380px] truncate text-xs text-[#7b8963]">{sessionTitle}</p>
          </div>
        </div>

        {/* ── Right-side log panel ── */}
        {panelCollapsed ? (
          <button
            type="button"
            onClick={() => {
              shouldAutoScrollRef.current = true
              stickToBottomRef.current = true
              setPanelCollapsed(false)
            }}
            className="app-no-drag absolute right-6 top-[calc(var(--app-titlebar-height)+12px)] z-30 inline-flex items-center gap-2 rounded-xl border border-[#d8ccb5]/75 bg-[#fff9ef]/86 px-3 py-2 text-[#5f7550] shadow-[0_14px_30px_rgba(83,73,57,0.24)] backdrop-blur-sm transition-colors hover:bg-[#fff6e8]"
            aria-label={t('generating.expandLog')}
            title={t('generating.expandLog')}
          >
            {status === 'running' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#6f8159]" />
            )}
            {status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
            {status === 'failed' && <CircleAlert className="h-3.5 w-3.5 text-[#b86966]" />}
            <ChevronLeft className="h-4 w-4" />
            <span className="text-xs font-semibold tracking-wide">{t('generating.logTitle')}</span>
          </button>
        ) : (
          <aside className="app-no-drag absolute bottom-6 right-6 top-[calc(var(--app-titlebar-height)+12px)] z-20 flex w-[320px] min-h-0 flex-col rounded-xl border border-[#d8ccb5]/70 bg-[#fff9ef]/74 p-3 shadow-[0_20px_46px_rgba(88,74,54,0.26)] backdrop-blur-xl">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-[#495a3b]">
                <Sparkles className="h-4 w-4 text-[#6f8159]" />
                {t('generating.logTitle')}
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-[#d8ccb5]/80 bg-[#fff9ef]/84 p-2">
                  {status === 'running' && (
                    <Loader2 className="h-4 w-4 animate-spin text-[#6f8159]" />
                  )}
                  {status === 'completed' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {status === 'failed' && <CircleAlert className="h-4 w-4 text-[#b86966]" />}
                </div>
                <button
                  type="button"
                  onClick={() => setPanelCollapsed(true)}
                  className="rounded-full border border-[#d8ccb5]/80 bg-[#fff9ef]/84 p-2 transition-colors hover:bg-[#fff7e8]"
                  aria-label={t('generating.collapseLog')}
                  title={t('generating.collapseLog')}
                >
                  <ChevronRight className="h-4 w-4 text-[#6f8159]" />
                </button>
              </div>
            </div>

            <ScrollArea
              className="min-h-0 flex-1 rounded-lg border border-[#e4d9c3]/55 bg-[#fffaf1]/36"
              viewportRef={eventsContainerRef}
              onViewportScroll={(e) => {
                const el = e.currentTarget
                stickToBottomRef.current = isNearLogBottom(el)
                if (stickToBottomRef.current) {
                  shouldAutoScrollRef.current = true
                }
              }}
              viewportClassName="px-2 py-2"
            >
              <div className="space-y-2">
                {events.map((event, index) => (
                  <div
                    key={`${event.text}-${index}`}
                    className="relative rounded-lg border border-[#e4d9c3]/70 bg-white/42 px-2.5 py-1.5 text-xs leading-5 text-[#5a674c]"
                  >
                    {event.time && (
                      <div className="mb-0.5 text-[10px] leading-4 text-[#a09882]">
                        {dayjs(event.time).format('HH:mm:ss')}
                      </div>
                    )}
                    <div className="break-words">{event.text}</div>
                  </div>
                ))}
                {status === 'running' && (
                  <div className="flex items-center gap-2 rounded-lg border border-[#e4d9c3]/70 bg-white/42 px-2.5 py-1.5 text-xs text-[#a09882]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{t('generating.growing')}</span>
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
            <div className="flex items-center gap-2">
              {status === 'completed' && (
                <span>{t('sessions.statusComplete')}</span>
              )}
              {status === 'failed' && (
                <span>{t('generating.interrupted')}</span>
              )}
              {/* Step indicator */}
              {(() => {
                const stages = ['preflight', 'planning', 'rendering', 'validation'] as const
                const stageLabels: Record<string, string> = {
                  preflight: t('generating.stages.preflight'),
                  planning: t('generating.stages.planning'),
                  rendering: t('generating.stages.rendering'),
                  validation: t('generating.stages.validation')
                }
                const activeIndex = stages.indexOf(currentStage as typeof stages[number])
                const renderStage = stages[2]
                return (
                  <div className="flex items-center gap-1 text-[10px]">
                    {stages.map((stage, i) => {
                      const isActive = i === activeIndex
                      const isDone = i < activeIndex || status === 'completed'
                      const isRenderingActive = stage === renderStage && isActive
                      return (
                        <span key={stage} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className={`mx-0.5 h-px w-3 ${isDone ? 'bg-[#6f9f59]' : 'bg-[#c8bfb0]'}`} />
                          )}
                          <span
                            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium ${
                              isDone
                                ? 'text-[#4f7b3f]'
                                : isActive
                                  ? 'bg-[#eef5e8] text-[#3e5a30]'
                                  : 'text-[#a09882]'
                            }`}
                          >
                            {isDone && !isActive && (
                              <CheckCircle2 className="h-3 w-3" />
                            )}
                            {isActive && (
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#4f7b3f]" />
                            )}
                            {isRenderingActive && completedPageCount > 0
                              ? `${stageLabels[stage]} ${completedPageCount}/${totalPages}`
                              : stageLabels[stage]}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
            <div className="flex items-center gap-2">
              {status === 'running' && (
                <button
                  type="button"
                  onClick={() => {
                    if (!id) return
                    void ipc.cancelGenerate(id)
                  }}
                  className="inline-flex h-6 cursor-pointer items-center rounded-md border border-[#d7b5ae]/80 bg-[#fbf1ee]/80 px-2 text-[10px] font-semibold text-[#93564f] transition-colors hover:bg-[#f5e0db] hover:text-[#7a3e38]"
                >
                  {t('generating.cancelGeneration')}
                </button>
              )}
              <span className="font-semibold">{displayProgress}%</span>
            </div>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full border border-[#d8ccb5]/80 bg-[#fff9ef]/75 shadow-[inset_0_1px_2px_rgba(74,58,40,0.12)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#9ecf8a_0%,#6f9f59_52%,#4f7b3f_100%)] bg-[length:200%_100%] transition-[width] duration-500"
              style={{
                width: `${Math.max(2, displayProgress)}%`,
                animation: 'gen-shimmer-move 2.8s linear infinite'
              }}
            />
          </div>

          {status === 'failed' && (
            <div className="mt-2 rounded-lg border border-[#d7b5ae] bg-[#fbf1ee] px-4 py-3 text-sm text-[#93564f]">
              <div>{error || t('generating.failedRetry')}</div>
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
                    onClick={() =>
                      navigate(`/sessions/${id}/generating`, {
                        replace: true,
                        state: {
                          retry: true,
                          rerunToken: Date.now()
                        }
                      })
                    }
                  >
                    {t('generating.continueRemaining')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/sessions', { replace: true })}
                >
                  {t('generating.backToSessions')}
                </Button>
                {!hasGeneratedPages && (
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate(`/sessions/${id}/generating`, {
                        replace: true,
                        state: {
                          initialPrompt: state?.initialPrompt,
                          retry: false,
                          rerunToken: Date.now()
                        }
                      })
                    }
                  >
                    {t('generating.regenerate')}
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
