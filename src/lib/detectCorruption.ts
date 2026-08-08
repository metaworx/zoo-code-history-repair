import path from "node:path"
import type {CorruptionReason, HistoryItem, TaskCorruption} from "../types.js"
import {API_HISTORY_NAME, HISTORY_ITEM_NAME, UI_MESSAGES_NAME,} from "./paths.js"
import {readJsonFile} from "./readJson.js"
import {rebuildUiMessages} from "./rebuildUiMessages.js"

const PLACEHOLDER_TASK_RE =
    /^Task\s*#\s*\d+(\s*\((Incomplete|No messages)\))?$/i

export function isPlaceholderTaskName(task?: string): boolean {
    if (!task || !task.trim()) return true
    return PLACEHOLDER_TASK_RE.test(task.trim())
}

export interface InspectOptions {
    verifyUiSync?: boolean
}

function detectUiSyncMismatch(uiPath: string, apiHistory: unknown[]): boolean {
    const existing = readJsonFile<unknown[]>(uiPath)
    if (!Array.isArray(existing) || existing.length === 0) return false

    const reconstructed = rebuildUiMessages(
        apiHistory as Parameters<typeof rebuildUiMessages>[0],
    )
    if (reconstructed.length === 0) return false

    // Compare event count and say+text content (ignore ts differences)
    if (existing.length !== reconstructed.length) return true

    for (let i = 0; i < existing.length; i++) {
        const ex = existing[i] as Record<string, unknown> | null
        const re = reconstructed[i]
        if (!ex || typeof ex !== "object") return true
        if (ex.say !== re.say || ex.text !== re.text) return true
    }

    return false
}

function detectInterruptedTask(apiHistory: unknown[]): boolean {
    if (!Array.isArray(apiHistory) || apiHistory.length === 0) return false

    // Only Trigger B: last turn is assistant ending with tool_use.
    // Trigger A (unanswered attempt_completion) removed — normal child-task
    // behavior; the tool_result goes to the parent's ACH, not the child's.
    const lastTurn = apiHistory[apiHistory.length - 1] as Record<string, unknown> | null
    if (lastTurn && lastTurn.role === "assistant" && Array.isArray(lastTurn.content)) {
        const blocks = lastTurn.content as Array<Record<string, unknown>>
        if (blocks.length > 0) {
            const lastBlock = blocks[blocks.length - 1]
            if (lastBlock && lastBlock.type === "tool_use") {
                return true
            }
        }
    }

    return false
}

export function inspectTaskDir(
    taskId: string,
    dir: string,
    indexItem?: HistoryItem | null,
    options: InspectOptions = {},
): TaskCorruption {
    const reasons: CorruptionReason[] = []
    const historyPath = path.join(dir, HISTORY_ITEM_NAME)
    const diskItem = readJsonFile<HistoryItem>(historyPath)

    const apiPath = path.join(dir, API_HISTORY_NAME)
    const api = readJsonFile<unknown[]>(apiPath)

    if (!diskItem) {
        reasons.push("missing_history_item")
    } else {
        if (isPlaceholderTaskName(diskItem.task)) reasons.push("placeholder_task_name")
        if (diskItem.size === 0 || diskItem.size == null) reasons.push("zero_size")
        if (!diskItem.task?.trim()) reasons.push("missing_task_text")

        // v0.3.0: zero token detection
        if (
            diskItem.tokensIn === 0 &&
            diskItem.tokensOut === 0 &&
            diskItem.totalCost === 0 &&
            Array.isArray(api) &&
            api.length > 0
        ) {
            reasons.push("zero_tokens")
        }
    }

    if (indexItem) {
        if (isPlaceholderTaskName(indexItem.task)) reasons.push("placeholder_task_name")
        if (indexItem.size === 0 || indexItem.size == null) reasons.push("zero_size")
    }

    const uiPath = path.join(dir, UI_MESSAGES_NAME)
    const ui = readJsonFile<unknown[]>(uiPath)
    if (Array.isArray(ui) && ui.length === 0) reasons.push("empty_ui_messages")

    if (Array.isArray(api) && api.length === 0) {
        reasons.push("empty_api_history")
    }

    // v0.2.0: opt-in ui_messages.json sync verification
    if (options.verifyUiSync && Array.isArray(api) && api.length > 0) {
        if (detectUiSyncMismatch(uiPath, api)) {
            reasons.push("ui_sync_mismatch")
        }
    }

    // v0.2.0: interrupted task detection
    if (Array.isArray(api) && api.length > 0) {
        if (detectInterruptedTask(api)) {
            reasons.push("interrupted_task")
        }
    }

    // de-dupe
    const unique = [...new Set(reasons)]

    // v0.3.0: gate interrupted_task — only flag when co-occurring
    // with other corruption. Solo interrupted_task = user simply moved on.
    if (unique.includes("interrupted_task") && unique.length === 1) {
        unique.splice(unique.indexOf("interrupted_task"), 1)
    }

    return {
        taskId,
        dir,
        reasons: unique,
        indexItem: indexItem ?? null,
        diskItem,
    }
}