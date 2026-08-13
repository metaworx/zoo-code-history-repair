import fs from "node:fs/promises"
import path from "node:path"
import {
    backupTimestamp,
    consolidateBackups,
    listBackups,
    mapTypeToFileName,
    mapTypeToFileNames,
    parseTimestamp,
    readJsonFile,
    saveFile,
} from "./file.js"
import type {
    BackupEntry,
    BackupType
} from "./file.js"
import {IndexTransaction} from "./IndexTransaction.js"
import {HISTORY_ITEM_NAME} from "./paths.js"

const DEFAULT_TYPE: BackupType = "history_item"

export interface RestoreOptions {
    taskId?: string
    timestamp?: string
    dryRun?: boolean
    type?: BackupType
    mergeIntoIndex?: boolean
}

export interface DeleteOptions {
    taskId?: string
    timestamp?: string
    dryRun?: boolean
    type?: BackupType
}

/**
 * List backups of a single type across the task tree. The basename filter is
 * pushed down into file.ts's listBackups so the scan can skip non-matching
 * files early.
 */
export async function listBackupsForType(
    tasksDir: string,
    type: BackupType = DEFAULT_TYPE,
): Promise<BackupEntry[]> {
    return listBackups(tasksDir, {basenames: mapTypeToFileNames(type)})
}

export async function restoreFromBackups(
    tasksDir: string,
    opts: RestoreOptions,
): Promise<{ restored: BackupEntry[]; skipped: string[] }> {
    const basenames = mapTypeToFileNames(opts.type ?? DEFAULT_TYPE)
    const filtered = (await listBackups(tasksDir, {taskId: opts.taskId, basenames}))
        .filter(e => !opts.timestamp || e.timestamp === opts.timestamp)

    const restored: BackupEntry[] = []
    const skipped: string[] = []

    // Idempotency: skip any (taskId, baseName) group whose current target
    // already matches one of its backups. Safety backups created by a prior
    // restore carry a newer timestamp than their source, so matching must be
    // checked across the whole group rather than just the newest entry.
    const candidates = await filterAlreadyMatching(filtered, skipped)
    const toRestore = deduplicateByNewest(candidates, opts)

    for (const entry of toRestore) {
        try {
            await fs.access(entry.bakPath)
        } catch {
            skipped.push(`${entry.bakPath} (missing)`)
            continue
        }

        const isIndex = entry.baseName === mapTypeToFileName("_index.task")
        const taskDir = path.dirname(entry.bakPath)
        const targetPath = isIndex
            ? path.join(taskDir, HISTORY_ITEM_NAME)
            : entry.basePath

        let entryData: Record<string, unknown> | null = null
        if (isIndex) {
            const raw = await readJsonFile(entry.bakPath) as Record<string, unknown> | null
            if (raw === null) {
                skipped.push(`${entry.bakPath} (invalid JSON)`)
                continue
            }
            entryData = stripBackupMetadata(raw)
        }

        if (!opts.dryRun) {
            // Safety backup of the current file before overwriting any history_item.json
            if (path.basename(targetPath) === HISTORY_ITEM_NAME) {
                await safetyBackup(targetPath)
            }

            if (isIndex) {
                const data = entryData as Record<string, unknown>
                await saveFile(targetPath, data, {stringify: true})
                if (opts.mergeIntoIndex !== false) {
                    const tx = new IndexTransaction(false)
                    const entryId = (data.id as string | undefined) ?? entry.taskId
                    await tx.replaceId(entryId, data, true, false)
                }
            } else {
                await fs.copyFile(entry.bakPath, targetPath)
            }
        }

        restored.push(entry)
    }

    return {restored, skipped}
}

export async function deleteBackups(
    tasksDir: string,
    opts: DeleteOptions,
): Promise<{ deleted: string[]; skipped: string[] }> {
    const basenames = mapTypeToFileNames(opts.type ?? DEFAULT_TYPE)
    const filtered = (await listBackups(tasksDir, {taskId: opts.taskId, basenames}))
        .filter(e => !opts.timestamp || e.timestamp === opts.timestamp)

    const deleted: string[] = []
    const skipped: string[] = []

    for (const entry of filtered) {
        try {
            await fs.access(entry.bakPath)
        } catch {
            skipped.push(`${entry.bakPath} (missing)`)
            continue
        }

        if (!opts.dryRun) {
            await fs.rm(entry.bakPath)
        }
        deleted.push(entry.bakPath)
    }

    return {deleted, skipped}
}

