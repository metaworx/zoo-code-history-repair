import path from "node:path"
import type {HistoryItem, ScanResult, TaskCorruption} from "../types.js"
import {listTaskDirs, resolveIndexPath, resolveTasksDir,} from "./paths.js"
import {readJsonFile} from "./readJson.js"
import {inspectTaskDir} from "./detectCorruption.js"

export function scanStorage(storageRoot: string): ScanResult {
    const tasksDir = resolveTasksDir(storageRoot)
    const indexPath = resolveIndexPath(tasksDir)

    const indexRaw = readJsonFile<HistoryItem[] | { items?: HistoryItem[] }>(indexPath)
    const indexItems: HistoryItem[] = Array.isArray(indexRaw)
        ? indexRaw
        : Array.isArray(indexRaw?.items)
            ? indexRaw!.items!
            : []

    const dirs = listTaskDirs(tasksDir)
    const byId = new Map(indexItems.map((i) => [i.id, i]))

    const corruptions: TaskCorruption[] = []

    // folders on disk
    for (const dir of dirs) {
        const taskId = path.basename(dir)
        const c = inspectTaskDir(taskId, dir, byId.get(taskId) ?? null)
        if (!byId.has(taskId)) c.reasons.push("folder_orphan")
        if (c.reasons.length) corruptions.push(c)
    }

    // index entries without folders
    const dirIds = new Set(dirs.map((d) => path.basename(d)))
    for (const item of indexItems) {
        if (!dirIds.has(item.id)) {
            corruptions.push({
                taskId: item.id,
                reasons: ["index_orphan", ...(item.size === 0 ? (["zero_size"] as const) : [])],
                indexItem: item,
                diskItem: null,
            })
        }
    }

    return {
        storageRoot,
        tasksDir,
        indexPath,
        indexItems,
        taskDirs: dirs,
        corruptions,
    }
}