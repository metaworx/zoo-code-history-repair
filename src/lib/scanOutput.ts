import path from "node:path"
import type {CorruptionReason, TaskCorruption} from "../types.js"
import {API_HISTORY_NAME, UI_MESSAGES_NAME} from "./paths.js"
import {readJsonFile} from "./file.js";

/** Count entries in a JSON array file. Returns 0 if missing or not an array. */
export function countEntries(dir: string | undefined, filename: string): number {
    if (!dir) return 0
    const data = readJsonFile<unknown[]>(path.join(dir, filename))
    return Array.isArray(data) ? data.length : 0
}

/**
 * Compute a recoverability percentage for a corrupted task.
 * Each CorruptionReason contributes to recoverable or unrecoverable based
 * on whether we have the data needed to fix it (ACH, index, etc.).
 */
export function recoverabilityScore(c: TaskCorruption): string {
    const reasons = c.reasons
    if (reasons.length === 0) return "100%"

    const hasIndex = c.indexItem != null
    const hasAch = c.dir ? countEntries(c.dir, API_HISTORY_NAME) > 0 : false
    const hasUim = c.dir ? countEntries(c.dir, UI_MESSAGES_NAME) > 0 : false
    const idxHasTokens = (c.indexItem?.tokensIn ?? 0) > 0

    let recoverable = 0
    const total = reasons.length

    for (const {reason} of reasons) {
        switch (reason as CorruptionReason) {
            case "placeholder_task_name":
                recoverable += hasAch ? 1 : 0; break
            case "zero_tokens":
                recoverable += idxHasTokens ? 1 : (hasAch ? 0.5 : 0); break
            case "zero_size":
                recoverable += 1; break
            case "missing_task_text":
                recoverable += hasAch ? 1 : 0; break
            case "empty_ui_messages":
                recoverable += hasAch ? 1 : 0; break
            case "empty_api_history":
            case "missing_history_item":
            case "invalid_json":
            case "missing_task_dir":
            case "index_orphan":
                recoverable += 0; break
            case "interrupted_task":
                recoverable += 0; break
            case "ui_sync_mismatch":
                recoverable += hasAch ? 1 : 0; break
            case "folder_orphan":
                recoverable += hasIndex ? 1 : 0; break
            default:
                recoverable += 0
        }
    }

    const pct = Math.round((recoverable / total) * 100)
    return `${pct}%`
}

/** Format a label:value pair with aligned values (label width = 16). */
export function align(label: string, value: string): string {
    return `  ${label.padEnd(17)}${value}`
}

/** Same as align() but without the 2-space indent — for top-level summary blocks. */
export function alignSummary(label: string, value: string): string {
    return `${label.padEnd(19)}${value}`
}
