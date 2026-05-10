import { ipcMain } from 'electron'
import type { IpcContext } from '../context'
import { loadEditableSessionPages, persistManagedPages } from './page-management-service'
import { ensureHistoryBaselineSafe, recordHistoryOperationStrict } from '../../history/git-history-service'

export function registerPageManagementHandlers(ctx: IpcContext): void {
  ipcMain.handle('session:reorderPages', async (_event, payload) => {
    const { sessionId, orderedPageIds, selectedPageId } = payload as {
      sessionId: string
      orderedPageIds: string[]
      selectedPageId?: string
    }
    const { projectDir, indexPath, deckTitle, pages } = await loadEditableSessionPages(ctx, sessionId)
    if (orderedPageIds.length !== pages.length) {
      throw new Error('orderedPageIds length mismatch')
    }
    const pageMap = new Map(pages.map((p) => [p.id, p]))
    const uniqueOrderedIds = new Set(orderedPageIds)
    if (uniqueOrderedIds.size !== orderedPageIds.length) {
      throw new Error('orderedPageIds contains duplicate page ids')
    }
    for (const id of orderedPageIds) {
      if (!pageMap.has(id)) throw new Error(`Unknown page id: ${id}`)
    }
    const beforeOrder = pages.map((p) => ({
      id: p.id,
      pageNumber: p.pageNumber,
      pageId: p.pageId,
      title: p.title
    }))
    const reordered = orderedPageIds.map((id) => {
      return pageMap.get(id)!
    })
    const afterOrder = reordered.map((p, index) => ({
      id: p.id,
      pageNumber: index + 1,
      pageId: p.pageId,
      title: p.title
    }))
    const movedPages = afterOrder
      .map((item, index) => {
        const fromIndex = beforeOrder.findIndex((x) => x.id === item.id)
        return {
          id: item.id,
          title: item.title,
          from: fromIndex >= 0 ? fromIndex + 1 : null,
          to: index + 1
        }
      })
      .filter((item) => item.from !== item.to)
    const shrinkTitle = (title: string): string => {
      const clean = title.replace(/\s+/g, ' ').trim()
      if (clean.length <= 16) return clean
      return `${clean.slice(0, 16)}…`
    }
    const movedPreview = movedPages
      .slice(0, 2)
      .map((item) => `P${item.from}->P${item.to}《${shrinkTitle(item.title)}》`)
      .join('；')
    const operationPrompt =
      movedPages.length > 0
        ? `调整页面顺序：${movedPreview}${movedPages.length > 2 ? `；等 ${movedPages.length} 项` : ''}`
        : '调整页面顺序（位置未变化）'
    await ensureHistoryBaselineSafe(ctx.db, sessionId, projectDir)

    const result = await persistManagedPages(ctx, {
      sessionId,
      projectDir,
      indexPath,
      deckTitle,
      pages: reordered,
      operation: 'reorder',
      prompt: operationPrompt
    })
    await recordHistoryOperationStrict(ctx.db, {
      sessionId,
      type: 'edit',
      scope: 'session',
      projectDir,
      prompt: operationPrompt,
      metadata: {
        changedPageIds: result.map((p) => p.id),
        selectedPageId: selectedPageId || null,
        totalPages: result.length,
        movedCount: movedPages.length,
        movedPages,
        beforeOrder,
        afterOrder
      }
    })

    return {
      ok: true,
      generatedPages: result.map((p) => ({
        id: p.id,
        pageNumber: p.pageNumber,
        pageId: p.pageId,
        title: p.title,
        html: '',
        htmlPath: p.htmlPath,
        status: p.status,
        error: p.error
      })),
      selectedPageId: selectedPageId || null
    }
  })

  ipcMain.handle('session:deletePages', async (_event, payload) => {
    const { sessionId, pageIds, selectedPageId } = payload as {
      sessionId: string
      pageIds: string[]
      selectedPageId?: string
    }
    const { projectDir, indexPath, deckTitle, pages } = await loadEditableSessionPages(ctx, sessionId)
    if (!pageIds.length) throw new Error('pageIds is empty')
    const pageMap = new Map(pages.map((p) => [p.id, p]))
    const uniqueDeleteIds = new Set(pageIds)
    if (uniqueDeleteIds.size !== pageIds.length) {
      throw new Error('pageIds contains duplicate page ids')
    }
    for (const id of pageIds) {
      if (!pageMap.has(id)) throw new Error(`Unknown page id: ${id}`)
    }
    if (pages.length - uniqueDeleteIds.size < 1) throw new Error('Cannot delete last page')
    const deleteSet = new Set(pageIds)
    const beforeOrder = pages.map((p) => ({
      id: p.id,
      pageNumber: p.pageNumber,
      pageId: p.pageId,
      title: p.title
    }))
    const firstDeletedIndex = pages.findIndex((p) => deleteSet.has(p.id))
    const remaining = pages.filter((p) => !deleteSet.has(p.id))
    const deletedPages = pages.filter((p) => deleteSet.has(p.id))
    const afterOrder = remaining.map((p, index) => ({
      id: p.id,
      pageNumber: index + 1,
      pageId: p.pageId,
      title: p.title
    }))
    const shrinkTitle = (title: string): string => {
      const clean = title.replace(/\s+/g, ' ').trim()
      if (clean.length <= 16) return clean
      return `${clean.slice(0, 16)}…`
    }
    const deletedPreview = deletedPages
      .slice(0, 3)
      .map((item) => `P${item.pageNumber}《${shrinkTitle(item.title)}》`)
      .join('；')
    const deletePrompt =
      deletedPages.length > 0
        ? `删除页面：${deletedPreview}${deletedPages.length > 3 ? `；等 ${deletedPages.length} 页` : ''}`
        : `删除页面：${pageIds.length} 页`
    await ensureHistoryBaselineSafe(ctx.db, sessionId, projectDir)

    const result = await persistManagedPages(ctx, {
      sessionId,
      projectDir,
      indexPath,
      deckTitle,
      pages: remaining,
      operation: 'delete',
      deletedPageIds: pageIds,
      prompt: deletePrompt
    })
    await recordHistoryOperationStrict(ctx.db, {
      sessionId,
      type: 'edit',
      scope: 'session',
      projectDir,
      prompt: deletePrompt,
      metadata: {
        deletedPageIds: pageIds,
        selectedPageId: selectedPageId || null,
        deletedCount: pageIds.length,
        totalPagesAfterDelete: result.length,
        beforeOrder,
        afterOrder
      }
    })

    let newSelectedId = selectedPageId || null
    if (selectedPageId && deleteSet.has(selectedPageId)) {
      const nextIndex = Math.min(Math.max(firstDeletedIndex, 0), result.length - 1)
      newSelectedId = result.length > 0 ? result[nextIndex].id : null
    }

    return {
      ok: true,
      generatedPages: result.map((p) => ({
        id: p.id,
        pageNumber: p.pageNumber,
        pageId: p.pageId,
        title: p.title,
        html: '',
        htmlPath: p.htmlPath,
        status: p.status,
        error: p.error
      })),
      selectedPageId: newSelectedId
    }
  })
}
