import PptxGenJS from 'pptxgenjs'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'

export type HtmlToPptxTextAlign = 'left' | 'center' | 'right' | 'justify'

export interface HtmlToPptxTextBox {
  text: string
  x: number
  y: number
  w: number
  h: number
  fontSize: number
  fontFace?: string
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  align?: HtmlToPptxTextAlign
  opacity?: number
  rotate?: number
  lineSpacing?: number
  charSpacing?: number
  wrap?: boolean
}

export type HtmlToPptxShapeType = 'rect' | 'roundRect' | 'ellipse'

export interface HtmlToPptxBorder {
  color: string
  widthPt: number
  transparency?: number
  dash?: 'solid' | 'dash'
}

export interface HtmlToPptxShape {
  x: number
  y: number
  w: number
  h: number
  fill?: string
  transparency?: number
  radius?: number
  border?: HtmlToPptxBorder
  shapeType?: HtmlToPptxShapeType
  rotate?: number
}

export interface HtmlToPptxImage {
  dataUri: string
  mimeType: string
  x: number
  y: number
  w: number
  h: number
  alt?: string
  rotate?: number
}

export interface HtmlToPptxSlide {
  title?: string
  backgroundColor?: string
  backgroundImage?: HtmlToPptxImage
  texts: HtmlToPptxTextBox[]
  shapes?: HtmlToPptxShape[]
  images?: HtmlToPptxImage[]
}

export interface HtmlToPptxDocument {
  title: string
  author?: string
  slides: HtmlToPptxSlide[]
}

export interface HtmlToPptxExtractOptions {
  pageWidthPx: number
  pageHeightPx: number
  slideWidthIn?: number
  slideHeightIn?: number
  maxTextChars?: number
  maxTextBoxes?: number
  maxShapes?: number
  maxImages?: number
  maxImageBytes?: number
}

export interface HtmlToPptxExtractedSlide {
  backgroundColor?: string
  texts: HtmlToPptxTextBox[]
  shapes: HtmlToPptxShape[]
  images: HtmlToPptxImage[]
}

const DEFAULT_SLIDE_WIDTH = 13.333
const DEFAULT_SLIDE_HEIGHT = 7.5
const DEFAULT_MAX_TEXT_CHARS = 1000
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_EXPORT_FONT_SIZE_PT = 144
const require = createRequire(import.meta.url)
const PRETEXT_MODULE_URL = pathToFileURL(require.resolve('@chenglou/pretext')).toString()

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const normalizeHexColor = (value: string | undefined, fallback = '111827'): string => {
  if (!value) return fallback
  const trimmed = value.trim().replace(/^#/, '').toUpperCase()
  if (/^[0-9A-F]{3}$/.test(trimmed)) {
    return trimmed
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
  }
  return /^[0-9A-F]{6}$/.test(trimmed) ? trimmed : fallback
}

const sanitizeFontFace = (value: string | undefined): string => {
  const font = String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .find(Boolean)
  return font || 'Aptos'
}

const normalizeText = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .trim()

const normalizePptxText = (value: string): string => {
  const lines = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
  while (lines.length > 0 && !lines[0]) lines.shift()
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop()
  return lines.join('\n')
}

const hasCjkText = (value: string): boolean => /[\u3400-\u9fff\uf900-\ufaff]/.test(value)

const resolveExportFontFace = (text: string, value: string | undefined): string => {
  const fontFace = sanitizeFontFace(value)
  const isSystemFontAlias =
    /^(aptos|arial|helvetica|helvetica neue|inter|system-ui|ui-sans-serif|-apple-system|blinkmacsystemfont|sf pro text|sf pro display|segoe ui|sans-serif|serif)$/i.test(
      fontFace
    )
  if (!hasCjkText(text)) return isSystemFontAlias ? 'Aptos' : fontFace
  if (isSystemFontAlias) {
    return process.platform === 'darwin' ? 'PingFang SC' : 'Microsoft YaHei'
  }
  return fontFace
}

const normalizeDataUriMime = (value: string): string => {
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp|svg\+xml));base64,/i)
  if (!match) return ''
  return match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
}

