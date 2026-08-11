import fs from "node:fs/promises"
import {Dirent} from "node:fs"
import path from "node:path"
import {listTaskDirs} from "./paths.js"

export interface BackupEntry {
    taskId: string
    timestamp: string
    bakPath: string
    baseName: string
    basePath: string
}

export interface ListBackupsResult {
    entries: BackupEntry[]
}

export interface RestoreOptions {
    taskId?: string
    timestamp?: string
    dryRun?: boolean
}

export interface DeleteOptions {
    taskId?: string
    timestamp?: string
    dryRun?: boolean
}

const TIMESTAMP_RE = /\.(\d{8}-\d{6})\.bak\.json$/

export function parseTimestamp(ts: string): Date | null {
    const m = ts.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
    if (!m) return null
    return new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
    )
}

export async function listBackups(tasksDir: string): Promise<BackupEntry[]> {
    const entries: BackupEntry[] = []
    const taskDirs = listTaskDirs(tasksDir)

    for (const taskDir of taskDirs) {
        const taskId = path.basename(taskDir)
        let dirEntries: Dirent[]
        try {
            dirEntries = await fs.readdir(taskDir, {withFileTypes: true})
        } catch {
            continue
        }

        for (const de of dirEntries) {
            if (!de.isFile()) continue
            const m = de.name.match(TIMESTAMP_RE)
            if (!m) continue

            const timestamp = m[1]
            // baseName is everything before .YYYYMMDD-HHmmss.bak.json
            const baseName = de.name.slice(0, de.name.indexOf(`.${timestamp}.bak.json`))

            entries.push({
                taskId,
                timestamp,
                bakPath: path.join(taskDir, de.name),
                baseName,
                basePath: path.join(taskDir, baseName),
            })
        }
    }

    return entries
}

export async function restoreFromBackups(
    tasksDir: string,
    opts: RestoreOptions,
): Promise<{restored: BackupEntry[]; skipped: string[]}> {
    const all = await listBackups(tasksDir)
    const filtered = filterEntries(all, opts)
    const restored: BackupEntry[] = []
    const skipped: string[] = []

    // Group by taskId, deduplicate: pick newest timestamp per task when no timestamp specified
    const toRestore = deduplicateByNewest(filtered, opts)

    for (const entry of toRestore) {
        try {
            await fs.access(entry.bakPath)
        } catch {
            skipped.push(`${entry.bakPath} (missing)`)
            continue
        }

        // Idempotency: skip if current file already matches backup content
        try {
            await fs.access(entry.basePath)
            const currentContent = await fs.readFile(entry.basePath)
            const backupContent = await fs.readFile(entry.bakPath)
            if (currentContent.equals(backupContent)) {
                skipped.push(`${entry.basePath} (already matches backup)`)
                continue
            }
        } catch {
            // base file doesn't exist — proceed with restore
        }

        if (!opts.dryRun) {
            await fs.copyFile(entry.bakPath, entry.basePath)
        }
        restored.push(entry)
    }

    return {restored, skipped}
}

export async function deleteBackups(
    tasksDir: string,
    opts: DeleteOptions,
): Promise<{deleted: string[]; skipped: string[]}> {
    const all = await listBackups(tasksDir)
    const filtered = filterEntries(all, {taskId: opts.taskId, timestamp: opts.timestamp})
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

function filterEntries(
    entries: BackupEntry[],
    opts: {taskId?: string; timestamp?: string},
): BackupEntry[] {
    let result = entries

    if (opts.taskId) {
        result = result.filter(e => e.taskId === opts.taskId)
    }
    if (opts.timestamp) {
        result = result.filter(e => e.timestamp === opts.timestamp)
    }

    return result
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
