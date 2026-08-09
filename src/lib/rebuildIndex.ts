import path from "node:path"
import type {HistoryItem, IndexFile, RepairOptions} from "../types.js"
import {HISTORY_ITEM_NAME, listTaskDirs, resolveIndexPath, resolveTasksDir} from "./paths.js"
import {backupFile, readJsonFile, writeJsonCompact} from "./file.js";

export function rebuildIndexFromDisk(
    storageRoot: string,
    options: RepairOptions = {},
): { items: HistoryItem[]; written: boolean; backupPath?: string | null } {
    const tasksDir = resolveTasksDir(storageRoot)
    const indexPath = resolveIndexPath(tasksDir)
    const dirs = listTaskDirs(tasksDir)

    const items: HistoryItem[] = []

    for (const dir of dirs) {
        const id = path.basename(dir)
        const disk = readJsonFile<HistoryItem>(path.join(dir, HISTORY_ITEM_NAME))
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
        return {items, written: false}
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
    return {items, written: true, backupPath}
}
