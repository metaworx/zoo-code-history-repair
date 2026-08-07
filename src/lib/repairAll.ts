import path from "node:path"
import type {RepairOptions} from "../types.js"
import {resolveTasksDir} from "./paths.js"
import {scanStorage} from "./scan.js"
import {repairTaskDir} from "./repairTask.js"
import type {RepairResult} from "./repairTask.js"

export interface RepairAllResult {
    total: number
    repaired: number
    failed: number
    results: RepairResult[]
}

/**
 * Scan storage for corruption, then repair every corrupted task.
 *
 * Returns aggregated results — callers decide how to present them
 * (CLI output, IDE notification, etc.).
 */
export function repairAllCorrupted(
    storageRoot: string,
    options: RepairOptions = {},
): RepairAllResult {
    const scan = scanStorage(storageRoot)
    const corruptIds = scan.corruptions.map(c => c.taskId)

    const results: RepairResult[] = []
    let repaired = 0
    let failed = 0

    for (const taskId of corruptIds) {
        const taskDir = path.join(scan.tasksDir, taskId)
        const r = repairTaskDir(taskDir, {
            dryRun: options.dryRun,
            backup: options.backup !== false,
        })

        results.push(r)
        const fixed = [r.uiRepaired, r.taskRepaired, r.sizeRepaired].filter(Boolean).length
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