const estimateDataUriBytes = (dataUri: string): number => {
  const commaIndex = dataUri.indexOf(',')
  if (commaIndex < 0) return 0
  const base64 = dataUri.slice(commaIndex + 1).replace(/\s/g, '')
  if (!base64) return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

const buildRgbToHexScript = (): string => `
const rgbToHex = (value) => {
  const source = String(value || '').trim();
  if (!source || source === 'transparent') return '';
  if (source.startsWith('#')) {
    const raw = source.slice(1).toUpperCase();
    return raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
  }
  const match = source.match(/rgba?\\(\\s*(\\d+(?:\\.\\d+)?)(?:\\s*,\\s*|\\s+)(\\d+(?:\\.\\d+)?)(?:\\s*,\\s*|\\s+)(\\d+(?:\\.\\d+)?)(?:\\s*(?:,|\\/)\\s*(\\d+(?:\\.\\d+)?%?))?/i);
  if (!match) return '';
  const alpha = match[4] === undefined
    ? 1
    : String(match[4]).endsWith('%')
      ? Number.parseFloat(match[4]) / 100
      : Number(match[4]);
  if (alpha <= 0.02) return '';
  return [match[1], match[2], match[3]]
    .map((part) => Math.max(0, Math.min(255, Math.round(Number(part) || 0))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};
`

export const buildHtmlToPptxExtractScript = (options: HtmlToPptxExtractOptions): string => {
  const slideWidth = options.slideWidthIn ?? DEFAULT_SLIDE_WIDTH
  const slideHeight = options.slideHeightIn ?? DEFAULT_SLIDE_HEIGHT
  const maxTextBoxes = Math.max(1, Math.floor(options.maxTextBoxes ?? 80))
  const maxShapes = Math.max(0, Math.floor(options.maxShapes ?? 80))
  const maxImages = Math.max(0, Math.floor(options.maxImages ?? 40))
  const maxTextChars = Math.max(80, Math.floor(options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS))
  const maxImageBytes = Math.max(0, Math.floor(options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES))

  return `
(async () => {
  const pageWidthPx = ${JSON.stringify(options.pageWidthPx)};
  const pageHeightPx = ${JSON.stringify(options.pageHeightPx)};
  const slideWidthIn = ${JSON.stringify(slideWidth)};
  const slideHeightIn = ${JSON.stringify(slideHeight)};
  const maxTextBoxes = ${JSON.stringify(maxTextBoxes)};
  const maxShapes = ${JSON.stringify(maxShapes)};
  const maxImages = ${JSON.stringify(maxImages)};
  const maxTextChars = ${JSON.stringify(maxTextChars)};
  const maxImageDataUriLength = ${JSON.stringify(Math.ceil((maxImageBytes * 4) / 3) + 128)};
  const pretextModuleUrl = ${JSON.stringify(PRETEXT_MODULE_URL)};
  let pretext = null;
  try {
    pretext = await import(pretextModuleUrl);
  } catch (_error) {
    pretext = null;
  }
  const normalize = (value) => String(value || '')
    .replace(/\\s+/g, ' ')
    .replace(/[\\u200b-\\u200d\\ufeff]/g, '')
    .trim();
  const clampText = (value) => normalize(value).slice(0, maxTextChars);
  const normalizeLines = (value) => {
    const lines = String(value || '')
      .replace(/\\r\\n?/g, '\\n')
      .replace(/[\\u200b-\\u200d\\ufeff]/g, '')
      .split('\\n')
      .map((line) => line.replace(/[^\\S\\n]+/g, ' ').trim());
    while (lines.length > 0 && !lines[0]) lines.shift();
    while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
    return lines.join('\\n');
  };
  const clampBlockText = (value) => normalizeLines(value).slice(0, maxTextChars);
  ${buildRgbToHexScript()}

  const pageElement =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.querySelector('[data-ppt-page], [data-page], .ppt-page, .slide, .page') ||
    document.body;
  const pageRect = pageElement.getBoundingClientRect();
  const pageLeft = pageRect.left || 0;
  const pageTop = pageRect.top || 0;
  const layoutWidthPx = pageRect.width || pageWidthPx;
  const layoutHeightPx = pageRect.height || pageHeightPx;
  const pageTransformScale = pageElement instanceof HTMLElement && pageElement.offsetWidth
    ? layoutWidthPx / pageElement.offsetWidth
    : 1;
  const pxToInX = (value) => ((Number(value) || 0) - pageLeft) / layoutWidthPx * slideWidthIn;
  const pxToInY = (value) => ((Number(value) || 0) - pageTop) / layoutHeightPx * slideHeightIn;
  const sizeToInX = (value) => (Number(value) || 0) / layoutWidthPx * slideWidthIn;
  const sizeToInY = (value) => (Number(value) || 0) / layoutHeightPx * slideHeightIn;
  const pointsPerPx = Math.min(slideWidthIn / layoutWidthPx, slideHeightIn / layoutHeightPx) * 72;
  const parseAlpha = (value) => {
    const match = String(value || '').match(/rgba?\\(\\s*\\d+(?:\\.\\d+)?(?:\\s*,\\s*|\\s+)\\d+(?:\\.\\d+)?(?:\\s*,\\s*|\\s+)\\d+(?:\\.\\d+)?(?:\\s*(?:,|\\/)\\s*(\\d+(?:\\.\\d+)?%?))?/i);
    if (!match || match[1] === undefined) return 1;
    const raw = String(match[1]);
    const alpha = raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number(raw);
    return Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  };
  const transparencyFor = (color, opacity) => {
    const alpha = parseAlpha(color) * Math.max(0, Math.min(1, Number(opacity || 1)));
    return Math.round((1 - alpha) * 100);
  };
  const resolveTextPaint = (style) => {
    const textFill = style.webkitTextFillColor || style.getPropertyValue?.('-webkit-text-fill-color') || '';
    const textFillHex = rgbToHex(textFill);
    const colorSource = textFillHex ? textFill : style.color;
    const color = rgbToHex(colorSource) || rgbToHex(style.color) || '111827';
    const opacity = parseAlpha(colorSource) * Math.max(0, Math.min(1, Number(style.opacity || 1)));
    return { color, opacity };
  };
  const parseRotate = (style) => {
    if (!style.transform || style.transform === 'none') return undefined;
    const values = style.transform.match(/matrix\\(([^)]+)\\)/)?.[1]?.split(',').map((part) => Number(part.trim()));
    if (!values || values.length < 4) return undefined;
    const angle = Math.round(Math.atan2(values[1], values[0]) * 180 / Math.PI);
    return angle || undefined;
  };
  const isStyleElement = (element) =>
    ['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'FONT', 'SUB', 'SUP', 'A', 'SMALL', 'BIG', 'MARK'].includes(element.tagName);
  const safeScale = (value, fallback = 1) =>
    Number.isFinite(value) && value > 0 ? value : fallback;
  const visualScaleForElement = (element) => {
    const fallback = safeScale(pageTransformScale, 1);
    if (!(element instanceof HTMLElement)) return { x: fallback, y: fallback, avg: fallback };
    const rect = element.getBoundingClientRect();
    const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : fallback;
    const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : scaleX;
    const x = safeScale(scaleX, fallback);
    const y = safeScale(scaleY, x);
    return { x, y, avg: Math.min(x, y) };
  };
  const visualTextScaleFor = (element) => {
    let current = element instanceof HTMLElement ? element : element?.parentElement || null;
    while (current && current !== pageElement) {
      const scale = visualScaleForElement(current);
      if (Math.abs(scale.avg - 1) > 0.002) return scale.avg;
      current = current.parentElement;
    }
    return safeScale(pageTransformScale, 1);
  };

  const bodyStyle = window.getComputedStyle(pageElement);
  const htmlStyle = window.getComputedStyle(document.documentElement);
  const backgroundColor =
    rgbToHex(bodyStyle.backgroundColor) ||
    rgbToHex(htmlStyle.backgroundColor) ||
    'FFFFFF';

  const isVisible = (element, style, rect) => {
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity || '1') < 0.04) return false;
    if (rect.width < 2 || rect.height < 2) return false;
    if (rect.bottom < 0 || rect.right < 0 || rect.left > pageWidthPx || rect.top > pageHeightPx) return false;
    if (element.closest('script, style, noscript, .katex, .katex-mathml')) return false;
    return true;
  };

  const elementToBox = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      rect,
      x: pxToInX(rect.left),
      y: pxToInY(rect.top),
      w: sizeToInX(rect.width),
      h: sizeToInY(rect.height)
    };
  };

  const shapeNodes = Array.from(pageElement.querySelectorAll('section,main,article,header,footer,aside,div,figure,figcaption,table,td,th'));
  const shapes = [];
  const minShapeArea = layoutWidthPx * layoutHeightPx * 0.005;
  const firstGradientColor = (value) => {
    const source = String(value || '');
    if (!/gradient\\(/i.test(source)) return '';
    const match = source.match(/rgba?\\([^)]*\\)|#[0-9a-f]{3,8}\\b/i);
    return match ? rgbToHex(match[0]) : '';
  };
  const pushShapeFromStyle = (style, rect, fallbackBackgroundColor = backgroundColor, allowGradientFill = false) => {
    if (shapes.length >= maxShapes) return false;
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    if (rect.left < pageLeft - 2 || rect.top < pageTop - 2) return false;
    if (rect.right > pageLeft + layoutWidthPx + 2 || rect.bottom > pageTop + layoutHeightPx + 2) return false;
    const solidFill = rgbToHex(style.backgroundColor);
    const gradientFill = allowGradientFill ? firstGradientColor(style.backgroundImage) : '';
    const fill = solidFill || gradientFill;
    const borderColor = rgbToHex(style.borderColor);
    const borderWidth = Number.parseFloat(style.borderWidth || '0') || 0;
    const hasBorder = borderWidth > 0 && style.borderStyle !== 'none' && borderColor;
    const opacity = Number(style.opacity || '1');
    if ((!fill || fill === fallbackBackgroundColor) && !hasBorder) return false;
    const radius = Number.parseFloat(style.borderTopLeftRadius || style.borderRadius || '0') || 0;
    const minSide = Math.min(rect.width, rect.height);
    const shapeType =
      radius > 0 && Math.abs(rect.width - rect.height) < 1.5 && radius >= minSide / 2 - 0.5
        ? 'ellipse'
        : radius > 0
          ? 'roundRect'
          : 'rect';
    shapes.push({
      x: pxToInX(rect.left),
      y: pxToInY(rect.top),
      w: sizeToInX(rect.width),
      h: sizeToInY(rect.height),
      fill,
      transparency: fill ? transparencyFor(solidFill ? style.backgroundColor : style.opacity, opacity) : 100,
      radius,
      shapeType,
      rotate: parseRotate(style),
      border: hasBorder
        ? {
            color: borderColor,
            widthPt: borderWidth * 0.75,
            transparency: transparencyFor(style.borderColor, opacity),
            dash: style.borderStyle === 'dashed' ? 'dash' : 'solid'
          }
        : undefined
    });
    return true;
  };
  for (const element of shapeNodes) {
    if (shapes.length >= maxShapes) break;
    const style = window.getComputedStyle(element);
    const { rect, x, y, w, h } = elementToBox(element);
    if (!isVisible(element, style, rect)) continue;
    const fill = rgbToHex(style.backgroundColor);
    const borderColor = rgbToHex(style.borderColor);
    const borderWidth = Number.parseFloat(style.borderWidth || '0') || 0;
    const hasBorder = borderWidth > 0 && style.borderStyle !== 'none' && borderColor;
    const opacity = Number(style.opacity || '1');
    if ((!fill || fill === backgroundColor) && !hasBorder) continue;
    if (!hasBorder && rect.width * rect.height < minShapeArea) continue;
    if (rect.width < 24 || rect.height < 16) continue;
    pushShapeFromStyle(style, rect);
  }

  const texts = [];
  const textSeen = new Set();
  const consumedTextElements = new Set();
  const maxPreciseLineRunChars = 500;
  const isInsideConsumedTextElement = (element) => {
    for (const parent of consumedTextElements) {
      if (parent.contains(element)) return true;
    }
    return false;
  };
  const textWidthIn = (x, width, fontSizePt, text, shouldWrap = false) => {
    if (shouldWrap) return Math.max(0.12, Math.min(slideWidthIn - x, width));
    const hasCjk = /[\\u3400-\\u9fff\\uf900-\\ufaff]/.test(text);
    const factor = hasCjk ? 1.06 : 1.08;
    const padding = Math.max(0.04, Math.min(0.22, fontSizePt / 72 * 0.18));
    return Math.max(0.12, Math.min(slideWidthIn - x, width * factor + padding));
  };
  const textHeightIn = (height, fontSizePt) => {
    const padding = Math.max(0.03, Math.min(0.16, fontSizePt / 72 * 0.12));
    return Math.max(0.08, height * 1.12 + padding);
  };
  const resolveLineHeightPx = (style, fontSizePx) => {
    const lineHeight = Number.parseFloat(style.lineHeight || '');
    return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fontSizePx * 1.18;
  };
  const resolveLetterSpacingPx = (style) => {
    if (!style.letterSpacing || style.letterSpacing === 'normal') return 0;
    const letterSpacing = Number.parseFloat(style.letterSpacing);
    return Number.isFinite(letterSpacing) ? letterSpacing : 0;
  };
  const buildCanvasFont = (style, fontSizePx) => {
    const weight = Number.parseInt(style.fontWeight || '400', 10) || 400;
    const italic = style.fontStyle === 'italic' || style.fontStyle === 'oblique' ? 'italic' : '';
    const family = String(style.fontFamily || 'Aptos').split(',')[0].replace(/["']/g, '').trim() || 'Aptos';
    const familyToken = /^[a-z0-9 -]+$/i.test(family) ? family : '"' + family.replace(/"/g, '') + '"';
    return [italic, String(weight), fontSizePx.toFixed(2) + 'px', familyToken].filter(Boolean).join(' ');
  };
  const layoutTextWithPretext = (text, rect, style, element = null) => {
    if (!pretext || !text || rect.width < 4 || rect.height < 4) return null;
    if (parseRotate(style)) return null;
    const visualScale = visualTextScaleFor(element);
    const rawFontSizePx = Number.parseFloat(style.fontSize || '16') || 16;
    const fontSizePx = rawFontSizePx * visualScale;
    const lineHeightPx = resolveLineHeightPx(style, rawFontSizePx) * visualScale;
    try {
      const prepared = pretext.prepareWithSegments(text, buildCanvasFont(style, fontSizePx), {
        whiteSpace: 'pre-wrap',
        letterSpacing: resolveLetterSpacingPx(style) * visualScale
      });
      const result = pretext.layoutWithLines(prepared, Math.max(1, rect.width), lineHeightPx);
      if (!result?.lines?.length) return null;
      return {
        lineHeightPx,
        lines: result.lines
          .map((line, index) => {
            const lineText = normalize(String(line.text || ''));
            if (!lineText) return null;
            const lineWidth = Math.max(1, Math.min(rect.width, Number(line.width) || rect.width));
            let left = rect.left;
            if (style.textAlign === 'center') left += Math.max(0, (rect.width - lineWidth) / 2);
            else if (style.textAlign === 'right' || style.textAlign === 'end') left += Math.max(0, rect.width - lineWidth);
            return {
              text: lineText,
              rect: {
                left,
                top: rect.top + index * lineHeightPx,
                right: left + lineWidth,
                bottom: rect.top + (index + 1) * lineHeightPx,
                width: lineWidth,
                height: lineHeightPx
              }
            };
          })
          .filter(Boolean)
      };
    } catch (_error) {
      return null;
    }
  };
  const isVerticalWritingMode = (style) => /vertical/i.test(String(style.writingMode || ''));
  const normalizeVerticalText = (value) => {
    const source = normalize(value).replace(/\\s+/g, '');
    if (!source) return '';
    return Array.from(source).join('\\n');
  };
  const normalizeCssContent = (value, element = null) => {
    const raw = String(value || '').trim();
    if (!raw || raw === 'none' || raw === 'normal') return '';
    if (/^attr\\(/i.test(raw)) {
      const attrName = raw.match(/^attr\\(\\s*([^\\s,)]+)/i)?.[1];
      return attrName && element ? normalize(element.getAttribute?.(attrName) || '') : '';
    }
    const tokens = raw.match(/"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"|'([^'\\\\]*(?:\\\\.[^'\\\\]*)*)'/g);
    const text = (tokens && tokens.length > 0 ? tokens : [raw])
      .map((token) => token.replace(/^['"]|['"]$/g, ''))
      .join('');
    return normalize(text.replace(/\\\\([0-9a-f]{1,6})\\s?/gi, (_match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    }));
  };
  const makeTextKey = (text, rect) =>
    [text.toLowerCase(), Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)].join('|');
  const textStyleSignature = (style) => {
    const paint = resolveTextPaint(style);
    return [
      paint.color,
      Math.round(paint.opacity * 100),
      String(style.fontSize || ''),
      String(style.fontWeight || ''),
      String(style.fontStyle || ''),
      String(style.textDecorationLine || style.textDecoration || '')
    ].join('|');
  };
  const hasDistinctVisibleTextChild = (element, parentStyle) => {
    const parentSignature = textStyleSignature(parentStyle);
    const children = Array.from(element.children || []);
    for (const child of children) {
      const text = normalize(child.innerText || child.textContent);
      if (!text || child.closest?.('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml')) continue;
      const childStyle = window.getComputedStyle(child);
      const childRect = child.getBoundingClientRect();
      if (!isVisible(child, childStyle, childRect)) continue;
      if (textStyleSignature(childStyle) !== parentSignature) return true;
      if (hasDistinctVisibleTextChild(child, parentStyle)) return true;
    }
    return false;
  };
  const pushTextBox = (text, rect, parentStyle, parentElement, shouldWrap = false) => {
    if (texts.length >= maxTextBoxes) return;
    text = shouldWrap ? clampBlockText(text) : clampText(text);
    if (!text) return;
    if (!isVisible(parentElement, parentStyle, rect)) return;
    if (rect.width < 2 || rect.height < 2) return;
    const isVerticalText = isVerticalWritingMode(parentStyle);
    if (isVerticalText) {
      text = normalizeVerticalText(text);
      if (!text) return;
      shouldWrap = false;
    }
    if (shouldWrap && !isVerticalText) {
      const pretextLayout = layoutTextWithPretext(text, rect, parentStyle, parentElement);
      if (pretextLayout && pretextLayout.lines.length > 0) {
        pretextLayout.lines.forEach((line) => pushTextBox(line.text, line.rect, parentStyle, parentElement, false));
        return;
      }
    }
    const key = makeTextKey(text, rect);
    if (textSeen.has(key)) return;
    textSeen.add(key);
    const visualScale = visualTextScaleFor(parentElement);
    const rawFontSizePx = Number.parseFloat(parentStyle.fontSize || '16') || 16;
    const fontSizePx = rawFontSizePx * visualScale;
    const fontSizePt = Math.max(6, Math.min(${MAX_EXPORT_FONT_SIZE_PT}, fontSizePx * pointsPerPx));
    const fontWeight = Number.parseInt(parentStyle.fontWeight || '400', 10) || 400;
    const fontFace = String(parentStyle.fontFamily || 'Aptos').split(',')[0].replace(/["']/g, '').trim() || 'Aptos';
    const x = pxToInX(rect.left);
    const textPaint = resolveTextPaint(parentStyle);
    texts.push({
      text,
      x,
      y: pxToInY(rect.top),
      w: isVerticalText
        ? Math.max(0.12, sizeToInX(rect.width) + Math.max(0.02, fontSizePt / 72 * 0.08))
        : textWidthIn(x, sizeToInX(rect.width), fontSizePt, text, shouldWrap),
      h: isVerticalText
        ? Math.max(0.12, sizeToInY(rect.height))
        : shouldWrap
        ? Math.max(0.12, sizeToInY(rect.height) + Math.max(0.02, fontSizePt / 72 * 0.08))
        : textHeightIn(sizeToInY(rect.height), fontSizePt),
      fontSize: fontSizePt,
      fontFace,
      color: textPaint.color,
      bold: fontWeight >= 600 || /^H[1-6]$/i.test(parentElement.tagName),
      italic: parentStyle.fontStyle === 'italic' || parentStyle.fontStyle === 'oblique',
      underline: String(parentStyle.textDecoration || '').includes('underline'),
      strike: String(parentStyle.textDecoration || '').includes('line-through'),
      align: isVerticalText
        ? 'center'
        : shouldWrap
        ? parentStyle.textAlign === 'center'
          ? 'center'
          : parentStyle.textAlign === 'right' || parentStyle.textAlign === 'end'
            ? 'right'
            : parentStyle.textAlign === 'justify'
              ? 'justify'
              : 'left'
        : 'left',
      opacity: textPaint.opacity,
      rotate: parseRotate(parentStyle),
      lineSpacing: parentStyle.lineHeight && parentStyle.lineHeight !== 'normal'
        ? Math.max(fontSizePt * 1.08, (Number.parseFloat(parentStyle.lineHeight) || 0) * visualScale * pointsPerPx)
        : isVerticalText
          ? fontSizePt * 1.02
        : text.includes('\\n')
          ? fontSizePt * 1.18
          : undefined,
      charSpacing: parentStyle.letterSpacing && parentStyle.letterSpacing !== 'normal'
        ? (Number.parseFloat(parentStyle.letterSpacing) || 0) * visualScale * pointsPerPx
        : undefined,
      wrap: shouldWrap
    });
  };
  const hasNestedTextBlock = (element) =>
    Boolean(element.querySelector('h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,figcaption,div,[data-ppt-text],[data-role="title"],.title,.slide-title,.page-title,.katex'));
  const shouldExportElementText = (element, style, text) => {
    if (!text) return false;
    if (element.querySelector?.('.katex')) return false;
    if (hasNestedTextBlock(element)) return false;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'MATH'].includes(element.tagName)) return false;
    if (hasDistinctVisibleTextChild(element, style)) return false;
    const tag = element.tagName;
    if (/^H[1-6]$/.test(tag) || ['P', 'LI', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION'].includes(tag)) return true;
    if (element.matches('[data-ppt-text],[data-role="title"],.title,.slide-title,.page-title')) return true;
    const isBlockLike =
      ['block', 'flex', 'grid', 'table-cell', 'list-item'].includes(style.display) ||
      ['absolute', 'fixed'].includes(style.position);
    return isBlockLike && text.length >= 6 && text.length <= 180;
  };
  const exportBlockTextElements = () => {
    const candidates = Array.from(pageElement.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,figcaption,[data-ppt-text],[data-role="title"],.title,.slide-title,.page-title,div'
    ));
    for (const element of candidates) {
      if (texts.length >= maxTextBoxes) break;
      if (element.closest('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml')) continue;
      if (isInsideConsumedTextElement(element)) continue;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = clampBlockText(element.innerText || element.textContent);
      if (!isVisible(element, style, rect)) continue;
      if (!shouldExportElementText(element, style, text)) continue;
      const fontScale = visualTextScaleFor(element);
      const fontSizePx = (Number.parseFloat(style.fontSize || '16') || 16) * fontScale;
      const singleLine = rect.height <= fontSizePx * 1.55;
      const largeText = fontSizePx >= 28 || /^H[1-6]$/.test(element.tagName);
      const constrainedTextBlock =
        text.length >= 8 &&
        rect.width < layoutWidthPx * 0.72 &&
        !element.matches('h1,h2,.slide-title,.page-title');
      const shouldWrap = constrainedTextBlock || !(singleLine && largeText);
      if (
        shouldWrap &&
        !isVerticalWritingMode(style) &&
        text.length <= maxPreciseLineRunChars &&
        rect.width >= 4 &&
        rect.height >= 4
      ) {
        // Let the text-node walker use browser Range rects instead of re-laying text.
        continue;
      }
      pushTextBox(text, rect, style, element, shouldWrap);
      consumedTextElements.add(element);
    }
  };
  const getLineTextRuns = (node) => {
    const source = String(node.textContent || '');
    if (source.length > maxPreciseLineRunChars) return [];
    const groups = [];
    let activeGroup = null;
    for (let offset = 0; offset < source.length; offset += 1) {
      const char = source[offset];
      if (!char) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      range.detach();
      if (rect.width < 0.5 || rect.height < 0.5) {
        if (activeGroup && /\\s/.test(char)) activeGroup.text += char;
        continue;
      }
      let group = groups.find((item) => Math.abs(item.top - rect.top) < Math.max(3, rect.height * 0.3));
      if (!group) {
        group = {
          top: rect.top,
          text: '',
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom
        };
        groups.push(group);
      }
      group.text += char;
      group.left = Math.min(group.left, rect.left);
      group.right = Math.max(group.right, rect.right);
      group.bottom = Math.max(group.bottom, rect.bottom);
      activeGroup = group;
    }
    return groups
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map((group) => ({
        text: normalize(group.text),
        rect: {
          left: group.left,
          top: group.top,
          right: group.right,
          bottom: group.bottom,
          width: group.right - group.left,
          height: group.bottom - group.top
        }
      }))
      .filter((group) => group.text);
  };
  const addTextNode = (node, parentStyle, parentElement) => {
    if (texts.length >= maxTextBoxes) return;
    if (parentElement && isInsideConsumedTextElement(parentElement)) return;
    if (parentElement && parentElement.closest?.('.katex, .katex-mathml')) return;
    const text = clampText(node.textContent);
    if (!text) return;
    const range = document.createRange();
    range.selectNode(node);
    const rect = range.getBoundingClientRect();
    const lineRects = Array.from(range.getClientRects());
    range.detach();
    const fontScale = visualTextScaleFor(parentElement);
    const fontSizePx = (Number.parseFloat(parentStyle.fontSize || '16') || 16) * fontScale;
    const isBrowserWrapped = lineRects.length > 1 || rect.height > fontSizePx * 1.7;
    if (isBrowserWrapped) {
      const runs = getLineTextRuns(node);
      if (runs.length > 1) {
        runs.forEach((run) => pushTextBox(run.text, run.rect, parentStyle, parentElement, false));
        return;
      }
      pushTextBox(text, rect, parentStyle, parentElement, true);
      return;
    }
    pushTextBox(text, rect, parentStyle, parentElement, false);
  };

  const traverseText = (node, inheritedStyle, inheritedElement) => {
    if (texts.length >= maxTextBoxes) return;
    if (node.nodeType === Node.TEXT_NODE) {
      addTextNode(node, inheritedStyle, inheritedElement);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node;
    if (consumedTextElements.has(element)) return;
    if (element.closest('script, style, noscript, svg, canvas, video, iframe, .katex, .katex-mathml')) return;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (!isVisible(element, style, rect)) return;
    const isBlockLike =
      ['block', 'flex', 'grid', 'table', 'list-item'].includes(style.display) ||
      ['absolute', 'fixed', 'sticky'].includes(style.position);
    const nextStyle = isBlockLike && !isStyleElement(element) ? style : style || inheritedStyle;
    element.childNodes.forEach((child) => traverseText(child, nextStyle, element));
  };

  exportBlockTextElements();
  pageElement.childNodes.forEach((child) => {
    const style = window.getComputedStyle(pageElement);
    traverseText(child, style, pageElement);
  });

  const cssLengthToPx = (value, relative = 0, scale = 1) => {
    const raw = String(value || '').trim();
    if (!raw || raw === 'auto' || raw === 'none' || raw === 'normal') return Number.NaN;
    if (raw.endsWith('%')) return Number.parseFloat(raw) / 100 * relative;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed * scale : Number.NaN;
  };
  const pushPseudoTextBox = (text, rect, style, scale = 1) => {
    if (texts.length >= maxTextBoxes) return;
    text = clampText(text);
    if (!text) return;
    const key = makeTextKey(text + '|pseudo', rect);
    if (textSeen.has(key)) return;
    textSeen.add(key);
    const fontSizePx = (Number.parseFloat(style.fontSize || '16') || 16) * safeScale(scale, 1);
    const fontSizePt = Math.max(7, Math.min(${MAX_EXPORT_FONT_SIZE_PT}, fontSizePx * pointsPerPx * 1.06));
    const fontWeight = Number.parseInt(style.fontWeight || '400', 10) || 400;
    const fontFace = String(style.fontFamily || 'Aptos').split(',')[0].replace(/["']/g, '').trim() || 'Aptos';
    const textPaint = resolveTextPaint(style);
    const boxW = Math.max(sizeToInX(rect.width), fontSizePt / 72 * 1.2);
    const boxH = Math.max(sizeToInY(rect.height), fontSizePt / 72 * 1.2);
    texts.push({
      text,
      x: pxToInX(rect.left) + (sizeToInX(rect.width) - boxW) / 2,
      y: pxToInY(rect.top) + (sizeToInY(rect.height) - boxH) / 2,
      w: boxW,
      h: boxH,
      fontSize: fontSizePt,
      fontFace,
      color: textPaint.color,
      bold: fontWeight >= 600,
      italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
      underline: false,
      strike: false,
      align: 'center',
      opacity: textPaint.opacity,
      rotate: parseRotate(style),
      lineSpacing: fontSizePt * 1.02,
      wrap: false
    });
  };
  const pseudoRectFor = (elementRect, style, text, scale = { x: 1, y: 1, avg: 1 }) => {
    const scaleX = safeScale(scale.x, safeScale(scale.avg, 1));
    const scaleY = safeScale(scale.y, safeScale(scale.avg, scaleX));
    const textScale = safeScale(scale.avg, Math.min(scaleX, scaleY));
    const rawFontSizePx = Number.parseFloat(style.fontSize || '16') || 16;
    const fontSizePx = rawFontSizePx * textScale;
    const lineHeightPx = resolveLineHeightPx(style, rawFontSizePx) * scaleY;
    const width = cssLengthToPx(style.width, elementRect.width, scaleX);
    const height = cssLengthToPx(style.height, elementRect.height, scaleY);
    const boxWidth = Number.isFinite(width) && width > 0
      ? width
      : Math.max(4, text.length * fontSizePx * 0.72);
    const boxHeight = Number.isFinite(height) && height > 0 ? height : Math.max(4, lineHeightPx);
    const leftValue = cssLengthToPx(style.left, elementRect.width, scaleX);
    const rightValue = cssLengthToPx(style.right, elementRect.width, scaleX);
    const topValue = cssLengthToPx(style.top, elementRect.height, scaleY);
    const bottomValue = cssLengthToPx(style.bottom, elementRect.height, scaleY);
    const marginLeft = cssLengthToPx(style.marginLeft, elementRect.width, scaleX);
    const marginRight = cssLengthToPx(style.marginRight, elementRect.width, scaleX);
    const marginTop = cssLengthToPx(style.marginTop, elementRect.height, scaleY);
    const marginBottom = cssLengthToPx(style.marginBottom, elementRect.height, scaleY);
    const left = Number.isFinite(leftValue)
      ? elementRect.left + leftValue + (Number.isFinite(marginLeft) ? marginLeft : 0)
      : Number.isFinite(rightValue)
        ? elementRect.right - rightValue - boxWidth - (Number.isFinite(marginRight) ? marginRight : 0)
        : elementRect.left + (Number.isFinite(marginLeft) ? marginLeft : 0);
    const top = Number.isFinite(topValue)
      ? elementRect.top + topValue + (Number.isFinite(marginTop) ? marginTop : 0)
      : Number.isFinite(bottomValue)
        ? elementRect.bottom - bottomValue - boxHeight - (Number.isFinite(marginBottom) ? marginBottom : 0)
        : elementRect.top + (Number.isFinite(marginTop) ? marginTop : 0);
    return {
      left,
      top,
      width: boxWidth,
      height: boxHeight,
      right: left + boxWidth,
      bottom: top + boxHeight
    };
  };
  const exportPseudoElements = () => {
    const candidates = Array.from(pageElement.querySelectorAll('*'));
    for (const element of candidates) {
      if (texts.length >= maxTextBoxes && shapes.length >= maxShapes) break;
      const elementStyle = window.getComputedStyle(element);
      const elementRect = element.getBoundingClientRect();
      if (!isVisible(element, elementStyle, elementRect)) continue;
      for (const pseudo of ['::before', '::after']) {
        if (texts.length >= maxTextBoxes && shapes.length >= maxShapes) break;
        const pseudoStyle = window.getComputedStyle(element, pseudo);
        if (!pseudoStyle || pseudoStyle.display === 'none' || pseudoStyle.visibility === 'hidden') continue;
        if (Number(pseudoStyle.opacity || '1') < 0.04) continue;
        const pseudoText = normalizeCssContent(pseudoStyle.content, element);
        if (!pseudoText) continue;
        const pseudoScale = visualScaleForElement(element);
        const rect = pseudoRectFor(elementRect, pseudoStyle, pseudoText, pseudoScale);
        if (rect.width < 2 || rect.height < 2) continue;
        if (rect.right < pageLeft || rect.bottom < pageTop) continue;
        if (rect.left > pageLeft + layoutWidthPx || rect.top > pageTop + layoutHeightPx) continue;
        if (rect.width <= 96 && rect.height <= 96) {
          pushShapeFromStyle(pseudoStyle, rect, backgroundColor, true);
        }
        pushPseudoTextBox(pseudoText, rect, pseudoStyle, pseudoScale.avg);
      }
    }
  };
  exportPseudoElements();

  const canvasToDataUri = (canvas) => {
    try {
      if (!canvas.width || !canvas.height) return '';
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  };
  const blobToDataUri = async (blob) =>
    await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  const sourceToDataUri = async (source) => {
    const url = String(source || '').trim();
    if (!url) return '';
    if (/^data:image\\//i.test(url)) return url;
    try {
      const response = await fetch(url);
      if (!response.ok) return '';
      const blob = await response.blob();
      return await blobToDataUri(blob);
    } catch {
      return '';
    }
  };
  const imageToDataUri = async (img) => {
    if (!img.currentSrc && !img.src) return '';
    const sourceDataUri = await sourceToDataUri(img.currentSrc || img.src);
    if (sourceDataUri) return sourceDataUri;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      if (!canvas.width || !canvas.height) return '';
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  };
  const svgToDataUri = async (svg) => {
    try {
      const rect = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true);
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('width') && rect.width) clone.setAttribute('width', String(Math.round(rect.width)));
      if (!clone.getAttribute('height') && rect.height) clone.setAttribute('height', String(Math.round(rect.height)));
      const serialized = new XMLSerializer().serializeToString(clone);
      return await blobToDataUri(new Blob([serialized], { type: 'image/svg+xml' }));
    } catch {
      return '';
    }
  };

  const images = [];
  const imageNodes = Array.from(pageElement.querySelectorAll('img,canvas,svg'));
  for (const element of imageNodes) {
    if (images.length >= maxImages) break;
    const style = window.getComputedStyle(element);
    const { rect, x, y, w, h } = elementToBox(element);
    if (!isVisible(element, style, rect)) continue;
    const dataUri = element.tagName === 'CANVAS'
      ? canvasToDataUri(element)
      : element.tagName === 'svg' || element.tagName === 'SVG'
        ? await svgToDataUri(element)
        : await imageToDataUri(element);
    if (!/^data:image\\/(?:png|jpeg|jpg|gif|webp|svg\\+xml);base64,/i.test(dataUri)) continue;
    if (maxImageDataUriLength > 128 && dataUri.length > maxImageDataUriLength) continue;
    images.push({
      dataUri,
      mimeType: dataUri.match(/^data:(image\\/(?:png|jpeg|jpg|gif|webp|svg\\+xml));base64,/i)?.[1] || 'image/png',
      x,
      y,
      w,
      h,
      alt: element.getAttribute('alt') || '',
      rotate: parseRotate(style)
    });
  }

  // 用已提取的 dataUri 去重，避免 background-image 与 img/canvas 重复提取
  const seenDataUris = new Set(images.map((img) => img.dataUri));

  const extractCssUrl = (value) => {
    const match = String(value || '').match(/url\\((["']?)(.*?)\\1\\)/i);
    return match ? String(match[2] || '').trim() : '';
  };

  // 提取 CSS background-image 中的图片
  const bgImageCandidates = []
  for (const el of pageElement.querySelectorAll('*')) {
    if (bgImageCandidates.length >= maxImages) break
    const style = window.getComputedStyle(el)
    const bg = style.backgroundImage || ''
    if (!/^url\\(/i.test(bg)) continue
    bgImageCandidates.push({ el, style })
  }

  for (const { el, style } of bgImageCandidates) {
    if (images.length >= maxImages) break
    const { rect, x, y, w, h } = elementToBox(el)
    if (!isVisible(el, style, rect)) continue

    const bgUrl = extractCssUrl(style.backgroundImage)
    if (!bgUrl || /^data:image\\/svg\\+xml,/i.test(bgUrl)) continue
    const dataUri = await sourceToDataUri(bgUrl)
    if (!/^data:image\\/(?:png|jpeg|jpg|gif|webp|svg\\+xml);base64,/i.test(dataUri)) continue
    if (maxImageDataUriLength > 128 && dataUri.length > maxImageDataUriLength) continue
    if (seenDataUris.has(dataUri)) continue
    seenDataUris.add(dataUri)

    images.push({
      dataUri,
      mimeType:
        dataUri.match(/^data:(image\\/(?:png|jpeg|jpg|gif|webp|svg\\+xml));base64,/i)?.[1] || 'image/png',
      x,
      y,
      w,
      h,
      alt: '',
      rotate: parseRotate(style)
    })
  }

  return { backgroundColor, shapes, texts, images };
})()
`
}

export const normalizeExtractedHtmlToPptxSlide = (
  raw: unknown,
  fallbackTitle?: string
): HtmlToPptxSlide => {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const textsRaw = Array.isArray(record.texts) ? record.texts : []
  const shapesRaw = Array.isArray(record.shapes) ? record.shapes : []
  const imagesRaw = Array.isArray(record.images) ? record.images : []
  const texts = textsRaw
    .map((item): HtmlToPptxTextBox | null => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const text = normalizePptxText(String(row.text || '')).slice(0, DEFAULT_MAX_TEXT_CHARS)
      if (!text) return null
      return {
        text,
        x: clamp(Number(row.x) || 0, 0, DEFAULT_SLIDE_WIDTH),
        y: clamp(Number(row.y) || 0, 0, DEFAULT_SLIDE_HEIGHT),
        w: clamp(Number(row.w) || 0.4, 0.1, DEFAULT_SLIDE_WIDTH),
        h: clamp(Number(row.h) || 0.2, 0.08, DEFAULT_SLIDE_HEIGHT),
        fontSize: clamp(Number(row.fontSize) || 12, 6, MAX_EXPORT_FONT_SIZE_PT),
        fontFace: resolveExportFontFace(text, String(row.fontFace || '')),
        color: normalizeHexColor(String(row.color || ''), '111827'),
        bold: Boolean(row.bold),
        italic: Boolean(row.italic),
        underline: Boolean(row.underline),
        strike: Boolean(row.strike),
        align:
          row.align === 'center' || row.align === 'right' || row.align === 'justify'
            ? row.align
            : 'left',
        opacity: clamp(Number(row.opacity ?? 1), 0, 1),
        rotate: clamp(Number(row.rotate ?? 0), -360, 360),
        lineSpacing:
          Number(row.lineSpacing) > 0 ? clamp(Number(row.lineSpacing), 1, 200) : undefined,
        charSpacing: Number.isFinite(Number(row.charSpacing))
          ? clamp(Number(row.charSpacing), -20, 200)
          : undefined,
        wrap: Boolean(row.wrap)
      }
    })
    .filter((item): item is HtmlToPptxTextBox => Boolean(item))

  const shapes = shapesRaw
    .map((item): HtmlToPptxShape | null => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const fill = normalizeHexColor(String(row.fill || ''), '')
      const borderRaw =
        row.border && typeof row.border === 'object'
          ? (row.border as Record<string, unknown>)
          : null
      const borderColor = normalizeHexColor(String(borderRaw?.color || ''), '')
      if (!fill && !borderColor) return null
      return {
        x: clamp(Number(row.x) || 0, 0, DEFAULT_SLIDE_WIDTH),
        y: clamp(Number(row.y) || 0, 0, DEFAULT_SLIDE_HEIGHT),
        w: clamp(Number(row.w) || 0.1, 0.05, DEFAULT_SLIDE_WIDTH),
        h: clamp(Number(row.h) || 0.1, 0.05, DEFAULT_SLIDE_HEIGHT),
        fill,
        transparency: clamp(Number(row.transparency ?? 0), 0, 100),
        radius: clamp(Number(row.radius ?? 0), 0, 100),
        border: borderColor
          ? {
              color: borderColor,
              widthPt: clamp(Number(borderRaw?.widthPt ?? 0.75), 0.1, 20),
              transparency: clamp(Number(borderRaw?.transparency ?? 0), 0, 100),
              dash: borderRaw?.dash === 'dash' ? 'dash' : 'solid'
            }
          : undefined,
        shapeType:
          row.shapeType === 'ellipse' || row.shapeType === 'roundRect' ? row.shapeType : 'rect',
        rotate: clamp(Number(row.rotate ?? 0), -360, 360)
      }
    })
    .filter((item): item is HtmlToPptxShape => Boolean(item))

  const images = imagesRaw
    .map((item): HtmlToPptxImage | null => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const dataUri = String(row.dataUri || '')
      const mimeType = normalizeDataUriMime(dataUri)
      if (!mimeType || estimateDataUriBytes(dataUri) > DEFAULT_MAX_IMAGE_BYTES) return null
      return {
        dataUri,
        mimeType,
        x: clamp(Number(row.x) || 0, 0, DEFAULT_SLIDE_WIDTH),
        y: clamp(Number(row.y) || 0, 0, DEFAULT_SLIDE_HEIGHT),
        w: clamp(Number(row.w) || 0.1, 0.05, DEFAULT_SLIDE_WIDTH),
        h: clamp(Number(row.h) || 0.1, 0.05, DEFAULT_SLIDE_HEIGHT),
        alt: normalizeText(String(row.alt || '')),
        rotate: clamp(Number(row.rotate ?? 0), -360, 360)
      }
    })
    .filter((item): item is HtmlToPptxImage => Boolean(item))

  return {
    title: fallbackTitle,
    backgroundColor: normalizeHexColor(String(record.backgroundColor || ''), 'FFFFFF'),
    backgroundImage: undefined,
    texts,
    shapes,
    images
  }
}

