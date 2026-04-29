import { BrowserWindow } from 'electron'
import log from 'electron-log/main.js'
import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'

export type PptxTextMeasureInput = {
  id: string
  text: string
  width: number
  height: number
  fontSize: number
  lineHeight: number
  fontFamily: string
  fontWeight?: string
  fontStyle?: string
  letterSpacing?: number
}

export type PptxTextMeasureResult = {
  id: string
  overflow: boolean
  measuredHeight: number
  lineCount: number
  naturalWidth: number
  suggestedFontSize: number
  suggestedLineHeight: number
  suggestedHeight: number
}

const require = createRequire(import.meta.url)
const pretextModuleUrl = pathToFileURL(require.resolve('@chenglou/pretext')).toString()

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const escapeFontFamily = (value: string): string => {
  const firstFont = String(value || 'Arial')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .find(Boolean)
  const font = firstFont || 'Arial'
  return /^[a-z0-9 -]+$/i.test(font) ? font : `"${font.replace(/"/g, '\\"')}"`
}

export class PptxTextValidator {
  private win: BrowserWindow | null = null
  private disabled = false
  private tempDir: string | null = null

  async measure(inputs: PptxTextMeasureInput[]): Promise<PptxTextMeasureResult[]> {
    const validInputs = inputs.filter(
      (input) =>
        input.text.trim() &&
        Number.isFinite(input.width) &&
        Number.isFinite(input.height) &&
        input.width > 8 &&
        input.height > 8
    )
    if (this.disabled || validInputs.length === 0) return []
    try {
      const win = await this.ensureWindow()
      const payload = validInputs.map((input) => ({
        ...input,
        width: clamp(input.width, 1, 3200),
        height: clamp(input.height, 1, 3200),
        fontSize: clamp(input.fontSize, 6, 96),
        lineHeight: clamp(input.lineHeight || input.fontSize * 1.2, 8, 140),
        letterSpacing: clamp(input.letterSpacing || 0, -10, 80),
        fontFamily: escapeFontFamily(input.fontFamily),
        fontWeight: String(input.fontWeight || '400'),
        fontStyle: String(input.fontStyle || 'normal')
      }))
      const script = `
(async () => {
  const mod = await (window.__ohmypptPretextModule ||= import(${JSON.stringify(pretextModuleUrl)}));
  const inputs = ${JSON.stringify(payload)};
  const measureOne = (input) => {
    const minFontSize = Math.max(8, input.fontSize * 0.72);
    const measureAt = (fontSize) => {
      const lineHeight = Math.max(fontSize * 1.08, input.lineHeight * (fontSize / input.fontSize));
      const font = [input.fontStyle, input.fontWeight, fontSize.toFixed(2) + 'px', input.fontFamily].filter(Boolean).join(' ');
      const prepared = mod.prepareWithSegments(input.text, font, {
        whiteSpace: 'pre-wrap',
        letterSpacing: input.letterSpacing
      });
      const layout = mod.layout(prepared, Math.max(1, input.width), lineHeight);
      const naturalWidth = mod.measureNaturalWidth(prepared);
      return { fontSize, lineHeight, height: layout.height, lineCount: layout.lineCount, naturalWidth };
    };

    let best = measureAt(input.fontSize);
    const hasOverflow = (result) => result.height > input.height + 1;

    if (hasOverflow(best)) {
      for (let fontSize = input.fontSize - 1; fontSize >= minFontSize; fontSize -= 1) {
        const next = measureAt(fontSize);
        best = next;
        if (!hasOverflow(next)) break;
      }
    }

    const overflow = hasOverflow(best);
    return {
      id: input.id,
      overflow,
      measuredHeight: Number(best.height.toFixed(2)),
      lineCount: best.lineCount,
      naturalWidth: Number(best.naturalWidth.toFixed(2)),
      suggestedFontSize: Number(best.fontSize.toFixed(2)),
      suggestedLineHeight: Number(best.lineHeight.toFixed(2)),
      suggestedHeight: Number(Math.max(input.height, best.height + 4).toFixed(2))
    };
  };
  return inputs.map(measureOne);
})()
`
      const result = await win.webContents.executeJavaScript(script, true)
      return Array.isArray(result) ? (result as PptxTextMeasureResult[]) : []
    } catch (error) {
      this.disabled = true
      log.warn('[pptx:import] pretext text validator disabled', {
        message: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  }

  close(): void {
    const win = this.win
    this.win = null
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.stop()
      } catch {
        // ignore renderer teardown races
      }
      win.close()
      setTimeout(() => {
        if (!win.isDestroyed()) win.destroy()
      }, 1000).unref?.()
    }
    if (this.tempDir) {
      fs.promises.rm(this.tempDir, { recursive: true, force: true }).catch(() => {})
      this.tempDir = null
    }
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: false,
      width: 800,
      height: 600,
      backgroundColor: '#ffffff',
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: true
      }
    })
    this.tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohmyppt-pretext-'))
    const htmlPath = path.join(this.tempDir, 'index.html')
    await fs.promises.writeFile(htmlPath, '<!doctype html><html><body></body></html>', 'utf-8')
    await win.loadURL(pathToFileURL(htmlPath).toString())
    this.win = win
    return win
  }
}
