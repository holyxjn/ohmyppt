import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import log from 'electron-log/main.js'
import * as git from 'isomorphic-git'
import { nanoid } from 'nanoid'
import type { PPTDatabase, SessionOperationRecord, SessionPageRecord } from '../db/database'
import type {
  ChangedHistoryFile,
  HistoryOperationKind,
  HistoryOperationScope,
  HistoryVersion,
  RollbackHistoryResult
} from '@shared/history'

const GITIGNORE_CONTENT = ['.DS_Store', 'Thumbs.db', '*.log', 'tmp/', 'cache/', ''].join('\n')

type RecordOperationArgs = {
  sessionId: string
  projectDir: string
  type: HistoryOperationKind
  scope: HistoryOperationScope
  prompt?: string | null
  metadata?: Record<string, unknown>
  targetOperationId?: string | null
  targetCommit?: string | null
}

type GitStatusMatrixRow = [string, number, number, number]

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value || value.trim().length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const normalizeRelativePath = (value: string): string => value.split(path.sep).join('/')

const isControlledFile = (relativePath: string): boolean => {
  const rel = normalizeRelativePath(relativePath).replace(/^\/+/, '')
  if (!rel || rel.includes('..') || rel.startsWith('.git/')) return false
  if (rel === '.gitignore') return true
  if (rel === 'index.html') return true
  if (/^[^/]+\.html?$/i.test(rel) && rel.toLowerCase() !== 'index.html') return true
  if (rel.startsWith('assets/') && !rel.endsWith('/')) return true
  return false
}

const pageIdFromPath = (relativePath: string): string | undefined => {
  const rel = normalizeRelativePath(relativePath)
  if (!/^[^/]+\.html?$/i.test(rel) || rel.toLowerCase() === 'index.html') return undefined
  return rel.replace(/\.html?$/i, '')
}

const ensureDir = async (dir: string): Promise<void> => {
  await fs.promises.mkdir(dir, { recursive: true })
}

async function walkFiles(root: string, prefix = ''): Promise<string[]> {
  const dir = path.join(root, prefix)
  if (!fs.existsSync(dir)) return []
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  const results: string[] = []
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const rel = normalizeRelativePath(path.join(prefix, entry.name))
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(root, rel)))
    } else if (entry.isFile() && isControlledFile(rel)) {
      results.push(rel)
    }
  }
  return results.sort()
}

export class GitHistoryService {
  constructor(private readonly db: PPTDatabase) {}

  async ensureBaseline(sessionId: string, projectDir: string): Promise<void> {
    const resolvedProjectDir = path.resolve(projectDir)
    await this.ensureRepository(resolvedProjectDir)
    const head = await this.resolveHead(resolvedProjectDir)
    const session = await this.db.getSession(sessionId)
    if (!head && !session?.currentCommit) {
      await this.createLegacyImport(sessionId, resolvedProjectDir)
    }
  }