export const writeHtmlToPptx = async (
  outputPath: string,
  document: HtmlToPptxDocument
): Promise<void> => {
  const pptx = buildPptxGenDocument(document)
  await pptx.writeFile({ fileName: outputPath })
}

const buildPptxGenDocument = (document: HtmlToPptxDocument): PptxGenJS => {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = document.author || 'ohmyppt'
  pptx.company = 'ohmyppt'
  pptx.subject = document.title || 'ohmyppt'
  pptx.title = document.title || 'ohmyppt'
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos'
  }

  const slides = document.slides.length > 0 ? document.slides : [{ texts: [] }]
  slides.forEach((sourceSlide) => {
    const slide = pptx.addSlide()
    slide.background = { color: normalizeHexColor(sourceSlide.backgroundColor, 'FFFFFF') }
    // Z-order is intentional: visual background first, optional decorative objects next, editable text last.
    if (sourceSlide.backgroundImage) {
      slide.addImage({
        data: sourceSlide.backgroundImage.dataUri,
        x: 0,
        y: 0,
        w: DEFAULT_SLIDE_WIDTH,
        h: DEFAULT_SLIDE_HEIGHT,
        altText: 'Slide visual background'
      })
    }
    ;(sourceSlide.shapes || []).forEach((shape) => {
      slide.addShape(mapPptxShapeType(pptx, shape), {
        x: shape.x,
        y: shape.y,
        w: shape.w,
        h: shape.h,
        rotate: shape.rotate || undefined,
        rectRadius: shape.radius ? clamp(shape.radius / 130, 0, 0.5) : undefined,
        fill: shape.fill
          ? {
              color: normalizeHexColor(shape.fill, 'FFFFFF'),
              transparency: clamp(shape.transparency ?? 0, 0, 100)
            }
          : { color: 'FFFFFF', transparency: 100 },
        line: shape.border
          ? {
              color: normalizeHexColor(shape.border.color, '000000'),
              width: shape.border.widthPt,
              transparency: clamp(shape.border.transparency ?? 0, 0, 100),
              dashType: shape.border.dash === 'dash' ? 'dash' : 'solid'
            }
          : { color: 'FFFFFF', transparency: 100 }
      })
    })
    ;(sourceSlide.images || []).forEach((image) => {
      slide.addImage({
        data: image.dataUri,
        x: image.x,
        y: image.y,
        w: image.w,
        h: image.h,
        altText: image.alt,
        rotate: image.rotate || undefined
      })
    })

    sourceSlide.texts.forEach((textBox) => {
      const text = textBox.text
      if (!text) return
      slide.addText(text, {
        x: textBox.x,
        y: textBox.y,
        w: textBox.w,
        h: textBox.h,
        fontSize: textBox.fontSize,
        fontFace: resolveExportFontFace(text, textBox.fontFace),
        color: normalizeHexColor(textBox.color, '111827'),
        bold: Boolean(textBox.bold),
        italic: Boolean(textBox.italic),
        underline: textBox.underline ? { style: 'sng' } : undefined,
        strike: textBox.strike ? 'sngStrike' : undefined,
        align: textBox.align || 'left',
        valign: 'top',
        margin: 0,
        fit: textBox.wrap ? 'shrink' : 'none',
        wrap: textBox.wrap ?? false,
        rotate: textBox.rotate || undefined,
        transparency: Math.round((1 - clamp(textBox.opacity ?? 1, 0, 1)) * 100),
        lineSpacing: textBox.lineSpacing,
        charSpacing: textBox.charSpacing
      })
    })
  })

  return pptx
}

const mapPptxShapeType = (pptx: PptxGenJS, shape: HtmlToPptxShape): PptxGenJS.ShapeType => {
  if (shape.shapeType === 'ellipse') return pptx.ShapeType.ellipse
  if (shape.shapeType === 'roundRect') return pptx.ShapeType.roundRect
  return pptx.ShapeType.rect
}
