import path from "node:path"
import type {HistoryItem, IndexFile, RepairOptions} from "../types.js"
import {HISTORY_ITEM_NAME, listTaskDirs, resolveIndexPath, resolveTasksDir} from "./paths.js"
import {backupFile, JsonFileTransaction, writeJsonCompact} from "./file.js";
import {validateHistoryItem} from "./validate/historyItem.js";

export function rebuildIndexFromDisk(
    storageRoot: string,
    options: RepairOptions = {},
): { items: HistoryItem[]; written: boolean; backupPath?: string | null; warnings: string[] } {
    const tasksDir = resolveTasksDir(storageRoot)
    const indexPath = resolveIndexPath(tasksDir)
    const dirs = listTaskDirs(tasksDir)

    const items: HistoryItem[] = []

    const warnings: string[] = []

    for (const dir of dirs) {
        const id = path.basename(dir)
        const hiTx = new JsonFileTransaction(path.join(dir, HISTORY_ITEM_NAME), true)
        const disk = hiTx.read(false) as HistoryItem | null

        // R-3: Run validator on each disk entry, collect warnings
        if (disk && disk.id) {
            const vResult = validateHistoryItem(disk)
            if (vResult.errorCount > 0) {
                warnings.push(`${id}: ${vResult.issues.filter(i => i.severity === "error").map(i => i.message).join("; ")}`)
            }
        }
        // Only include tasks with a valid history_item.json that has both id and ts.
        // Tasks without history_item.json (e.g. folder_orphan with only .gitkeep)
        // MUST NOT be added to the index.
        if (disk && disk.id && disk.ts != null) {
            items.push(disk)
        } else if (disk && disk.id) {
            items.push({...disk, id, ts: disk.ts ?? 0})
        }
        // else: skip missing/invalid — do not index tasks without history_item.json
    }

    // newest first (common UI expectation)
    items.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))

    if (options.dryRun) {
        return {items, written: false, warnings}
    }

    let backupPath: string | null | undefined
    if (options.backup !== false) {
        backupPath = backupFile(indexPath)
    }

    const index: IndexFile = {
        version: 1,
        updatedAt: Date.now(),
        entries: items,
    }
    writeJsonCompact(indexPath, index)
    return {items, written: true, backupPath, warnings}
}

/**
 * Repair an existing index by validating each entry against its on-disk counterpart.
 * - Clean index entries with valid disk data: keep as-is
 * - Corrupt index entries with valid disk data: replace from disk
 * - Both corrupt: back up to task dir and remove from index
 */
export function repairIndex(
    storageRoot: string,
    indexItems: HistoryItem[],
    options: RepairOptions = {},
): { items: HistoryItem[]; warnings: string[]; replacedFromDisk: number; backedUpToDisk: number } {
    const tasksDir = resolveTasksDir(storageRoot)
    const items: HistoryItem[] = []
    const warnings: string[] = []
    let replacedFromDisk = 0
    let backedUpToDisk = 0

    for (const entry of indexItems) {
        const taskDir = path.join(tasksDir, entry.id)
        const hiTx = new JsonFileTransaction(path.join(taskDir, HISTORY_ITEM_NAME), true)
        const diskItem = hiTx.read(false) as HistoryItem | null

        const idxResult = validateHistoryItem(entry)
        const diskResult = diskItem ? validateHistoryItem(diskItem) : null

        if (idxResult.errorCount === 0) {
            // Clean index entry — keep
            items.push(entry)
        } else if (diskResult && diskResult.errorCount === 0 && diskItem) {
            // Corrupt index, valid disk — replace from disk
            items.push(diskItem)
            replacedFromDisk++
            warnings.push(`${entry.id}: replaced from disk`)
        } else {
            // Both corrupt — back up to disk, remove from index
            if (!options.dryRun && options.backup !== false) {
                backupFile(hiTx.filePath)
            }
            backedUpToDisk++
            warnings.push(`${entry.id}: both corrupt, removed from index`)
        }
    }

    return {items, warnings, replacedFromDisk, backedUpToDisk}
}