  async recordOperation(args: RecordOperationArgs): Promise<SessionOperationRecord | null> {
    const projectDir = path.resolve(args.projectDir)
    await this.ensureRepository(projectDir)

    let beforeCommit = await this.resolveHead(projectDir)
    let session = await this.db.getSession(args.sessionId)
    let parentOperationId =
      typeof session?.currentOperationId === 'string' ? session.currentOperationId : null

    if (!beforeCommit && args.type !== 'generate' && args.type !== 'import') {
      await this.createLegacyImport(args.sessionId, projectDir)
      beforeCommit = await this.resolveHead(projectDir)
      session = await this.db.getSession(args.sessionId)
      parentOperationId =
        typeof session?.currentOperationId === 'string' ? session.currentOperationId : null
    }

    const metadata = await this.buildOperationMetadata(args)
    const { changedFiles } = await this.stageControlledChanges(projectDir)
    const changedPages = Array.from(
      new Set(changedFiles.map((file) => file.pageId).filter(Boolean) as string[])
    ).sort()
    if (changedFiles.length === 0) {
      log.debug('[history] skip operation without controlled file changes', {
        sessionId: args.sessionId,
        type: args.type,
        scope: args.scope
      })
      return null
    }
    const trackedFiles = await walkFiles(projectDir)
    const operationId = crypto.randomUUID()
    await this.db.createSessionOperation({
      id: operationId,
      sessionId: args.sessionId,
      type: args.type,
      scope: args.scope,
      prompt: args.prompt || null,
      parentOperationId,
      beforeCommit,
      targetOperationId: args.targetOperationId || null,
      targetCommit: args.targetCommit || null,
      metadata
    })

    try {
      await this.captureOperationPageSnapshot(args.sessionId, operationId)
      const afterCommit = await git.commit({
        fs,
        dir: projectDir,
        message: this.buildCommitMessage(args, changedPages),
        author: {
          name: 'Oh My PPT',
          email: 'history@oh-my-ppt.local'
        }
      })
      const trackedAfterCommit = await this.listTrackedFiles(projectDir, afterCommit).catch(
        () => trackedFiles
      )
      await this.db.completeSessionOperation({
        id: operationId,
        status: 'completed',
        afterCommit,
        changedFiles,
        changedPages,
        trackedFiles: trackedAfterCommit,
        metadata
      })
      await this.db.updateSessionHistoryPointer({
        sessionId: args.sessionId,
        operationId,
        commit: afterCommit
      })
      return this.db.getSessionOperation(operationId) as Promise<SessionOperationRecord | null>
    } catch (error) {
      await this.db.completeSessionOperation({
        id: operationId,
        status: 'failed',
        afterCommit: beforeCommit,
        metadata: {
          ...metadata,
          error: error instanceof Error ? error.message : String(error)
        }
      })
      throw error
    }
  }

  async listVersions(sessionId: string, limit = 10): Promise<HistoryVersion[]> {
    const session = await this.db.getSession(sessionId)
    const currentCommit = typeof session?.currentCommit === 'string' ? session.currentCommit : null
    const currentOperationId =
      typeof session?.currentOperationId === 'string' ? session.currentOperationId : null
    const startOperationId =
      currentOperationId ||
      (await this.findOperationIdByCommit(sessionId, currentCommit)) ||
      null
    const maxCount = Math.max(1, Math.min(50, Math.floor(limit)))
    const operations = await this.collectVisibleChainOperations(startOperationId, maxCount)

    return operations
      .filter((operation) => operation.status === 'completed' && Boolean(operation.after_commit))
      .slice(0, maxCount)
      .map((operation) =>
        this.toHistoryVersion(operation, {
          currentCommit,
          currentOperationId
        })
      )
  }

