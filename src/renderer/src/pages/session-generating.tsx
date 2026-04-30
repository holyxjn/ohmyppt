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
import { useLang } from '../i18n'

type LocationState = {
  initialPrompt?: string
  retry?: boolean
  rerunToken?: number
}

const NOISY_REPEATED_PATTERNS = [
  /^模型正在构思第\s*\d+\s*页/,
  /^正在写入第\s*\d+\s*页/,
  /^验证完成状态/,
  /^当前页面已填充/,
]

const NEUTRAL_GENERATION_PROMPT =
  'Create a clear first draft that can be previewed directly. Determine the content language from the session topic, outline, detailed brief, and source documents; do not infer it from the application UI language or this instruction language.'

type UiLang = 'zh' | 'en'

const LOG_TEXT_MAP: Record<string, Record<UiLang, string>> = {
  正在理解你的创意目标: {
    zh: '正在理解你的创意目标',
    en: 'Understanding your creative goal',
  },
  正在梳理演示结构: {
    zh: '正在梳理演示结构',
    en: 'Organizing presentation structure',
  },
  本地画布已就绪: {
    zh: '本地画布已就绪',
    en: 'Local canvas is ready',
  },
  '结构规划完成，开始填充内容': {
    zh: '结构规划完成，开始填充内容',
    en: 'Structure planned. Filling content',
  },
  正在整理演示大纲: {
    zh: '正在整理演示大纲',
    en: 'Organizing presentation outline',
  },
  大纲草案已生成: {
    zh: '大纲草案已生成',
    en: 'Outline draft generated',
  },
  正在整理成可执行页面计划: {
    zh: '正在整理成可执行页面计划',
    en: 'Converting outline into an executable page plan',
  },
  正在统一视觉方向: {
    zh: '正在统一视觉方向',
    en: 'Unifying visual direction',
  },
  正在生成独立设计契约: {
    zh: '正在生成独立设计契约',
    en: 'Generating design contract',
  },
  视觉方向已统一: {
    zh: '视觉方向已统一',
    en: 'Visual direction unified',
  },
  创意引擎已启动: {
    zh: '创意引擎已启动',
    en: 'Creative engine started',
  },
  正在加速生成流程: {
    zh: '正在加速生成流程',
    en: 'Accelerating generation flow',
  },
  读取会话上下文: {
    zh: '读取会话上下文',
    en: 'Reading session context',
  },
  正在写入对应页文件: {
    zh: '正在写入对应页文件',
    en: 'Writing the target page file',
  },
  '正在写入对应 page 文件': {
    zh: '正在写入对应 page 文件',
    en: 'Writing the target page file',
  },
  验证完成状态: {
    zh: '验证完成状态',
    en: 'Verifying completion',
  },
  正在检查所有页面文件是否已填充: {
    zh: '正在检查所有页面文件是否已填充',
    en: 'Checking whether all page files are filled',
  },
  正在检查所有页文件是否已填充: {
    zh: '正在检查所有页文件是否已填充',
    en: 'Checking whether all page files are filled',
  },
  所有页面已填充: {
    zh: '所有页面已填充',
    en: 'All pages filled',
  },
  当前页面已填充: {
    zh: '当前页面已填充',
    en: 'Current page filled',
  },
  生成完成: {
    zh: '生成完成',
    en: 'Generation completed',
  },
  修改完成: {
    zh: '修改完成',
    en: 'Edit completed',
  },
  正在继续生成未完成页面: {
    zh: '正在继续生成未完成页面',
    en: 'Continuing unfinished pages',
  },
  我发现了几个结构提醒: {
    zh: '我发现了几个结构提醒',
    en: 'A few structure warnings were found',
  },
  页面结构检查通过: {
    zh: '页面结构检查通过',
    en: 'Page structure check passed',
  },
  我还想再优化几页内容: {
    zh: '我还想再优化几页内容',
    en: 'Some pages could still be improved',
  },
  有几页暂时没长好: {
    zh: '有几页暂时没长好',
    en: 'Some pages need another pass',
  },
  还有几页需要继续修: {
    zh: '还有几页需要继续修',
    en: 'A few pages still need fixing',
  },
  还有页面没有恢复: {
    zh: '还有页面没有恢复',
    en: 'Some pages were not recovered',
  },
}

