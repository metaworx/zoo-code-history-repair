import path from "node:path"
import fs from "node:fs";
import type {CorruptionReason, HistoryItem, TaskCorruption} from "../types.js"
import {API_HISTORY_NAME, HISTORY_ITEM_NAME, TASK_METADATA_NAME, UI_MESSAGES_NAME,} from "./paths.js"
import {JsonFileTransaction, resolveTarget} from "./file.js";
import {rebuildUiMessages} from "./rebuildUiMessages.js"
import {validateIndex} from "./validate/index.js";
import {validateHistoryItem} from "./validate/historyItem.js";
import {validateApiConversationHistory, validateInterruptedTask} from "./validate/apiConversationHistory.js";
import {validateUiMessages, validateUiSync} from "./validate/uiMessages.js";
import {validateTaskMetadata} from "./validate/taskMetadata.js";
import {resolveRoot} from "./cliContext.js";

const PLACEHOLDER_TASK_RE =
    /^Task\s*#\s*\d+(\s*\((Incomplete|No messages)\))?$/i

export type Severity = "error" | "warning"

export type ValidateResult = { file: string; result: ValidationResult }

export type ValidatorFn = (data: unknown) => ValidationResult

export interface InspectOptions {
    verifyUiSync?: boolean
    /** When false, warning-level validation issues are not mapped to corruption reasons. Default true. */
    showWarnings?: boolean
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
    valid: boolean | null
    issues: ValidationIssue[]
    errorCount: number
    warningCount: number
}

export function isPlaceholderTaskName(task?: string): boolean {
    if (!task || !task.trim()) return true
    return PLACEHOLDER_TASK_RE.test(task.trim())
}

/** Build sorted comma-separated source string from a set of source abbreviations. */
function joinSources(sources: Set<string>): string {
    return [...sources].sort().join(",")
}

/** Map validator issue codes to CorruptionReason (context-free). */
function issueToReason(issue: { code: string }): CorruptionReason | null {
    const map: Record<string, CorruptionReason> = {
        "PLACEHOLDER_TASK": "placeholder_task_name",
        "ZERO_SIZE": "zero_size",
        "MISSING_TASK": "missing_task_text",
        "ZERO_TOKENS_IN": "zero_tokens",
        "ZERO_TOKENS_OUT": "zero_tokens",
        "ZERO_TOTAL_COST": "zero_tokens",
        "EMPTY_ARRAY": "empty_ui_messages",
        "INTERRUPTED_TASK": "interrupted_task",
        "UI_SYNC_MISMATCH": "ui_sync_mismatch",
    }
    return map[issue.code] ?? null
}

/** File basename to source abbreviation for CorruptionReason.source */
function fileSource(filePath: string): string {
    const base = path.basename(filePath)
    if (base === HISTORY_ITEM_NAME) return "hi"
    if (base === API_HISTORY_NAME) return "ach"
    if (base === UI_MESSAGES_NAME) return "uim"
    return base
}