  async rollbackToVersion(args: {
    sessionId: string
    projectDir: string
    versionId: string
  }): Promise<RollbackHistoryResult> {
    const session = await this.db.getSession(args.sessionId)
    if (session?.status === 'active') {
      throw new Error('当前会话正在生成或编辑，暂时不能回退。')
    }
    const targetOperation = await this.db.getSessionOperation(args.versionId)
    if (!targetOperation || targetOperation.session_id !== args.sessionId) {
      throw new Error('历史版本不存在。')
    }
    if (targetOperation.status !== 'completed' || !targetOperation.after_commit) {
      throw new Error('该历史版本不可回退。')
    }

    const projectDir = path.resolve(args.projectDir)
    await this.ensureRepository(projectDir)
    const beforeCommit = await this.resolveHead(projectDir)
    if (!beforeCommit) {
      throw new Error('当前会话尚未建立历史记录，不能回退。')
    }
    await this.assertCommitExists(projectDir, targetOperation.after_commit)
    if (beforeCommit === targetOperation.after_commit) {
      throw new Error('当前已经是该历史版本。')
    }
    const beforePages = await this.db.listSessionPages(args.sessionId, { includeDeleted: true })
    const beforeMetadata = parseJson<Record<string, unknown>>(session?.metadata, {})
    const beforeOperationId =
      typeof session?.currentOperationId === 'string' ? session.currentOperationId : null
    const beforeFiles = await this.listTrackedFiles(projectDir, beforeCommit)

    const targetFiles =
      parseJson<string[]>(targetOperation.tracked_files_json, []).filter(isControlledFile)
    const filesToRestore =
      targetFiles.length > 0
        ? targetFiles
        : await this.listTrackedFiles(projectDir, targetOperation.after_commit)
    try {
      await this.restoreCommitFiles(projectDir, targetOperation.after_commit, filesToRestore)
      const targetMetadata = parseJson<Record<string, unknown>>(targetOperation.metadata_json, {})
      await this.syncSessionPagesForRestoredVersion(args.sessionId, projectDir, targetOperation.id)
      const sessionMetadata = targetMetadata.sessionMetadata
      await this.moveHeadToCommit(projectDir, targetOperation.after_commit)
      await this.db.updateSessionHistoryPointer({
        sessionId: args.sessionId,
        operationId: targetOperation.id,
        commit: targetOperation.after_commit
      })

      if (sessionMetadata && typeof sessionMetadata === 'object' && !Array.isArray(sessionMetadata)) {
        await this.db.updateSessionMetadata(args.sessionId, sessionMetadata as Record<string, unknown>)
      }
    } catch (error) {
      // Best-effort rollback to pre-rollback state for non-crash failures.
      await this.restoreCommitFiles(projectDir, beforeCommit, beforeFiles).catch(() => {})
      await this.restoreSessionPagesFromSnapshot(args.sessionId, beforePages).catch(() => {})
      await this.moveHeadToCommit(projectDir, beforeCommit).catch(() => {})
      await this.db
        .updateSessionHistoryPointer({
          sessionId: args.sessionId,
          operationId: beforeOperationId,
          commit: beforeCommit
        })
        .catch(() => {})
      await this.db.updateSessionMetadata(args.sessionId, beforeMetadata).catch(() => {})
      throw error
    }

    return {
      versionId: targetOperation.id,
      operationId: targetOperation.id,
      beforeCommit,
      targetCommit: targetOperation.after_commit,
      afterCommit: targetOperation.after_commit,
      changedFiles: [],
      changedPages: []
    }
  }

  private async syncSessionPagesForRestoredVersion(
    sessionId: string,
    projectDir: string,
    operationId: string
  ): Promise<void> {
    const order = await this.resolveRestoredPageOrder(operationId)
    if (order.length === 0) {
      throw new Error('目标历史版本缺少页面快照，无法恢复页面顺序。')
    }
    const existingPages = await this.db.listSessionPages(sessionId, { includeDeleted: true })
    const existingById = new Map(existingPages.map((p) => [p.id, p]))
    const existingByFileSlug = new Map(existingPages.map((p) => [p.file_slug, p]))
    const activeIds = new Set<string>()

    for (let index = 0; index < order.length; index += 1) {
      const item = order[index] as Record<string, unknown>
      if (!(typeof item.pageId === 'string' && item.pageId.trim().length > 0)) {
        throw new Error('目标历史版本页面快照缺少 pageId，无法恢复页面顺序。')
      }
      const fileSlug = item.pageId.trim()
      const providedId = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id.trim() : ''
      const existing = (providedId ? existingById.get(providedId) : undefined) || existingByFileSlug.get(fileSlug)
      const pageId = providedId || existing?.id || nanoid()
      activeIds.add(pageId)
      const pageNumberRaw = Number(item.pageNumber)
      const pageNumber = Number.isFinite(pageNumberRaw) && pageNumberRaw > 0 ? Math.floor(pageNumberRaw) : index + 1
      const title = typeof item.title === 'string' && item.title.trim().length > 0 ? item.title.trim() : `Page ${pageNumber}`
      await this.db.upsertSessionPage({
        id: pageId,
        sessionId,
        legacyPageId: existing?.legacy_page_id || null,
        fileSlug,
        pageNumber,
        title,
        htmlPath: existing?.html_path || path.resolve(projectDir, `${fileSlug}.html`),
        status: existing?.status || 'completed',
        error: existing?.error || null
      })
    }

    const idsToSoftDelete = existingPages.filter((p) => !activeIds.has(p.id)).map((p) => p.id)
    if (idsToSoftDelete.length > 0) {
      await this.db.softDeleteSessionPages(sessionId, idsToSoftDelete)
    }
  }

