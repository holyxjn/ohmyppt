import {
  ExternalLink,
  FileDown,
  FileSearch,
  Image as ImageIcon,
  Loader2,
  Presentation,
  Sparkles
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import { Button } from '../ui/Button'

const toolbarButtonClass =
  'h-7 rounded-full border-transparent bg-[#e8e0d0]/72 px-2.5 text-[11px] text-[#3e4a32] shadow-[0_4px_10px_rgba(86,72,53,0.08)] hover:bg-[#d4e4c1]/78'
const toolbarIconClass = 'mr-1.5 h-3.5 w-3.5'

export function SessionToolbar({
  hasPages,
  canPreview,
  canRevealFile,
  onExportPdf,
  onExportPng,
  onExportPptx,
  onOpenPreview,
  onRevealFile
}: {
  hasPages: boolean
  canPreview: boolean
  canRevealFile: boolean
  onExportPdf: () => void
  onExportPng: () => void
  onExportPptx: () => void
  onOpenPreview: () => void
  onRevealFile: () => void
}): React.JSX.Element {
  const consoleOpen = useSessionDetailUiStore((state) => state.consoleOpen)
  const isExportingPdf = useSessionDetailUiStore((state) => state.isExportingPdf)
  const isExportingPng = useSessionDetailUiStore((state) => state.isExportingPng)
  const isExportingPptx = useSessionDetailUiStore((state) => state.isExportingPptx)
  const setConsoleOpen = useSessionDetailUiStore((state) => state.setConsoleOpen)

  return (
    <>
      {hasPages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onExportPptx}
          disabled={isExportingPptx}
        >
          {isExportingPptx ? (
            <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
          ) : (
            <Presentation className={toolbarIconClass} />
          )}
          导出 PPTX
        </Button>
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
          导出 PNG
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
          导出 PDF
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
          预览
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
          查看文件
        </Button>
      )}
      <button
        type="button"
        onClick={() => setConsoleOpen((open) => !open)}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-[38%_62%_44%_56%/55%_45%_55%_45%] cursor-pointer transition-colors',
          consoleOpen
            ? 'bg-[#d4e4c1]/86 text-[#486034] shadow-[0_5px_12px_rgba(93,107,77,0.12)]'
            : 'text-[#5d6b4d] hover:bg-[#e8e0d0]/72 hover:text-[#3e4a32]'
        )}
        aria-label={consoleOpen ? '收起消息面板' : '展开消息面板'}
        title={consoleOpen ? '收起消息面板' : '展开消息面板'}
        aria-pressed={consoleOpen}
      >
        <Sparkles className={cn('h-3.5 w-3.5', consoleOpen ? 'text-[#5e7d3e]' : '')} />
      </button>
    </>
  )
}