const translateExactLogText = (value: string, lang: UiLang): string => {
  const trimmed = value.trim()
  for (const [source, translations] of Object.entries(LOG_TEXT_MAP)) {
    if (trimmed === source || trimmed === translations.zh || trimmed === translations.en) {
      return translations[lang]
    }
  }
  return value
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const localizeLogText = (value: string | undefined, lang: UiLang): string => {
  if (!value) return ''
  let text = translateExactLogText(value, lang)
  for (const [source, translated] of Object.entries(LOG_TEXT_MAP)) {
    text = text
      .replace(new RegExp(escapeRegExp(source), 'g'), translated[lang])
      .replace(new RegExp(escapeRegExp(translated.en), 'g'), translated[lang])
      .replace(new RegExp(escapeRegExp(translated.zh), 'g'), translated[lang])
  }
  if (lang === 'en') {
    text = text
      .replace(/正在生成\s*(\d+)\s*页的标题与要点/g, 'Generating titles and key points for $1 pages')
      .replace(/已创建 index\.html 与\s*(\d+)\s*个页面骨架/g, 'Created index.html and $1 page shells')
      .replace(/已完成规划并更新目录标题，设计契约：(.+)/g, 'Planning completed and index titles updated. Design contract: $1')
      .replace(/开始生成第\s*(\d+)\s*页/g, 'Starting page $1')
      .replace(/模型正在构思第\s*(\d+)\s*页/g, 'Drafting page $1')
      .replace(/正在写入第\s*(\d+)\s*页/g, 'Writing page $1')
      .replace(/第\s*(\d+)\s*页已生成/g, 'Page $1 generated')
      .replace(/第\s*(\d+)\s*页完成/g, 'Page $1 completed')
      .replace(/第\s*(\d+)\s*页已完成：/g, 'Page $1 completed: ')
      .replace(/第\s*(\d+)\s*页重试中（(\d+)\/(\d+)）/g, 'Retrying page $1 ($2/$3)')
      .replace(/第\s*(\d+)\s*页已更新/g, 'Page $1 updated')
      .replace(/第\s*(\d+)\s*页已创建/g, 'Page $1 created')
      .replace(/更新单页\s*(page-\d+)/gi, 'Updating $1')
      .replace(/更新\s*(page-\d+)/gi, 'Updating $1')
      .replace(/验证失败\s*(page-\d+)/gi, 'Validation failed for $1')
      .replace(/外链资源校验失败\s*(page-\d+)/gi, 'External resource check failed for $1')
  } else {
    text = text
      .replace(/Generating titles and key points for (\d+) pages/g, '正在生成 $1 页的标题与要点')
      .replace(/Created index\.html and (\d+) page shells/g, '已创建 index.html 与 $1 个页面骨架')
      .replace(/Planning completed and index titles updated\. Design contract: (.+)/g, '已完成规划并更新目录标题，设计契约：$1')
      .replace(/Starting page (\d+)/g, '开始生成第 $1 页')
      .replace(/Drafting page (\d+)/g, '模型正在构思第 $1 页')
      .replace(/Writing page (\d+)/g, '正在写入第 $1 页')
      .replace(/Page (\d+) generated/g, '第 $1 页已生成')
      .replace(/Page (\d+) completed: /g, '第 $1 页已完成：')
      .replace(/Page (\d+) completed/g, '第 $1 页完成')
      .replace(/Retrying page (\d+) \((\d+)\/(\d+)\)/g, '第 $1 页重试中（$2/$3）')
      .replace(/Page (\d+) updated/g, '第 $1 页已更新')
      .replace(/Page (\d+) created/g, '第 $1 页已创建')
      .replace(/Updating\s*(page-\d+)/gi, '更新 $1')
      .replace(/Validation failed for\s*(page-\d+)/gi, '验证失败 $1')
      .replace(/External resource check failed for\s*(page-\d+)/gi, '外链资源校验失败 $1')
  }
  return translateExactLogText(text, lang)
}

const extractFailedPages = (message: string | null): string[] => {
  if (!message) return []
  const matches = Array.from(message.matchAll(/page-\d+\([^)]+\)/g))
  return matches.map((match) => match[0]).slice(0, 12)
}

