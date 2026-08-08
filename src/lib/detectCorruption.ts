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

    // Find turns with tool_use blocks and check for matching tool_results
    const toolUseIds = new Map<string, string>() // tool_use_id → block name

    for (const turn of apiHistory) {
        if (!turn || typeof turn !== "object") continue
        const t = turn as Record<string, unknown>
        const content = t.content
        if (!Array.isArray(content)) continue

        for (const block of content) {
            if (!block || typeof block !== "object") continue
            const b = block as Record<string, unknown>

            if (b.type === "tool_use" && typeof b.id === "string") {
                toolUseIds.set(b.id, (b.name as string) ?? "unknown")
            }
            if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
                toolUseIds.delete(b.tool_use_id)
            }
        }
    }

    // Remaining tool_use_ids = no matching tool_result
    for (const [, name] of toolUseIds) {
        if (name === "attempt_completion" || name === "attemptCompletion") {
            return true
        }
    }

    // Also check: last turn is assistant ending with tool_use (no response)
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

    const uiPath = path.join(dir, UI_MESSAGES_NAME)
    const ui = readJsonFile<unknown[]>(uiPath)
    if (Array.isArray(ui) && ui.length === 0) reasons.push("empty_ui_messages")

    const apiPath = path.join(dir, API_HISTORY_NAME)
    const api = readJsonFile<unknown[]>(apiPath)
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

    return {
        taskId,
        dir,
        reasons: unique,
        indexItem: indexItem ?? null,
        diskItem,
    }
}