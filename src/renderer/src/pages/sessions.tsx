import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/Dialog'
import { FileText, FileUp, FolderOpen, MessageSquare, Pencil, Sparkles, Trash2, X, type LucideIcon } from 'lucide-react'
import { type Session, useSessionStore } from '../store'
import { useToastStore } from '../store'
import { getEditorGate, parseSessionMetadata } from '../lib/sessionMetadata'
import { useT } from '../i18n'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'

dayjs.extend(duration)

const getSourceTag = (
  session: Session,
  labels: { pptx: string; document: string; ai: string }
): { label: string; Icon: LucideIcon; className: string } => {
  const metadata = parseSessionMetadata(session.metadata)
  const source = typeof metadata.source === 'string' ? metadata.source : ''
  if (source === 'pptx-import' || session.provider === 'import' || session.model === 'pptx-import') {
    return {
      label: labels.pptx,
      Icon: FileUp,
      className: 'border-[#bdd2e6]/80 bg-[#eef6ff] text-[#3e6685]'
    }
  }
  if (session.referenceDocumentPath || session.reference_document_path) {
    return {
      label: labels.document,
      Icon: FileText,
      className: 'border-[#cbd9b7]/80 bg-[#f3fae9] text-[#526f35]'
    }
  }
  return {
    label: labels.ai,
    Icon: Sparkles,
    className: 'border-[#e1d1b7]/80 bg-[#fff7e8] text-[#7c6a4c]'
  }
}

export function SessionsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { sessions, fetchSessions, deleteSession, updateSessionTitle } = useSessionStore()
  const { success, error } = useToastStore()
  const t = useT()
  const [renameSession, setRenameSession] = useState<Session | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])

  const sortedSessions = sessions
  const canEnterEditor = (session: {
    id: string
    status: string
    metadata: string | null
    page_count: number | null
  }): boolean => getEditorGate(session, 0.8).canEdit

  const getSessionRoute = (session: { id: string; status: string; metadata: string | null; page_count: number | null }): string =>
    canEnterEditor(session) ? `/sessions/${session.id}` : `/sessions/${session.id}/generating`

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
      error(t('sessions.titleEmpty'))
      return
    }
    if (title.length > 120) {
      error(t('sessions.titleTooLong'), { description: t('sessions.titleTooLongDescription') })
      return
    }
    setRenaming(true)
    try {
      await updateSessionTitle({ sessionId: renameSession.id, title })
      success(t('sessions.titleUpdated'))
      setRenameSession(null)
      setRenameTitle('')
    } catch (err) {
      error(t('sessions.renameFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setRenaming(false)
    }
  }

  const closeDeleteDialog = (): void => {
    if (deleting) return
    setDeleteSessionTarget(null)
  }

  const handleDeleteSession = async (): Promise<void> => {
    if (!deleteSessionTarget) return
    setDeleting(true)
    try {
      await deleteSession(deleteSessionTarget.id)
      success(t('sessions.deleted'))
      setDeleteSessionTarget(null)
    } catch (err) {
      error(t('sessions.deleteFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t('sessions.eyebrow')}</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="organic-serif text-[32px] font-semibold leading-none text-[#3e4a32]">{t('sessions.title')}</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <Button size="sm" className="min-w-[112px]" onClick={() => navigate('/')}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('sessions.newSession')}
            </Button>
          </div>
        </div>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">{t('sessions.emptyTitle')}</h3>
            <p className="mb-4 text-muted-foreground">{t('sessions.emptyDescription')}</p>
          
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {sortedSessions.map((session) => {
            const isComplete = canEnterEditor(session)
            const editorGate = getEditorGate(session)
            const hasCompletedPages = editorGate.generatedCount > 0
            const isContinuable = !isComplete && hasCompletedPages
            const statusText = isComplete
              ? t('sessions.statusComplete')
              : isContinuable
                ? t('sessions.statusContinuable')
                : t('sessions.statusRegenerate')
            const actionText = isComplete
              ? t('sessions.actionEnter')
              : isContinuable
                ? t('sessions.actionContinue')
                : t('sessions.actionRegenerate')
            const sourceTag = getSourceTag(session, {
              pptx: t('sessions.sourcePptx'),
              document: t('sessions.sourceDocument'),
              ai: t('sessions.sourceAi')
            })
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
                      title={t('sessions.editTitle')}
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
                        setDeleteSessionTarget(session)
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
                    {t('sessions.pagesCount', { generated: editorGate.generatedCount, total: editorGate.totalCount })}
                  </span>
                  {session.generation_duration_sec ? (
                    <span className="rounded-lg border border-[#d5cfc5]/60 bg-[#f9f6f1] px-2 py-1 text-[#6b6560]">
                      {(() => {
                        const d = dayjs.duration(session.generation_duration_sec!, 'second')
                        const m = Math.floor(d.asMinutes())
                        const s = d.seconds()
                        return m > 0 ? `${m}m ${s}s` : `${s}s`
                      })()}
                    </span>
                  ) : null}
                  <span className="rounded-lg border border-[#d5cfc5]/60 bg-[#f9f6f1] px-2 py-1 text-[#6b6560]">
                    {dayjs.unix(session.updated_at).format('YYYY/MM/DD HH:mm')}
                  </span>
                  {!isComplete && editorGate.failedCount > 0 && (
                    <span className="rounded-lg border border-[#d7b5ae]/70 bg-[#fff7f2]/80 px-2 py-1 text-[#93564f]">
                      {t('sessions.failedCount', { count: editorGate.failedCount })}
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
                <h2 className="text-base font-semibold text-[#3e4a32]">{t('sessions.editTitle')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('sessions.renameDescription')}
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
                placeholder={t('sessions.renamePlaceholder')}
                onChange={(event) => setRenameTitle(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={closeRenameDialog} disabled={renaming}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={renaming}>
                  {renaming ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      <Dialog open={Boolean(deleteSessionTarget)} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>{t('sessions.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('sessions.deleteConfirmDescription', { title: deleteSessionTarget?.title || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={closeDeleteDialog} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={() => void handleDeleteSession()} disabled={deleting}>
              {deleting ? t('common.saving') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