export function inspectTaskDir(
    taskId: string,
    dir: string,
    indexItem?: HistoryItem | null,
    options: InspectOptions = {},
): TaskCorruption {
    const reasonMap = new Map<CorruptionReason, Set<string>>()
    let errorCount = 0
    let warningCount = 0
    const showWarnings = options.showWarnings !== false

    const add = (reason: CorruptionReason, source: string) => {
        const sources = reasonMap.get(reason)
        if (sources) {
            sources.add(source)
        } else {
            reasonMap.set(reason, new Set([source]))
        }
    }

    /** Validate a file and map issues to corruption reasons. Returns parsed data (or null). */
    function validateAndMap(filePath: string, fileName: string): unknown {
        const tx = new JsonFileTransaction(filePath)
        const result = tx.validate()
        const data = tx.load(false).getData()
        const codes = new Set(result.issues.map(i => i.code))
        // Accumulate error/warning counts from all validation issues
        for (const issue of result.issues) {
            if (issue.severity === "error") errorCount++
            else warningCount++
        }
        // zero_tokens requires all three zero-field codes present
        const hasAllZeroTokens = codes.has("ZERO_TOKENS_IN") && codes.has("ZERO_TOKENS_OUT") && codes.has("ZERO_TOTAL_COST")
        for (const issue of result.issues) {
            if (issue.code === "NOT_FOUND") {
                if (fileName === HISTORY_ITEM_NAME) add("missing_history_item", "hi")
                continue
            }
            // Skip warning-level issues when --no-warnings
            if (!showWarnings && issue.severity === "warning") continue
            // Skip individual zero-token codes; only report if all three present
            if (issue.code === "ZERO_TOKENS_IN" || issue.code === "ZERO_TOKENS_OUT" || issue.code === "ZERO_TOTAL_COST") {
                if (!hasAllZeroTokens) continue
            }
            const reason = issue.code === "EMPTY_ARRAY" && fileName === API_HISTORY_NAME
                ? "empty_api_history"
                : issueToReason(issue)
            if (reason) add(reason, fileSource(filePath))
        }
        return data
    }

    // File-level validation via JsonFileTransaction with auto-registered validators
    const historyPath = path.join(dir, HISTORY_ITEM_NAME)
    const diskItem = validateAndMap(historyPath, HISTORY_ITEM_NAME) as HistoryItem | null

    const apiPath = path.join(dir, API_HISTORY_NAME)
    const api = validateAndMap(apiPath, API_HISTORY_NAME) as unknown[] | null

    const uiPath = path.join(dir, UI_MESSAGES_NAME)
    const ui = validateAndMap(uiPath, UI_MESSAGES_NAME) as unknown[] | null

    // Cross-file validators (not auto-registered — take multiple inputs)
    if (showWarnings && options.verifyUiSync && Array.isArray(api) && api.length > 0 && Array.isArray(ui) && ui.length > 0) {
        const reconstructed = rebuildUiMessages(api as Parameters<typeof rebuildUiMessages>[0])
        if (reconstructed.length > 0) {
            const syncResult = validateUiSync(ui, reconstructed)
            for (const issue of syncResult.issues) {
                if (issue.severity === "error") errorCount++
                else warningCount++
                const reason = issueToReason(issue)
                if (reason) add(reason, "uim,ach")
            }
        }
    }

    // Interrupted task detection (warning-level only)
    if (showWarnings && Array.isArray(api) && api.length > 0) {
        const intResult = validateInterruptedTask(api)
        for (const issue of intResult.issues) {
            if (issue.severity === "error") errorCount++
            else warningCount++
            const reason = issueToReason(issue)
            if (reason) add(reason, "ach")
        }
    }

    // Index item checks (no file to validate — manual checks)
    if (indexItem) {
        if (isPlaceholderTaskName(indexItem.task)) {
            add("placeholder_task_name", "idx");
            errorCount++
        }
        if (indexItem.size === 0 || indexItem.size == null) {
            add("zero_size", "idx");
            errorCount++
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
        errorCount,
        warningCount,
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
        // Detect if this is a task directory (contains task JSON files)
        const isTaskDir = fs.existsSync(path.join(resolved, HISTORY_ITEM_NAME))

        if (isTaskDir) {
            const taskId = path.basename(resolved)

            // Validate a single task directory's files
            for (const f of [HISTORY_ITEM_NAME, API_HISTORY_NAME, UI_MESSAGES_NAME, TASK_METADATA_NAME]) {
                const fp = path.join(resolved, f)
                if (fs.existsSync(fp)) {
                    const file = new JsonFileTransaction(fp)
                    results.push({file: fp, result: file.validate()})
                }
            }

            // Also validate the _index.json entry for this task with cross-references
            const parentDir = path.dirname(resolved)
            const indexPath = path.join(parentDir, "_index.json")
            if (fs.existsSync(indexPath)) {
                const indexTx = new JsonFileTransaction(indexPath)
                const indexData = indexTx.load(false).getData() as Array<{ id: string }> | {
                    entries: Array<{ id: string }>
                } | null
                const entries: Array<Record<string, unknown>> = Array.isArray(indexData)
                    ? indexData as Array<Record<string, unknown>>
                    : (indexData as { entries: Array<Record<string, unknown>> })?.entries ?? []

                const fullIndex = new Map<string, Record<string, unknown>>()
                for (const e of entries) {
                    if (e.id && typeof e.id === "string") fullIndex.set(e.id, e)
                }

                const entry = fullIndex.get(taskId)
                if (entry) {
                    const entryResult = validateHistoryItem(entry, fullIndex)
                    results.push({file: `${indexPath}:entries[${taskId}]`, result: entryResult})
                }
            }
        } else {
            // Validate all task dirs + index (storage root)
            const indexPath = path.join(resolved, "_index.json")
            if (fs.existsSync(indexPath)) {
                const file = new JsonFileTransaction(indexPath)
                results.push({file: indexPath, result: file.validate()})
            }

            const entries = fs.readdirSync(resolved, {withFileTypes: true})
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith(".")) continue
                const taskDir = path.join(resolved, entry.name)
                for (const f of [HISTORY_ITEM_NAME, API_HISTORY_NAME, UI_MESSAGES_NAME, TASK_METADATA_NAME]) {
                    const fp = path.join(taskDir, f)
                    if (fs.existsSync(fp)) {
                        const file = new JsonFileTransaction(fp)
                        results.push({file: fp, result: file.validate()})
                    }
                }
            }
        }
    } else {
        const file = new JsonFileTransaction(resolved)
        results.push({file: resolved, result: file.validate()})
    }

    return results;
}
