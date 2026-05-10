import type { IpcContext } from '../context'
import * as fs from 'fs'
import path from 'path'
import { buildProjectIndexHtml } from '../engine/template'

const INDEX_RUNTIME_MARKER = '@ohmyppt-index-runtim:arcsin1:v2'

async function ensureSessionRuntimeCompatible(ctx: IpcContext, projectDir: string): Promise<void> {
  const runtimePath = path.join(projectDir, 'assets', 'index-runtime.js')
  try {
    const content = await fs.promises.readFile(runtimePath, 'utf-8')
    if (content.includes(INDEX_RUNTIME_MARKER)) return
  } catch {
    // Missing or unreadable runtime file falls back to full asset refresh.
  }
  await ctx.ensureSessionAssets(projectDir)
}

export interface ManagedPage {
  id: string
  pageNumber: number
  pageId: string
  legacyPageId?: string
  title: string
  htmlPath: string
  html?: string
  status?: string
  error?: string | null
}

export async function loadEditableSessionPages(
  ctx: IpcContext,
  sessionId: string
): Promise<{
  session: Record<string, unknown>
  projectDir: string
  indexPath: string
  deckTitle: string
  pages: ManagedPage[]
}> {
  const session = await ctx.db.getSession(sessionId)
  if (!session) throw new Error('Session not found')

  let metadata: Record<string, unknown> = {}
  try {
    metadata = JSON.parse((session as unknown as { metadata?: string }).metadata || '{}') as Record<
      string,
      unknown
    >
  } catch {
    metadata = {}
  }

  const project = await ctx.db.getProject(sessionId)
  const storagePath = await ctx.resolveStoragePath()
  const projectDir = path.resolve(
    project?.output_path ||
      (typeof metadata.indexPath === 'string'
        ? path.dirname(metadata.indexPath)
        : path.join(storagePath, sessionId))
  )
  const indexPath =
    (typeof metadata.indexPath === 'string' && metadata.indexPath) ||
    path.join(projectDir, 'index.html')
  const deckTitle = (session as unknown as { title?: string }).title || 'Untitled'

  const sessionPages = await ctx.db.listSessionPages(sessionId)
  const pages: ManagedPage[] = sessionPages.map((sp) => ({
    id: sp.id,
    pageNumber: sp.page_number,
    pageId: sp.file_slug,
    legacyPageId: sp.legacy_page_id || undefined,
    title: sp.title,
    htmlPath: sp.html_path,
    status: sp.status,
    error: sp.error
  }))

  return { session: session as unknown as Record<string, unknown>, projectDir, indexPath, deckTitle, pages }
}

export async function persistManagedPages(
  ctx: IpcContext,
  args: {
    sessionId: string
    projectDir: string
    indexPath: string
    deckTitle: string
    pages: ManagedPage[]
    operation: 'reorder' | 'delete'
    deletedPageIds?: string[]
    prompt: string
  }
): Promise<ManagedPage[]> {
  const { db } = ctx
  // Refresh assets only when runtime marker is missing/mismatched (mainly old sessions).
  await ensureSessionRuntimeCompatible(ctx, args.projectDir)
  // Keep caller order (drag result / filtered order), only rewrite contiguous page numbers.
  const renumbered = args.pages.map((p, i) => ({ ...p, pageNumber: i + 1 }))

  const deckPages = renumbered.map((p) => ({
    id: p.id,
    pageNumber: p.pageNumber,
    pageId: p.pageId,
    title: p.title,
    htmlPath: path.basename(p.htmlPath)
  }))
  const indexHtml = buildProjectIndexHtml(args.deckTitle, deckPages)
  await fs.promises.writeFile(`${args.indexPath}.tmp`, indexHtml, 'utf-8')
  try {
    if (args.deletedPageIds?.length) {
      await db.softDeleteSessionPages(args.sessionId, args.deletedPageIds)
    }
    await db.replaceSessionPageOrder(
      args.sessionId,
      renumbered.map((p) => ({ id: p.id, pageNumber: p.pageNumber }))
    )
    const currentSession = await db.getSession(args.sessionId)
    let currentMetadata: Record<string, unknown> = {}
    try {
      currentMetadata = JSON.parse((currentSession?.metadata as string | null) || '{}')
    } catch {
      currentMetadata = {}
    }
    const {
      generatedPages: _generatedPages,
      failedPages: _failedPages,
      ...safeMetadata
    } = currentMetadata as Record<string, unknown> & {
      generatedPages?: unknown
      failedPages?: unknown
    }
    await db.updateSessionMetadata(args.sessionId, {
      ...safeMetadata,
      entryMode: 'multi_page',
      indexPath: args.indexPath
    })
  } catch (error) {
    await fs.promises.rm(`${args.indexPath}.tmp`, { force: true })
    throw error
  }
  await fs.promises.rename(`${args.indexPath}.tmp`, args.indexPath)

  return renumbered
}
