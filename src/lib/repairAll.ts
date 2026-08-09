import path from "node:path"
import type {HistoryItem, RepairOptions} from "../types.js"
import {resolveIndexPath, resolveTasksDir} from "./paths.js"
import {readJsonFile} from "./file.js";
import {rebuildIndexFromDisk} from "./rebuildIndex.js"
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
    /** Number of entries in rebuilt _index.json (0 if dry-run skipped rebuild). */
    indexEntries: number
    /** Task IDs added to _index.json (previously folder_orphan). */
    indexAdded: string[]
    /** Task IDs removed from _index.json (previously index_orphan). */
    indexRemoved: string[]
}

/**
 * Scan storage for corruption, then repair every corrupted task and rebuild _index.json.
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
    const oldIndexIds = new Set(indexItems.map(i => i.id))

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

    // Rebuild _index.json from (now-repaired) disk state
    let indexEntries = 0
    let indexAdded: string[] = []
    let indexRemoved: string[] = []

    const rebuildResult = rebuildIndexFromDisk(storageRoot, {
        dryRun: options.dryRun,
        backup: options.backup !== false,
    })

    if (rebuildResult.items.length > 0) {
        indexEntries = rebuildResult.items.length
        const newIndexIds = new Set(rebuildResult.items.map(i => i.id))

        // added: in new index but not in old index
        for (const id of newIndexIds) {
            if (!oldIndexIds.has(id)) indexAdded.push(id)
        }
        // removed: in old index but not in new index
        for (const id of oldIndexIds) {
            if (!newIndexIds.has(id)) indexRemoved.push(id)
        }
    }

    return {
        total: corruptIds.length,
        repaired,
        failed,
        results,
        indexEntries,
        indexAdded,
        indexRemoved,
    }
}
