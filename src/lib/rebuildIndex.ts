import path from "node:path"
import type {HistoryItem, RepairOptions} from "../types.js"
import {HISTORY_ITEM_NAME, listTaskDirs, resolveIndexPath, resolveTasksDir} from "./paths.js"
import {backupFile, readJsonFile, writeJsonCompact} from "./readJson.js"

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
        if (disk && disk.id) {
            items.push(disk)
        } else if (disk) {
            items.push({...disk, id})
        }
        // else: skip empty / missing — optionally reconstruct later from ui/api
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

    writeJsonCompact(indexPath, items)
    return {items, written: true, backupPath}
}