const isSessionFullyGenerated = (gate: EditorGate): boolean =>
  gate.generatedCount >= gate.totalCount && gate.failedCount === 0

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

  const [status, setStatus] = useState<'running' | 'completed' | 'failed'>('running')
  const [progress, setProgress] = useState(0)
  const [events, setEvents] = useState<Array<{ text: string; time?: string }>>([
    { text: t('generating.created'), time: new Date().toISOString() },
  ])
  const [error, setError] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState<string>(t('generating.currentSession'))
  const [, setTotalPages] = useState<number>(1)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [editorGate, setEditorGate] = useState<EditorGate>(() => getEditorGate(null))

  const appendEvent = (line: string, timestamp?: string): void => {
    setEvents((prev) => {
      const localizedLine = localizeLogText(line, lang)
      const normalized = localizedLine.replace(/\s+/g, ' ').trim()
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
      const next = [...prev, { text: localizedLine, time: timestamp }]
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
      NEUTRAL_GENERATION_PROMPT
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
      if (activeRunIdRef.current && incomingRunId && incomingRunId !== activeRunIdRef.current) return
      if (!options?.replay && !activeRunIdRef.current && incomingRunId) {
        activeRunIdRef.current = incomingRunId
      }
      const applyProgress = (next: number | undefined, options?: { allowTerminal?: boolean }): void => {
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
        const stageLabel =
          event.payload.stage === 'preflight'
            ? t('generating.stages.preflight')
            : event.payload.stage === 'planning'
              ? t('generating.stages.planning')
              : event.payload.stage === 'rendering'
                ? t('generating.stages.rendering')
                : event.payload.stage
        appendEvent(`${stageLabel} · ${event.payload.label}`, event.payload.timestamp)
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
        appendEvent(t('generating.pageDone', { pageNumber: event.payload.pageNumber, title: event.payload.title }), event.payload.timestamp)
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
        setError(event.payload.message)
        appendEvent(t('generating.failedRetryOrBack'), event.payload.timestamp)
        void ipc.getSession(id).then(({ session }) => {
          if (!active) return
          setEditorGate(getEditorGate(session as { status?: string; page_count?: number | null; metadata?: string | null } | null))
        }).catch(() => {})
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
        console.info('[generate:start] request', { sessionId: id, retry: Boolean(state?.retry), hasInitialPrompt: Boolean(initialPrompt) })
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
              message: e instanceof Error ? e.message : String(e),
            })
          }
          if (!active) return
          const message = e instanceof Error ? e.message : t('generating.failed')
          appendEvent(t('generating.failedRetryOrBack'), new Date().toISOString())
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
            setError(runState.error || t('generating.previousFailed'))
            appendEvent(t('generating.keptFailed'), new Date().toISOString())
            return
          }
          if (runState.hasActiveRun) {
            setStatus('running')
            appendEvent(t('generating.resumed'), new Date().toISOString())
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
            setError(t('generating.incompleteSome', { generated: snapshotGate.generatedCount, total: snapshotGate.totalCount }))
            appendEvent(t('generating.continueRemainingEvent'), new Date().toISOString())
          } else {
            setError(t('generating.incompleteNone', { total: snapshotGate.totalCount }))
            appendEvent(t('generating.noValidPagesEvent'), new Date().toISOString())
          }
          return
        }
        if (currentStatus === 'failed' && !state?.retry && !explicitRerun && !hasManualStartIntent) {
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
            <p className="text-xs uppercase tracking-[0.2em] text-[#7d8b63]">{t('generating.eyebrow')}</p>
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
            onClick={() => setPanelCollapsed(false)}
            className="app-no-drag absolute right-6 top-[calc(var(--app-titlebar-height)+12px)] z-30 inline-flex items-center gap-2 rounded-xl border border-[#d8ccb5]/75 bg-[#fff9ef]/86 px-3 py-2 text-[#5f7550] shadow-[0_14px_30px_rgba(83,73,57,0.24)] backdrop-blur-sm transition-colors hover:bg-[#fff6e8]"
            aria-label={t('generating.expandLog')}
            title={t('generating.expandLog')}
          >
            {status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#6f8159]" />}
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
                  {status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-[#6f8159]" />}
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
            <span>
              {status === 'completed'
                ? t('sessions.statusComplete')
                : status === 'failed'
                  ? t('generating.interrupted')
                  : t('generating.progress')}
            </span>
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
                    onClick={() => navigate(`/sessions/${id}/generating`, {
                      replace: true,
                      state: {
                        retry: true,
                        rerunToken: Date.now(),
                      },
                    })}
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
                    onClick={() => navigate(`/sessions/${id}/generating`, {
                      replace: true,
                      state: {
                        initialPrompt: state?.initialPrompt,
                        retry: false,
                        rerunToken: Date.now(),
                      },
                    })}
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
