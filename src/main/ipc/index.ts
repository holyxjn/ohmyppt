import type { BrowserWindow } from 'electron'
import type { PPTDatabase } from '../db/database'
import type { AgentManager } from '../agent'
import { createIpcContext } from './context'
import { createGenerationService } from './generation-flow'
import { registerSessionHandlers } from './session-handlers'
import { registerAssetHandlers } from './assets-handlers'
import { registerGenerationHandlers } from './generation-handlers'
import { registerExportHandlers } from './export-handlers'
import { registerStyleHandlers } from './style-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerPreviewHandlers } from './preview-handlers'
import { registerFileHandlers } from './file-handlers'
import { registerDragEditorHandlers } from './drag-editor-handlers'

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
  registerDragEditorHandlers(context)
}
