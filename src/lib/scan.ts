import path from "node:path"
import type {HistoryItem, ScanResult, TaskCorruption} from "../types.js"
import {listTaskDirs, resolveIndexPath, resolveTasksDir,} from "./paths.js"
import {IndexTransaction} from "./IndexTransaction.js"
import {setRoot} from "./cliContext.js"
import {inspectTaskDir} from "./validation.js"
import type {InspectOptions} from "./validation.js"

export interface ScanOptions extends InspectOptions {
    // future scan-level options
}

export function scanStorage(storageRoot: string, options: ScanOptions = {}): ScanResult {
    setRoot(storageRoot)
    const tasksDir = resolveTasksDir(storageRoot)
    const indexPath = resolveIndexPath(tasksDir)

    const idx = new IndexTransaction()
    const indexItems = idx.getEntries() as HistoryItem[]

    const dirs = listTaskDirs(tasksDir)
    const byId = new Map(indexItems.map((i) => [i.id, i]))

    const corruptions: TaskCorruption[] = []

    // folders on disk
    for (const dir of dirs) {
        const taskId = path.basename(dir)
        const c = inspectTaskDir(taskId, dir, byId.get(taskId) ?? null, {
            verifyUiSync: options.verifyUiSync,
        })
        if (!byId.has(taskId)) c.reasons.push({reason: "folder_orphan", source: "hi"})
        if (c.reasons.length) corruptions.push(c)
    }

    // index entries without folders
    const dirIds = new Set(dirs.map((d) => path.basename(d)))
    for (const item of indexItems) {
        if (!dirIds.has(item.id)) {
            const reasons: Array<{reason: import("../types.js").CorruptionReason; source: string}> = [
                {reason: "index_orphan", source: "idx"},
            ]
            if (item.size === 0) reasons.push({reason: "zero_size", source: "idx"})
            corruptions.push({
                taskId: item.id,
                reasons,
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
