import type { BrowserWindow } from 'electron'
import type { PPTDatabase } from '../db/database'
import type { AgentManager } from '../agent'
import { createIpcContext } from './context'
import { createGenerationService } from './engine/generation-flow'
import { registerSessionHandlers } from './session/session-handlers'
import { registerAssetHandlers } from './io/assets-handlers'
import { registerGenerationHandlers } from './engine/generation-handlers'
import { registerExportHandlers } from './io/export-handlers'
import { registerStyleHandlers } from './config/style-handlers'
import { registerSettingsHandlers } from './config/settings-handlers'
import { registerPreviewHandlers } from './session/preview-handlers'
import { registerFileHandlers } from './io/file-handlers'
import { registerDragEditorHandlers } from './editor/drag-editor-handlers'
import { registerTextEditorHandlers } from './editor/text-editor-handlers'
import { registerElementAnchorHandlers } from './editor/element-anchor-handlers'
import { registerDocumentParseHandlers } from './io/document-parse-handlers'
import { registerPptxImportHandlers } from './io/pptx-import-handlers'

export function setupIPC(
  mainWindow: BrowserWindow,
  db: PPTDatabase,
  agentManager: AgentManager
): void {
  const context = createIpcContext(mainWindow, db, agentManager)
  const generationService = createGenerationService(context)

  registerSessionHandlers(context)
  registerAssetHandlers(context)
  registerGenerationHandlers(context, generationService)
  registerExportHandlers(context)
  registerStyleHandlers(context)
  registerSettingsHandlers(context)
  registerPreviewHandlers(context)
  registerFileHandlers(context)
  registerElementAnchorHandlers(context)
  registerDragEditorHandlers(context)
  registerTextEditorHandlers(context)
  registerDocumentParseHandlers(context)
  registerPptxImportHandlers(context)
}
