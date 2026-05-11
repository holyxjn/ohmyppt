import type { DesignContract, SessionDeckGenerationContext } from '../tools/types'
import { formatLayoutIntentPrompt } from '@shared/layout-intent'
import {
  CONTENT_LANGUAGE_RULES,
  FRONTEND_CAPABILITIES,
  PAGE_SEMANTIC_STRUCTURE,
  buildOutlinePageList,
  formatDesignContract
} from './shared'

export function buildDeckGenerationPrompt(context: SessionDeckGenerationContext): string {
  const pageList = buildOutlinePageList(context)
  return [
    'Use the tools to write the deck content into each /<pageId>.html according to the user requirements and page outline below:',
    '',
    `Topic: ${context.topic}`,
    `Deck title: ${context.deckTitle}`,
    'Page outline:',
    pageList,
    '',
    'Additional user requirements:',
    context.userMessage,
    '',
    CONTENT_LANGUAGE_RULES,
    '',
    FRONTEND_CAPABILITIES,
    '',
    PAGE_SEMANTIC_STRUCTURE,
    '',
    'Fill each slide strictly according to the content points in the page outline above.'
  ].join('\n')
}

export function buildSinglePageGenerationPrompt(args: {
  topic: string
  deckTitle: string
  pageId: string
  pageNumber: number
  pageTitle: string
  pageOutline: string
  layoutIntent?: SessionDeckGenerationContext['outlineItems'][number]['layoutIntent']
  sourceDocumentPaths?: string[]
  referenceDocumentSnippets?: string
  isRetryMode?: boolean
  designContract?: DesignContract
  retryContext?: {
    attempt: number
    maxRetries: number
    previousError: string
  }
}): string {
  const previousError = args.retryContext?.previousError || ''
  const shouldMentionChartOrAnimationFix =
    /chart|canvas|animation|animate|anime|PPT\.animate|PPT\.createChart/i.test(previousError)
  const shouldMentionWriteToolFix =
    /页面未写入|没有成功调用|not written|update_single_page_file|占位|placeholder/i.test(
      previousError
    )
  const retryInstructions = args.retryContext
    ? [
        '',
        'Retry fixes to prioritize:',
        `- This is retry ${args.retryContext.attempt}/${args.retryContext.maxRetries}.`,
        `- Previous failure: ${previousError}`,
        '- Output only a complete creative page fragment. The write tool will add section/main/content semantics when they are missing. Do not output a full document, page shell, or runtime scripts.',
        shouldMentionWriteToolFix
          ? `- The previous attempt did not write the target page. You must call update_single_page_file(pageId="${args.pageId}", content=...) before any final response; do not only describe the HTML in the final response.`
          : '',
        '- Before calling the write tool, mentally validate that the main containers are closed and that no tag is left unfinished at the end.',
        '- If the previous issue was unclosed tags, simplify the structure and ensure every section/div/p/span/li tag is paired.',
        '- If the previous issue was page shell structure, do not include .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, or data-ppt-guard-root anywhere, including CSS selectors, class names, scripts, and comments.',
        shouldMentionChartOrAnimationFix
          ? '- The previous issue involved animation/chart API usage. Use PPT.animate, PPT.createTimeline, PPT.stagger, and PPT.createChart.'
          : ''
      ].filter(Boolean)
    : []
  const sourceDocumentInstructions =
    args.sourceDocumentPaths && args.sourceDocumentPaths.length > 0
      ? args.referenceDocumentSnippets && args.referenceDocumentSnippets.trim().length > 0
        ? [
            '',
            args.referenceDocumentSnippets.trim(),
            '',
            'Source document requirements:',
            '- This slide already has program-side retrieved snippets. Prioritize these snippets when generating slide content.',
            '- If the snippets cover this slide title and content points, you do not need to reread the entire source document.',
            `- If snippets are insufficient, conflicting, or missing key facts, use read_file to confirm the source document: ${args.sourceDocumentPaths.join(', ')}`,
            '- Use only source-document facts directly relevant to this slide outline. Do not move material for other slides into this slide.',
            args.isRetryMode
              ? '- This is a failed-slide retry. Match source material only around this slide title and content points; do not reconstruct the whole deck outline.'
              : '',
            '- Do not expand only from the outline. Do not invent exact numbers, dates, system names, or status claims not present in the snippets or source document.'
          ].filter(Boolean)
        : [
            '',
            'Source document requirements:',
            `- No retrieved snippets matched this slide. Before generating the slide, use read_file to read the source document: ${args.sourceDocumentPaths.join(', ')}`,
            '- First extract keywords, business objects, time points, system names, and metrics from this slide title and content points; then match relevant source passages.',
            '- Do not copy the whole document indiscriminately. Use only source-document facts directly relevant to this slide outline.',
            args.isRetryMode
              ? '- This is a failed-slide retry. Match source material only around this slide title and content points; do not reconstruct the whole deck outline.'
              : '',
            '- Do not expand only from the outline. Do not invent exact numbers, dates, system names, or status claims not present in the source document.'
          ].filter(Boolean)
      : []
  return [
    'Generate and write only this slide. Do not modify other slides.',
    '',
    `Topic: ${args.topic}`,
    `Deck title: ${args.deckTitle}`,
    `Target page: ${args.pageId} (slide ${args.pageNumber})`,
    `Slide title: ${args.pageTitle}`,
    `Content points: ${args.pageOutline || 'Expand from the topic with moderate information density.'}`,
    args.layoutIntent ? formatLayoutIntentPrompt(args.layoutIntent) : '',
    ...sourceDocumentInstructions,
    '',
    CONTENT_LANGUAGE_RULES,
    '',
    'Deck-wide design contract. Follow it to keep pages visually consistent:',
    formatDesignContract(args.designContract),
    ...retryInstructions,
    '',
    'Expansion rules:',
    '- Treat content points as short seed phrases. Expand each seed into presentable modules such as headings, explanations, lists, charts, comparisons, or conclusions.',
    '- If there are 2-4 points, the final slide should cover all of them. You may add 1-2 supporting information blocks by priority.',
    '- You may complete reasonable data framing, examples, and structure, but do not drift away from the slide title and points.',
    '- Prefer visualization-friendly expression. When points involve trends, comparisons, or proportions, use charts or data cards when appropriate.',
    '',
    'Single-slide tool constraints:',
    `- Required action: call update_single_page_file(pageId="${args.pageId}", content=complete creative page fragment).`,
    '- This is not optional. A final text response without a successful update_single_page_file tool call means the slide is not generated.',
    '- Do not call update_page_file. In this single-slide run it is intentionally not available.',
    '- content must be a complete creative page fragment. The tool will wrap it with section[data-page-scaffold], main[data-role="content"], editable data-block-id attributes, and the runtime page frame when needed.',
    '- The content must not contain <!doctype>, <html>, <head>, <body>, .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, or data-ppt-guard-root.',
    '- The content must be complete and balanced: close your main layout containers and leave no unfinished trailing tags.',
    '- After the tool call succeeds, final response should be a short summary only. Do not paste the HTML in the final response.',
    '- Do not modify other slides.',
    '',
    'Tool context (pre-injected):',
    `- Target file: ${args.pageId}.html (virtual path: /${args.pageId}.html)`,
    '- Agent workspace root: /'
  ].join('\n')
}
