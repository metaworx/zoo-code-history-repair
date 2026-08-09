import path from "node:path"
import fs from "node:fs";
import type {CorruptionReason, HistoryItem, TaskCorruption} from "../types.js"
import {API_HISTORY_NAME, HISTORY_ITEM_NAME, UI_MESSAGES_NAME,} from "./paths.js"
import {JsonFileTransaction, readJsonFile, resolveTarget} from "./file.js";
import {rebuildUiMessages} from "./rebuildUiMessages.js"
import {validateIndex} from "./validate/index.js";
import {validateHistoryItem} from "./validate/historyItem.js";
import {validateApiConversationHistory} from "./validate/apiConversationHistory.js";
import {validateUiMessages} from "./validate/uiMessages.js";
import {validateTaskMetadata} from "./validate/taskMetadata.js";
import {resolveRoot} from "./cliContext.js";

const PLACEHOLDER_TASK_RE =
    /^Task\s*#\s*\d+(\s*\((Incomplete|No messages)\))?$/i

export type Severity = "error" | "warning"

export type ValidateResult = { file: string; result: ValidationResult }

export type ValidatorFn = (data: unknown) => ValidationResult

export interface InspectOptions {
    verifyUiSync?: boolean
}

export interface ValidationIssue {
    /** Machine-readable issue code, e.g. "MISSING_ID", "INVALID_UUID", "STATUS_UNKNOWN" */
    code: string
    severity: Severity
    /** Dotted path to the field, e.g. "entries[3].tokensIn" or "tokensIn" */
    field: string
    message: string
    context?: Record<string, unknown>
}

export interface ValidationResult {
    /** False if any error-level issues exist */
    valid: boolean
    issues: ValidationIssue[]
    errorCount: number
    warningCount: number
}

export function isPlaceholderTaskName(task?: string): boolean {
    if (!task || !task.trim()) return true
    return PLACEHOLDER_TASK_RE.test(task.trim())
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

/** Build sorted comma-separated source string from a set of source abbreviations. */
function joinSources(sources: Set<string>): string {
    return [...sources].sort().join(",")
}

export function inspectTaskDir(
    taskId: string,
    dir: string,
    indexItem?: HistoryItem | null,
    options: InspectOptions = {},
): TaskCorruption {
    const reasonMap = new Map<CorruptionReason, Set<string>>()
    const historyPath = path.join(dir, HISTORY_ITEM_NAME)
    const diskItem = readJsonFile<HistoryItem>(historyPath)

    const apiPath = path.join(dir, API_HISTORY_NAME)
    const api = readJsonFile<unknown[]>(apiPath)

    const add = (reason: CorruptionReason, source: string) => {
        const sources = reasonMap.get(reason)
        if (sources) {
            sources.add(source)
        } else {
            reasonMap.set(reason, new Set([source]))
        }
    }

    if (!diskItem) {
        add("missing_history_item", "hi")
    } else {
        if (isPlaceholderTaskName(diskItem.task)) add("placeholder_task_name", "hi")
        if (diskItem.size === 0 || diskItem.size == null) add("zero_size", "hi")
        if (!diskItem.task?.trim()) add("missing_task_text", "hi")

        // v0.3.0: zero token detection
        if (
            diskItem.tokensIn === 0 &&
            diskItem.tokensOut === 0 &&
            diskItem.totalCost === 0 &&
            Array.isArray(api) &&
            api.length > 0
        ) {
            add("zero_tokens", "hi")
        }
    }

    if (indexItem) {
        if (isPlaceholderTaskName(indexItem.task)) add("placeholder_task_name", "idx")
        if (indexItem.size === 0 || indexItem.size == null) add("zero_size", "idx")
    }

    const uiPath = path.join(dir, UI_MESSAGES_NAME)
    const ui = readJsonFile<unknown[]>(uiPath)
    if (Array.isArray(ui) && ui.length === 0) add("empty_ui_messages", "uim")

    if (Array.isArray(api) && api.length === 0) {
        add("empty_api_history", "ach")
    }

    // v0.2.0: opt-in ui_messages.json sync verification
    if (options.verifyUiSync && Array.isArray(api) && api.length > 0) {
        if (detectUiSyncMismatch(uiPath, api)) {
            add("ui_sync_mismatch", "uim,ach")
        }
    }

    // v0.2.0: interrupted task detection
    if (Array.isArray(api) && api.length > 0) {
        if (detectInterruptedTask(api)) {
            add("interrupted_task", "ach")
        }
    }

    // Convert map to sorted array
    const reasons = [...reasonMap.entries()].map(([reason, sources]) => ({
        reason,
        source: joinSources(sources),
    }))

    // v0.3.0: gate interrupted_task — only flag when co-occurring
    // with other corruption. Solo interrupted_task = user simply moved on.
    if (reasons.length === 1 && reasons[0].reason === "interrupted_task") {
        reasons.length = 0
    }

    return {
        taskId,
        dir,
        reasons,
        indexItem: indexItem ?? null,
        diskItem,
    }
}

export function validationOk(): ValidationResult {
    return {valid: true, issues: [], errorCount: 0, warningCount: 0}
}

export function error(code: string, field: string, message: string, context?: Record<string, unknown>): ValidationIssue {
    return {code, severity: "error", field, message, context}
}

export function warning(code: string, field: string, message: string, context?: Record<string, unknown>): ValidationIssue {
    return {code, severity: "warning", field, message, context}
}

export function getValidatorByFile(filePath: string): ValidatorFn | undefined {
    const base = path.basename(filePath)

    if (base === "_index.json")
        return validateIndex

    if (base === "history_item.json")
        return validateHistoryItem

    if (base === "api_conversation_history.json")
        return validateApiConversationHistory

    if (base === "ui_messages.json")
        return validateUiMessages

    if (base === "task_metadata.json")
        return validateTaskMetadata

    return undefined;
}

export function validatePath(target: string | undefined): ValidateResult[] {
    const root = resolveRoot()
    const resolved = resolveTarget(target, root)

    const results: ValidateResult[] = []

    const stat = fs.statSync(resolved, {throwIfNoEntry: false})

    if (!stat) {
        throw new Error(`File not found: ${resolved}`)
    }

    if (stat.isDirectory()) {
        // Validate all task dirs + index
        const indexPath = path.join(resolved, "_index.json")
        if (fs.existsSync(indexPath)) {
            const file = new JsonFileTransaction(indexPath, true)
            results.push({file: indexPath, result: file.validate()})
        }

        const entries = fs.readdirSync(resolved, {withFileTypes: true})
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith(".")) continue
            const taskDir = path.join(resolved, entry.name)
            for (const f of ["history_item.json", "api_conversation_history.json", "ui_messages.json", "task_metadata.json"]) {
                const fp = path.join(taskDir, f)
                if (fs.existsSync(fp)) {
                    const file = new JsonFileTransaction(fp, true)
                    results.push({file: fp, result: file.validate()})
                }
            }
        }
    } else {
        const file = new JsonFileTransaction(resolved, true)
        results.push({file: resolved, result: file.validate()})
    }

    return results;
}
