import {
  ChevronDown,
  ExternalLink,
  FileDown,
  FileSearch,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  Presentation
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import { useT } from '@renderer/i18n'

const toolbarButtonClass =
  'h-7 rounded-[8px] border-transparent bg-[#e8e0d0]/72 px-2.5 text-[11px] text-[#3e4a32] shadow-[0_4px_10px_rgba(86,72,53,0.08)] hover:bg-[#d4e4c1]/78'
const toolbarIconClass = 'mr-1.5 h-3.5 w-3.5'
const dropdownItemIconClass = 'mr-2 h-3.5 w-3.5 text-[#6b7280]'

export function SessionToolbar({
  hasPages,
  historyDisabled = false,
  canPreview,
  canRevealFile,
  onExportPdf,
  onExportPng,
  onExportPptx,
  onOpenHistory,
  onOpenPreview,
  onRevealFile
}: {
  hasPages: boolean
  historyDisabled?: boolean
  canPreview: boolean
  canRevealFile: boolean
  onExportPdf: () => void
  onExportPng: () => void
  onExportPptx: (options?: { exportImages?: boolean; exportShapes?: boolean }) => void
  onOpenHistory: () => void
  onOpenPreview: () => void
  onRevealFile: () => void
}): React.JSX.Element {
  const t = useT()
  const isExportingPdf = useSessionDetailUiStore((state) => state.isExportingPdf)
  const isExportingPng = useSessionDetailUiStore((state) => state.isExportingPng)
  const isExportingPptx = useSessionDetailUiStore((state) => state.isExportingPptx)

  return (
    <>
      {hasPages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onOpenHistory}
          disabled={historyDisabled || isExportingPdf || isExportingPng || isExportingPptx}
        >
          <History className={toolbarIconClass} />
          {t('sessionDetail.history')}
        </Button>
      )}
      {hasPages && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(toolbarButtonClass, 'gap-1')}
              disabled={isExportingPptx}
            >
              {isExportingPptx ? (
                <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
              ) : (
                <Presentation className={toolbarIconClass} />
              )}
              {t('sessionDetail.exportPptx')}
              {!isExportingPptx && <ChevronDown className="h-3 w-3" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[14rem]">
            <DropdownMenuItem onClick={() => onExportPptx({ exportImages: true, exportShapes: true })}>
              <Presentation className={dropdownItemIconClass} />
              {t('sessionDetail.exportPptxDefault')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExportPptx({ exportImages: false, exportShapes: false })}>
              <FileText className={dropdownItemIconClass} />
              {t('sessionDetail.exportPptxTextOnly')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExportPptx({ exportImages: true, exportShapes: false })}>
              <ImageIcon className={dropdownItemIconClass} />
              {t('sessionDetail.exportPptxWithImages')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {hasPages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onExportPng}
          disabled={isExportingPng}
        >
          {isExportingPng ? (
            <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
          ) : (
            <ImageIcon className={toolbarIconClass} />
          )}
          {t('sessionDetail.exportPng')}
        </Button>
      )}
      {hasPages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onExportPdf}
          disabled={isExportingPdf}
        >
          {isExportingPdf ? (
            <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
          ) : (
            <FileDown className={toolbarIconClass} />
          )}
          {t('sessionDetail.exportPdf')}
        </Button>
      )}
      {canPreview && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onOpenPreview}
        >
          <ExternalLink className={toolbarIconClass} />
          {t('sessionDetail.preview')}
        </Button>
      )}
      {canRevealFile && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onRevealFile}
        >
          <FileSearch className={toolbarIconClass} />
          {t('sessionDetail.revealFile')}
        </Button>
      )}
    </>
  )
}
