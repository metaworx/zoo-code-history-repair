import path from "node:path"
import type {CorruptionReason, HistoryItem, TaskCorruption} from "../types.js"
import {API_HISTORY_NAME, HISTORY_ITEM_NAME, UI_MESSAGES_NAME,} from "./paths.js"
import {readJsonFile} from "./readJson.js"

const PLACEHOLDER_TASK_RE =
    /^Task\s*#\s*\d+(\s*\((Incomplete|No messages)\))?$/i

export function isPlaceholderTaskName(task?: string): boolean {
    if (!task || !task.trim()) return true
    return PLACEHOLDER_TASK_RE.test(task.trim())
}

export function inspectTaskDir(
    taskId: string,
    dir: string,
    indexItem?: HistoryItem | null,
): TaskCorruption {
    const reasons: CorruptionReason[] = []
    const historyPath = path.join(dir, HISTORY_ITEM_NAME)
    const diskItem = readJsonFile<HistoryItem>(historyPath)

    if (!diskItem) {
        reasons.push("missing_history_item")
    } else {
        if (isPlaceholderTaskName(diskItem.task)) reasons.push("placeholder_task_name")
        if (diskItem.size === 0 || diskItem.size == null) reasons.push("zero_size")
        if (!diskItem.task?.trim()) reasons.push("missing_task_text")
    }

    if (indexItem) {
        if (isPlaceholderTaskName(indexItem.task)) reasons.push("placeholder_task_name")
        if (indexItem.size === 0 || indexItem.size == null) reasons.push("zero_size")
    }

    const ui = readJsonFile<unknown[]>(path.join(dir, UI_MESSAGES_NAME))
    if (Array.isArray(ui) && ui.length === 0) reasons.push("empty_ui_messages")

    const api = readJsonFile<unknown[]>(path.join(dir, API_HISTORY_NAME))
    if (Array.isArray(api) && api.length === 0) reasons.push("empty_api_history")

    // de-dupe
    const unique = [...new Set(reasons)]

    return {
        taskId,
        dir,
        reasons: unique,
        indexItem: indexItem ?? null,
        diskItem,
    }
}