  private async resolveRestoredPageOrder(
    operationId: string
  ): Promise<Array<Record<string, unknown>>> {
    const snapshotPages = await this.db.listSessionOperationPages(operationId)
    return snapshotPages.map((page) => ({
      id: page.page_id,
      pageNumber: page.page_number,
      pageId: page.file_slug,
      title: page.title,
      htmlPath: page.html_path
    }))
  }

  private async captureOperationPageSnapshot(
    sessionId: string,
    operationId: string
  ): Promise<void> {
    const pages = await this.db.listSessionPages(sessionId)
    await this.db.replaceSessionOperationPages(
      operationId,
      sessionId,
      pages.map((page) => ({
        pageId: page.id,
        legacyPageId: page.legacy_page_id,
        fileSlug: page.file_slug,
        pageNumber: page.page_number,
        title: page.title,
        htmlPath: page.html_path,
        status: page.status,
        error: page.error
      }))
    )
  }

  private async ensureRepository(projectDir: string): Promise<void> {
    await ensureDir(projectDir)
    const gitDir = path.join(projectDir, '.git')
    if (!fs.existsSync(gitDir)) {
      await git.init({ fs, dir: projectDir, defaultBranch: 'main' })
      await git.setConfig({ fs, dir: projectDir, path: 'user.name', value: 'Oh My PPT' })
      await git.setConfig({
        fs,
        dir: projectDir,
        path: 'user.email',
        value: 'history@oh-my-ppt.local'
      })
    }
    const gitignorePath = path.join(projectDir, '.gitignore')
    if (!fs.existsSync(gitignorePath)) {
      await fs.promises.writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf-8')
    }
  }

  private async createLegacyImport(sessionId: string, projectDir: string): Promise<void> {
    const session = await this.db.getSession(sessionId)
    if (session?.currentCommit) return
    const files = await walkFiles(projectDir)
    if (
      !files.some((file) => file === 'index.html') ||
      !files.some((file) => /^[^/]+\.html?$/i.test(file) && file.toLowerCase() !== 'index.html')
    ) {
      throw new Error('旧会话文件不完整，无法建立历史起点。')
    }
    await this.recordOperation({
      sessionId,
      projectDir,
      type: 'import',
      scope: 'session',
      prompt: '历史起点：导入现有会话状态',
      metadata: {
        legacy: true,
        reason: 'legacy_import'
      }
    })
  }

