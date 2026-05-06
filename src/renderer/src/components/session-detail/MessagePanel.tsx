import { useEffect, useRef } from 'react'
import { FileText, Image as ImageIcon, Loader2, Plus, Send, StopCircle, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import { Textarea } from '../ui/Input'
import { Progress } from '../ui/Progress'
import { ScrollArea } from '../ui/ScrollArea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { MessageBubble } from './MessageBubble'
import { useT } from '@renderer/i18n'

type PanelProgress = {
  label?: string
  progress: number
}

export function MessagePanel({
  selectedPageExists,
  selectedPageNumber,
  isGenerating,
  progress,
  error,
  onDropFiles,
  onChooseAssets,
  onSend,
  onCancel,
  cleanMessageContent
}: {
  selectedPageExists: boolean
  selectedPageNumber?: number | null
  isGenerating: boolean
  progress: PanelProgress | null
  error: string | null
  onDropFiles: (files: File[]) => void
  onChooseAssets: () => void
  onSend: () => void
  onCancel: () => void
  cleanMessageContent: (content: string) => string
}): React.JSX.Element {
  const t = useT()
  const messages = useSessionStore((state) => state.currentMessages)
  const chatType = useSessionDetailUiStore((state) => state.chatType)
  const input = useSessionDetailUiStore((state) => state.input)
  const selectedSelector = useSessionDetailUiStore((state) => state.selectedSelector)
  const selectorLabel = useSessionDetailUiStore((state) => state.selectorLabel)
  const elementTag = useSessionDetailUiStore((state) => state.elementTag)
  const elementText = useSessionDetailUiStore((state) => state.elementText)
  const pendingAssets = useSessionDetailUiStore((state) => state.pendingAssets)
  const assetDragActive = useSessionDetailUiStore((state) => state.assetDragActive)
  const isUploadingAssets = useSessionDetailUiStore((state) => state.isUploadingAssets)
  const setChatType = useSessionDetailUiStore((state) => state.setChatType)
  const setInput = useSessionDetailUiStore((state) => state.setInput)
  const setAssetDragActive = useSessionDetailUiStore((state) => state.setAssetDragActive)
  const removePendingAsset = useSessionDetailUiStore((state) => state.removePendingAsset)
  const clearSelectedElement = useSessionDetailUiStore((state) => state.clearSelectedElement)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isGenerating, progress?.progress])

  const contextHint =
    chatType === 'page' && selectedPageNumber
      ? t('sessionDetail.pageContext', { pageNumber: selectedPageNumber })
      : t('sessionDetail.mainContext')
  const inputPlaceholder =
    pendingAssets.length > 0
      ? t('sessionDetail.assetPlaceholder')
      : chatType === 'page'
        ? t('sessionDetail.pagePlaceholder')
        : t('sessionDetail.mainDisabledPlaceholder')
  const displayLabel = (() => {
    const raw = selectorLabel || selectedSelector || ''
    const last = raw.split(/\s+/).pop() || raw
    return last
  })()
  const selectorSummary = selectedSelector
    ? [
        displayLabel,
        elementTag ? `<${elementTag}>${elementText ? ` ${elementText}` : ''}` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const selectorTitle = selectedSelector
    ? [
        `selector: ${selectedSelector}`,
        selectorLabel && selectorLabel !== selectedSelector ? `label: ${selectorLabel}` : '',
        elementTag ? `element: <${elementTag}>` : '',
        elementText ? `text: ${elementText}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    : undefined

  return (
    <aside className="mr-3 my-3 flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-[2rem] border border-[#ded2bd]/60 bg-[#f3ecdf]/76 shadow-[0_20px_44px_rgba(74,59,42,0.13)] backdrop-blur-xl">
      <div className="relative mx-2.5 mt-2.5 overflow-hidden rounded-[1.35rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 px-3 pb-2.5 pt-3 shadow-[0_6px_16px_rgba(77,61,43,0.08)]">
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#c7d9b4]/12" />
        <div className="relative flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-[0.04em] text-[#34402c]">{t('sessionDetail.messageTitle')}</h3>
          <div className="flex items-center justify-between gap-2 text-xs text-[#6d604d]">
            <span>{t('sessionDetail.context')}</span>
            <Select
              value={chatType}
              onValueChange={(value) => setChatType(value === 'page' ? 'page' : 'main')}
            >
              <SelectTrigger className="h-8 w-[132px] rounded-full border-[#ded2bd]/70 bg-[#fffdf8]/82 px-3 py-1 text-xs text-[#3e4a32] shadow-[0_3px_8px_rgba(74,59,42,0.06)]">
                <SelectValue placeholder={t('sessionDetail.contextPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="page" disabled={!selectedPageExists}>
                  {t('sessionDetail.currentPage')}
                </SelectItem>
                <SelectItem value="main">{t('sessionDetail.mainSession')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <ScrollArea
        data-messages-container
        className="min-h-0 flex-1"
        viewportClassName="px-2.5 py-2"
      >
        {messages.length === 0 && !isGenerating ? (
          <div className="mt-24 flex min-h-full items-center justify-center text-sm text-[#7a6b56]">
            {t('sessionDetail.emptyMessages')}
          </div>
        ) : (
          <div className="flex min-h-full flex-col justify-end gap-2.5">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} cleanMessageContent={cleanMessageContent} />
            ))}

            {isGenerating && progress && (
              <div className="rounded-[1.15rem] border border-[#ded2bd]/72 bg-[#fffaf1]/82 px-3 py-2 shadow-[0_6px_14px_rgba(74,59,42,0.08)]">
                <p className="mb-2 text-sm text-[#655843]">{progress.label || t('sessionDetail.modelProcessing')}</p>
                <Progress value={progress.progress} />
              </div>
            )}

            {error && (
              <div className="rounded-[1.15rem] bg-[rgba(217,124,139,0.12)] px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      <div
        className={cn(
          'mx-2.5 mb-2.5 rounded-[1.4rem] border border-[#ded2bd]/72 bg-[#fffaf1]/84 px-2.5 pb-3 pt-2 shadow-[0_12px_24px_rgba(74,59,42,0.11)] transition-colors',
          assetDragActive && 'border-[#afc79a]/75 bg-[#f3f8ec]/88'
        )}
        onDragEnter={(event) => {
          event.preventDefault()
          if (event.dataTransfer.types.includes('Files')) setAssetDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (event.dataTransfer.types.includes('Files')) setAssetDragActive(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setAssetDragActive(false)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          onDropFiles(Array.from(event.dataTransfer.files))
        }}
      >
        {selectedSelector && (
          <div className="mb-2 flex items-center gap-2 rounded-[1rem] border border-[#ded2bd]/65 bg-[#f4ebdc]/70 px-2 py-1.5">
            <span className="shrink-0 rounded-full bg-[#dcebcf]/82 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#4f6340]">
              {t('sessionDetail.selectorBadge')}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-[#4f5f3f]">
                  {selectorSummary}
                </span>
              </TooltipTrigger>
              {selectorTitle && (
                <TooltipContent className="whitespace-pre-wrap">{selectorTitle}</TooltipContent>
              )}
            </Tooltip>
            <button
              type="button"
              onClick={clearSelectedElement}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#64735a] transition-colors hover:bg-[#d4e4c1]/85 hover:text-[#3e4a32]"
              aria-label={t('sessionDetail.clearSelector')}
              title={t('sessionDetail.clearSelector')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {chatType === 'main' && (
          <div className="mb-2 rounded-[1rem] border border-[#ded2bd]/65 bg-[#f4ebdc]/70 px-2.5 py-2 text-xs text-[#6a5c48]">
            {t('sessionDetail.mainDisabled')}
          </div>
        )}
        {pendingAssets.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingAssets.map((asset) => (
              <div
                key={asset.id}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-[#c7d9b4]/66 bg-[#e6f1dc]/76 px-2 py-1 text-[11px] text-[#405333] shadow-[0_3px_8px_rgba(93,107,77,0.06)]"
                title={`${asset.originalName}\n${asset.relativePath}`}
              >
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">
                  {asset.originalName || asset.fileName}
                </span>
                <button
                  type="button"
                  onClick={() => removePendingAsset(asset.id)}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[#657552] hover:bg-[#c8ddb2]"
                  aria-label={t('sessionDetail.removeAsset')}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          placeholder={inputPlaceholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && chatType !== 'main') {
              event.preventDefault()
              onSend()
            }
          }}
          disabled={isGenerating || chatType === 'main'}
          rows={4}
          className="min-h-[96px] resize-none rounded-[1.15rem] border border-[#ded2bd]/72 bg-[#fffdf8]/88 px-3 py-2 text-[13px] leading-5 text-[#3f4b35] shadow-[inset_0_1px_2px_rgba(74,59,42,0.05)] focus-visible:border-[#9bb98a] focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={isGenerating || isUploadingAssets || chatType === 'main'}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[38%_62%_44%_56%/55%_45%_55%_45%] border border-[#c7d9b4]/66 bg-[#e6f1dc]/80 text-[#526942] shadow-[0_4px_10px_rgba(93,107,77,0.09)] transition-colors hover:bg-[#d7e8c8] disabled:pointer-events-none disabled:opacity-45"
                  aria-label={t('sessionDetail.addAsset')}
                  title={t('sessionDetail.addAsset')}
                >
                  {isUploadingAssets ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-40">
                <DropdownMenuItem onSelect={onChooseAssets}>
                  <ImageIcon className="h-4 w-4" />
                  {t('sessionDetail.chooseImage')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <FileText className="h-4 w-4" />
                  {t('sessionDetail.chooseFileSoon')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-[#6d604d]">
              {contextHint}
            </div>
          </div>

          {isGenerating ? (
            <Button
              variant="destructive"
              onClick={onCancel}
              size="sm"
              className="shrink-0 whitespace-nowrap rounded-full px-3 text-xs shadow-[0_8px_18px_rgba(177,90,88,0.22)]"
            >
              <StopCircle className="mr-1 h-4 w-4" />
              {t('sessionDetail.stop')}
            </Button>
          ) : (
            <Button
              onClick={onSend}
              disabled={
                chatType === 'main' ||
                (!input.trim() && pendingAssets.length === 0) ||
                ((selectedSelector ? 'page' : chatType) === 'page' && !selectedPageExists)
              }
              size="sm"
              className="shrink-0 whitespace-nowrap rounded-full bg-[#5d6b4d] px-3 text-xs text-white shadow-[0_8px_18px_rgba(93,107,77,0.24)] hover:bg-[#3e4a32]"
            >
              <Send className="mr-1 h-4 w-4" />
              {t('sessionDetail.send')}
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