/**
 * Strip the index-repair backup metadata fields before restoring an entry to
 * `history_item.json` / the global index. Per spec v4 §6.2 these fields are
 * only meaningful inside the `.bak.json` file itself.
 */
function stripBackupMetadata(entry: Record<string, unknown>): Record<string, unknown> {
    const copy = {...entry}
    delete copy._removedReason
    delete copy._removedAt
    return copy
}

/**
 * Create a safety backup of the current target file before overwriting it.
 * Copies the current content to `{target}.{backupTimestamp}.bak.json`, then
 * runs Block 0 consolidation so duplicates are deduplicated via content hash.
 */
async function safetyBackup(targetPath: string): Promise<void> {
    const safetyPath = `${targetPath}.${backupTimestamp}.bak.json`
    try {
        await fs.copyFile(targetPath, safetyPath)
    } catch {
        return // target does not exist — nothing to back up
    }
    await consolidateBackups(targetPath, safetyPath)
}

/**
 * Drop entries whose (taskId, baseName) group is already restored — i.e. the
 * current target file matches one of the group's backups. Keeps restores
 * idempotent even after safety backups (newer timestamp, pre-restore content)
 * are created.
 */
async function filterAlreadyMatching(
    entries: BackupEntry[],
    skipped: string[],
): Promise<BackupEntry[]> {
    const groups = new Map<string, BackupEntry[]>()
    for (const entry of entries) {
        const key = `${entry.taskId}\u0000${entry.baseName}`
        const group = groups.get(key) ?? []
        group.push(entry)
        groups.set(key, group)
    }

    const candidates: BackupEntry[] = []
    for (const group of groups.values()) {
        const first = group[0]
        const targetPath = first.baseName === mapTypeToFileName("_index.task")
            ? path.join(path.dirname(first.bakPath), HISTORY_ITEM_NAME)
            : first.basePath

        let current: Buffer | null = null
        try {
            current = await fs.readFile(targetPath)
        } catch {
            // target missing — nothing matches, restore proceeds
        }

        let matched = false
        if (current) {
            for (const entry of group) {
                try {
                    const backup = await fs.readFile(entry.bakPath)
                    if (backup.equals(current)) {
                        matched = true
                        break
                    }
                } catch {
                    // missing backup — not a match
                }
            }
        }

        if (matched) {
            skipped.push(`${targetPath} (already matches backup)`)
        } else {
            candidates.push(...group)
        }
    }

    return candidates
}

/**
 * When restoring with only taskId (no explicit timestamp), pick the newest
 * timestamp for that task. All files restored must share the same timestamp.
 */
function deduplicateByNewest(
    entries: BackupEntry[],
    opts: RestoreOptions,
): BackupEntry[] {
    if (opts.timestamp) return entries // explicit timestamp, no dedup needed

    if (!opts.taskId) {
        // Restoring all tasks by timestamp only (or all backups?).
        // When neither taskId nor timestamp, this means "no-args list mode" which
        // is handled by the command, not by restoreFromBackups. So if we get
        // here with no filters, restore all.
        return entries
    }

    // taskId only: pick the newest timestamp
    const byTs = new Map<string, BackupEntry[]>()
    for (const e of entries) {
        const group = byTs.get(e.timestamp) ?? []
        group.push(e)
        byTs.set(e.timestamp, group)
    }

    if (byTs.size === 0) return []

    // Find newest timestamp by parsing dates
    let newest: string | null = null
    let newestDate: Date | null = null
    for (const ts of byTs.keys()) {
        const d = parseTimestamp(ts)
        if (d && (!newestDate || d > newestDate)) {
            newestDate = d
            newest = ts
        }
    }

    return newest ? byTs.get(newest)! : entries
}
