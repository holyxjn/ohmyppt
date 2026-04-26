import { app, shell, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main.js'
import { PPTDatabase } from './db/database'
import { AgentManager } from './agent'
import { setupIPC } from './ipc'
import { setStyleDb } from './utils/style-skills'

let mainWindow: BrowserWindow | null = null
let db: PPTDatabase | null = null
let agentManager: AgentManager | null = null
let isShuttingDown = false

const APP_NAME = 'OhMyPPT'
const DEFAULT_WINDOW_WIDTH = 1100
const DEFAULT_WINDOW_HEIGHT = 800
const BASE_MIN_WIDTH = 980
const BASE_MIN_HEIGHT = 620
const TITLEBAR_HEIGHT = 48
const TITLEBAR_BACKGROUND = '#f4eddf'
const TITLEBAR_SYMBOL_COLOR = '#5d6b4d'

function resolveWindowBounds() {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const maxInitialWidth = Math.max(900, workArea.width - 72)
  const maxInitialHeight = Math.max(620, workArea.height - 88)
  const minWidth = Math.min(BASE_MIN_WIDTH, maxInitialWidth)
  const minHeight = Math.min(BASE_MIN_HEIGHT, maxInitialHeight)
  const width = Math.max(minWidth, Math.min(DEFAULT_WINDOW_WIDTH, maxInitialWidth))
  const height = Math.max(minHeight, Math.min(DEFAULT_WINDOW_HEIGHT, maxInitialHeight))

  return {
    width,
    height,
    minWidth,
    minHeight,
    workArea,
  }
}

function configureLogging(): void {
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 20 * 1024 * 1024
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

  if (is.dev) {
    const logDir = join(process.cwd(), 'logs')
    mkdirSync(logDir, { recursive: true })
    log.transports.file.resolvePathFn = () => join(logDir, 'main.log')
  } else {
    log.transports.file.resolvePathFn = () => {
      const date = new Date()
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return join(
        app.getPath('userData'),
        'ohmyppt_logs',
        `${year}-${month}`,
        `${year}-${month}-${day}-v${app.getVersion()}.log`
      )
    }
  }

  log.initialize()
  log.info('[app] logger initialized', {
    env: is.dev ? 'dev' : 'prod',
    version: app.getVersion(),
    file: log.transports.file.getFile().path,
  })
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const preloadPath = join(__dirname, '../preload/index.mjs')
  const windowBounds = resolveWindowBounds()

  const iconPath = join(__dirname, '../../build/icons/512x512.png')
  if (isMac && existsSync(iconPath)) {
    try { app.dock?.setIcon(iconPath); } catch { /* ignore */ }
  }
  const window = new BrowserWindow({
    title: APP_NAME,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: windowBounds.minWidth,
    minHeight: windowBounds.minHeight,
    center: true,
    show: false,
    backgroundColor: TITLEBAR_BACKGROUND,
    autoHideMenuBar: true,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    // Keep native controls and only let the renderer draw the visual titlebar.
    ...(isMac
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 14, y: Math.round((TITLEBAR_HEIGHT - 14) / 2) }
        }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: TITLEBAR_BACKGROUND,
            symbolColor: TITLEBAR_SYMBOL_COLOR,
            height: TITLEBAR_HEIGHT
          }
        }),
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: true
    }
  })
  mainWindow = window

  log.info('[app] creating window', {
    preloadPath,
    contextIsolation: true,
    sandbox: false,
    window: {
      width: windowBounds.width,
      height: windowBounds.height,
      minWidth: windowBounds.minWidth,
      minHeight: windowBounds.minHeight,
      workArea: windowBounds.workArea,
      titlebarHeight: TITLEBAR_HEIGHT,
      titleBarStyle: isMac ? 'hidden' : 'hidden+overlay',
    },
  })

  window.on('ready-to-show', () => {
    window.show()
    // if (is.dev) {
    //   window.webContents.openDevTools({ mode: 'detach' })
    // }
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(async () => {
  configureLogging()

  const dbPath = is.dev ? join(process.cwd(), 'ohmyppt.dev.db') : undefined
  db = new PPTDatabase(dbPath)
  await db.init()
  setStyleDb(db)
  log.info('[app] database initialized', {
    env: is.dev ? 'dev' : 'prod',
    dbPath: dbPath || 'userData/ohmyppt.db',
  })
  agentManager = new AgentManager(db)

  const mainWindow = createWindow()

  if (mainWindow && db && agentManager) {
    setupIPC(mainWindow, db, agentManager)
  }

  electronApp.setAppUserModelId('com.ohmyppt.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS 上点 X 只会关闭窗口，不应关闭数据库连接；
  // 否则后续 activate 重开窗口时会命中 CLIENT_CLOSED。
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (isShuttingDown) return
  isShuttingDown = true
  if (db) {
    void db.close().catch((error) => {
      log.warn('[app] failed to close database on before-quit', {
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }
})

export { mainWindow, db, agentManager }