  private async resolveHead(projectDir: string): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, dir: projectDir, ref: 'HEAD' })
    } catch {
      return null
    }
  }

  private async moveHeadToCommit(projectDir: string, commit: string): Promise<void> {
    const currentBranchRef = await git.currentBranch({ fs, dir: projectDir, fullname: true })
    if (currentBranchRef) {
      await git.writeRef({
        fs,
        dir: projectDir,
        ref: currentBranchRef,
        value: commit,
        force: true
      })
      return
    }
    await git.writeRef({
      fs,
      dir: projectDir,
      ref: 'HEAD',
      value: commit,
      force: true
    })
  }

  private async assertCommitExists(projectDir: string, commit: string): Promise<void> {
    try {
      await git.readCommit({
        fs,
        dir: projectDir,
        oid: commit
      })
    } catch {
      throw new Error('目标历史版本对应的提交对象不存在，无法回退。')
    }
  }

  private async collectVisibleChainOperations(
    startOperationId: string | null,
    limit: number
  ): Promise<SessionOperationRecord[]> {
    if (!startOperationId) return []
    const operations: SessionOperationRecord[] = []
    const visited = new Set<string>()
    let cursor: string | null = startOperationId
    while (cursor && !visited.has(cursor) && operations.length < Math.max(20, limit * 5)) {
      visited.add(cursor)
      const operation = await this.db.getSessionOperation(cursor)
      if (!operation) break
      operations.push(operation)
      cursor = operation.parent_operation_id
    }
    return operations
  }

  private async findOperationIdByCommit(
    sessionId: string,
    commit: string | null
  ): Promise<string | null> {
    if (!commit) return null
    const operations = await this.db.listSessionOperations(sessionId, {
      limit: 500,
      includeNoop: true
    })
    const matched = operations.find((operation) => operation.after_commit === commit)
    return matched?.id || null
  }

  private async restoreSessionPagesFromSnapshot(
    sessionId: string,
    pages: SessionPageRecord[]
  ): Promise<void> {
    const activeIds: string[] = []
    const deletedIds: string[] = []
    for (const page of pages) {
      await this.db.upsertSessionPage({
        id: page.id,
        sessionId,
        legacyPageId: page.legacy_page_id,
        fileSlug: page.file_slug,
        pageNumber: page.page_number,
        title: page.title,
        htmlPath: page.html_path,
        status: page.status,
        error: page.error
      })
      if (page.deleted_at === null) {
        activeIds.push(page.id)
      } else {
        deletedIds.push(page.id)
      }
    }
    if (deletedIds.length > 0) {
      await this.db.softDeleteSessionPages(sessionId, deletedIds)
    }
    const targetActive = new Set(activeIds)
    const currentPages = await this.db.listSessionPages(sessionId, { includeDeleted: true })
    const unknownIds = currentPages
      .filter((page) => !pages.some((item) => item.id === page.id))
      .map((page) => page.id)
    if (unknownIds.length > 0) {
      await this.db.softDeleteSessionPages(sessionId, unknownIds)
    }
    const currentActive = currentPages.filter((page) => page.deleted_at === null).map((page) => page.id)
    const shouldDelete = currentActive.filter((id) => !targetActive.has(id))
    if (shouldDelete.length > 0) {
      await this.db.softDeleteSessionPages(sessionId, shouldDelete)
    }
  }

  private async stageControlledChanges(projectDir: string): Promise<{
    changedFiles: ChangedHistoryFile[]
  }> {
    const matrix = (await git.statusMatrix({ fs, dir: projectDir })) as GitStatusMatrixRow[]
    const changedFiles: ChangedHistoryFile[] = []
    for (const [filepath, head, workdir, stage] of matrix) {
      if (!isControlledFile(filepath)) continue
      const hasWorkdirDiff = head !== workdir
      const hasStagedDiff = head !== stage
      if (!hasWorkdirDiff && !hasStagedDiff) continue
      const pageId = pageIdFromPath(filepath)
      if (workdir === 2) {
        await git.add({ fs, dir: projectDir, filepath })
      } else if (head === 1 && workdir === 0) {
        await git.remove({ fs, dir: projectDir, filepath })
      }
      const changeType: ChangedHistoryFile['changeType'] =
        head === 0 && (workdir === 2 || stage === 2)
          ? 'added'
          : head === 1 && (workdir === 0 || stage === 0)
            ? 'deleted'
            : 'modified'
      changedFiles.push({ path: filepath, changeType, pageId })
    }
    return { changedFiles }
  }

  private async listTrackedFiles(projectDir: string, commit: string): Promise<string[]> {
    const files = await git.walk({
      fs,
      dir: projectDir,
      trees: [git.TREE({ ref: commit })],
      map: async (filepath, [entry]) => {
        if (filepath === '.' || !entry) return null
        const type = await entry.type()
        if (type !== 'blob') return null
        return isControlledFile(filepath) ? filepath : null
      }
    })
    return (files ?? []).filter((file): file is string => typeof file === 'string').sort()
  }

  private async restoreCommitFiles(
    projectDir: string,
    commit: string,
    targetFiles: string[]
  ): Promise<void> {
    const targetSet = new Set(targetFiles.filter(isControlledFile))
    for (const relativePath of targetSet) {
      const { blob } = await git.readBlob({
        fs,
        dir: projectDir,
        oid: commit,
        filepath: relativePath
      })
      const targetPath = path.resolve(projectDir, relativePath)
      if (!targetPath.startsWith(`${path.resolve(projectDir)}${path.sep}`)) {
        log.warn('[history] skip restore outside project dir', { projectDir, relativePath })
        continue
      }
      await ensureDir(path.dirname(targetPath))
      await fs.promises.writeFile(targetPath, blob)
    }

    const currentFiles = await walkFiles(projectDir)
    await Promise.all(
      currentFiles
        .filter((file) => isControlledFile(file) && !targetSet.has(file))
        .map(async (file) => {
          const targetPath = path.resolve(projectDir, file)
          if (!targetPath.startsWith(`${path.resolve(projectDir)}${path.sep}`)) return
          await fs.promises.rm(targetPath, { force: true })
        })
    )
  }

  private async buildOperationMetadata(args: RecordOperationArgs): Promise<Record<string, unknown>> {
    const session = await this.db.getSession(args.sessionId)
    const sessionMetadata = parseJson<Record<string, unknown>>(session?.metadata, {})
    const providedSessionMetadata = args.metadata?.sessionMetadata
    return {
      ...(args.metadata || {}),
      sessionMetadata:
        providedSessionMetadata &&
        typeof providedSessionMetadata === 'object' &&
        !Array.isArray(providedSessionMetadata)
          ? providedSessionMetadata
          : sessionMetadata
    }
  }

  private buildCommitMessage(args: RecordOperationArgs, changedPages: string[]): string {
    const suffix = changedPages.length > 0 ? ` ${changedPages.join(',')}` : ''
    return `[${args.type}:${args.scope}]${suffix}${args.prompt ? ` - ${args.prompt.slice(0, 80)}` : ''}`
  }

  private toHistoryVersion(
    operation: SessionOperationRecord,
    current: { currentCommit: string | null; currentOperationId: string | null }
  ): HistoryVersion {
    const metadata = parseJson<Record<string, unknown>>(operation.metadata_json, {})
    const changedFiles = parseJson<ChangedHistoryFile[]>(operation.changed_files_json, [])
    const changedPages = parseJson<string[]>(operation.changed_pages_json, [])
    const commit = operation.after_commit || ''
    return {
      id: operation.id,
      sessionId: operation.session_id,
      operationId: operation.id,
      commit,
      title: this.titleForOperation(operation, metadata),
      description: operation.prompt || this.descriptionForOperation(operation, changedPages),
      kind: operation.type,
      scope: operation.scope || 'session',
      createdAt: operation.completed_at || operation.created_at,
      changedFiles,
      changedPages,
      isCurrent: Boolean(
        (current.currentCommit && commit === current.currentCommit) ||
          (current.currentOperationId && operation.id === current.currentOperationId)
      ),
      isRestorable: Boolean(commit)
    }
  }

  private titleForOperation(
    operation: SessionOperationRecord,
    metadata: Record<string, unknown>
  ): string {
    if (operation.type === 'import' && metadata.legacy) return '历史起点'
    if (operation.type === 'import') return '导入 PPTX'
    if (operation.type === 'generate') return '首次生成'
    if (operation.type === 'addPage') return '新增页面'
    if (operation.type === 'retry') return operation.scope === 'page' ? '重试页面' : '重试失败页面'
    if (operation.type === 'rollback') return '回退到历史版本'
    if (operation.type === 'edit') {
      if (operation.scope === 'deck') return '全局修改页面'
      if (operation.scope === 'selector') return '局部修改页面元素'
      if (operation.scope === 'page') return '编辑页面'
    }
    return '历史版本'
  }

  private descriptionForOperation(
    operation: SessionOperationRecord,
    changedPages: string[]
  ): string {
    if (changedPages.length > 0) return `修改了 ${changedPages.join('、')}`
    if (operation.type === 'rollback') return '已恢复到选定版本'
    return '已记录此时间点'
  }
}

export async function recordHistoryOperationSafe(
  db: PPTDatabase,
  args: RecordOperationArgs
): Promise<void> {
  try {
    await new GitHistoryService(db).recordOperation(args)
  } catch (error) {
    log.warn('[history] record operation failed', {
      sessionId: args.sessionId,
      type: args.type,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function recordHistoryOperationStrict(
  db: PPTDatabase,
  args: RecordOperationArgs
): Promise<void> {
  await new GitHistoryService(db).recordOperation(args)
}

export async function ensureHistoryBaselineSafe(
  db: PPTDatabase,
  sessionId: string,
  projectDir: string
): Promise<void> {
  try {
    await new GitHistoryService(db).ensureBaseline(sessionId, projectDir)
  } catch (error) {
    log.warn('[history] ensure baseline failed', {
      sessionId,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
