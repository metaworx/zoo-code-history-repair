import path from "node:path"
import type {HistoryItem, RepairOptions} from "../types.js"
import {resolveIndexPath, resolveTasksDir} from "./paths.js"
import {readJsonFile} from "./readJson.js"
import {scanStorage} from "./scan.js"
import {repairTaskDir} from "./repairTask.js"
import type {RepairResult} from "./repairTask.js"

export interface RepairAllOptions extends RepairOptions {
    fixedInputToken?: number
}

export interface RepairAllResult {
    total: number
    repaired: number
    failed: number
    results: RepairResult[]
}

/**
 * Scan storage for corruption, then repair every corrupted task.
 */
export function repairAllCorrupted(
    storageRoot: string,
    options: RepairAllOptions = {},
): RepairAllResult {
    const scan = scanStorage(storageRoot)
    const corruptIds = scan.corruptions.map(c => c.taskId)

    // Load index entries for token recovery
    const indexPath = resolveIndexPath(scan.tasksDir)
    const indexData = readJsonFile<HistoryItem[] | { entries: HistoryItem[] }>(indexPath)
    const indexItems: HistoryItem[] = Array.isArray(indexData)
        ? indexData
        : indexData?.entries ?? []

    const results: RepairResult[] = []
    let repaired = 0
    let failed = 0

    for (const taskId of corruptIds) {
        const taskDir = path.join(scan.tasksDir, taskId)
        const r = repairTaskDir(taskDir, {
            dryRun: options.dryRun,
            backup: options.backup !== false,
            fixedInputToken: options.fixedInputToken,
            indexItems,
        })

        results.push(r)
        const fixed = [r.uiRepaired, r.taskRepaired, r.sizeRepaired, r.tokensRepaired].filter(Boolean).length
        if (fixed > 0) {
            repaired++
        } else {
            failed++
        }
    }

    return {
        total: corruptIds.length,
        repaired,
        failed,
        results,
    }
}
