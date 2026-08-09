import type {ValidationResult} from "../validation.js"
import {error, warning, validationOk} from "../validation.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_STATUSES = new Set(["active", "delegated", "completed", "interrupted"])

type EntryMap = Map<string, Record<string, unknown>>

function isUuid(v: unknown): boolean {
    return typeof v === "string" && UUID_RE.test(v)
}

function checkString(entry: Record<string, unknown>, key: string, required: boolean): string | null {
    const v = entry[key]
    if (v === undefined || v === null) {
        if (required) return `missing required field "${key}"`
        return null
    }
    if (typeof v !== "string" || !v.trim()) return `field "${key}" must be a non-empty string`
    return null
}

function checkNumber(entry: Record<string, unknown>, key: string, required: boolean): string | null {
    const v = entry[key]
    if (v === undefined || v === null) {
        if (required) return `missing required field "${key}"`
        return null
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return `field "${key}" must be a finite number`
    return null
}

function checkInteger(entry: Record<string, unknown>, key: string, required: boolean): string | null {
    const v = entry[key]
    if (v === undefined || v === null) {
        if (required) return `missing required field "${key}"`
        return null
    }
    if (typeof v !== "number" || !Number.isInteger(v)) return `field "${key}" must be an integer`
    return null
}

function checkUuid(entry: Record<string, unknown>, key: string): string | null {
    const v = entry[key]
    if (v === undefined || v === null) return null
    if (!isUuid(v)) return `field "${key}" must be a UUID`
    return null
}

function checkUuidArray(entry: Record<string, unknown>, key: string): string | null {
    const v = entry[key]
    if (v === undefined || v === null) return null
    if (!Array.isArray(v)) return `field "${key}" must be an array`
    for (let i = 0; i < (v as unknown[]).length; i++) {
        if (!isUuid((v as unknown[])[i])) return `field "${key}[${i}]" must be a UUID`
    }
    return null
}

/**
 * Validate a single history_item.json entry or _index.json entry.
 *
 * @param data       The entry object (parsed JSON)
 * @param fullIndex  Optional Map of id → entry for cross-reference lookups.
 *                   Only passed during full task validation, not during
 *                   individual file save.
 */
export function validateHistoryItem(
    data: unknown,
    fullIndex?: EntryMap,
): ValidationResult {
    if (data === null || data === undefined) {
        return {
            valid: false,
            issues: [error("NOT_OBJECT", "", "history item is null or undefined")],
            errorCount: 1, warningCount: 0,
        }
    }

    if (typeof data !== "object" || Array.isArray(data)) {
        return {
            valid: false,
            issues: [error("NOT_OBJECT", "", "history item must be an object")],
            errorCount: 1, warningCount: 0,
        }
    }

    const e = data as Record<string, unknown>
    const issues: ReturnType<typeof error>[] = []
    const e2 = (code: string, field: string, msg: string) => issues.push(error(code, field, msg))
    const w2 = (code: string, field: string, msg: string) => issues.push(warning(code, field, msg))

    // Required fields
    const s = checkString(e, "id", true)
    if (s) e2("MISSING_ID", "id", s)
    else if (!isUuid(e.id)) e2("INVALID_UUID", "id", "id must be a UUID")

    const tsErr = checkNumber(e, "ts", true)
    if (tsErr) e2("MISSING_TS", "ts", tsErr)

    const numErr = checkInteger(e, "number", true)
    if (numErr) e2("MISSING_NUMBER", "number", numErr)
    else if ((e.number as number) <= 0) e2("INVALID_NUMBER", "number", "number must be > 0")

    const taskErr = checkString(e, "task", true)
    if (taskErr) e2("MISSING_TASK", "task", taskErr)
    else {
        const t = (e.task as string).trim()
        if (/^Task\s*#\s*\d+(\s*\(.*\))?$/i.test(t)) {
            e2("PLACEHOLDER_TASK", "task", "task is a placeholder: " + t)
        }
    }

    // Token fields: required, 0 is warning not error
    const tInErr = checkInteger(e, "tokensIn", true)
    if (tInErr) e2("MISSING_TOKENS_IN", "tokensIn", tInErr)
    else if ((e.tokensIn as number) === 0) w2("ZERO_TOKENS_IN", "tokensIn", "tokensIn is 0")

    const tOutErr = checkInteger(e, "tokensOut", true)
    if (tOutErr) e2("MISSING_TOKENS_OUT", "tokensOut", tOutErr)
    else if ((e.tokensOut as number) === 0) w2("ZERO_TOKENS_OUT", "tokensOut", "tokensOut is 0")

    const tcErr = checkNumber(e, "totalCost", true)
    if (tcErr) e2("MISSING_TOTAL_COST", "totalCost", tcErr)
    else if ((e.totalCost as number) === 0) w2("ZERO_TOTAL_COST", "totalCost", "totalCost is 0")

    const szErr = checkInteger(e, "size", true)
    if (szErr) e2("MISSING_SIZE", "size", szErr)
    else if ((e.size as number) === 0) w2("ZERO_SIZE", "size", "size is 0")

    const wsErr = checkString(e, "workspace", true)
    if (wsErr) e2("MISSING_WORKSPACE", "workspace", wsErr)

    const modeErr = checkString(e, "mode", true)
    if (modeErr) e2("MISSING_MODE", "mode", modeErr)

    const acnErr = checkString(e, "apiConfigName", true)
    if (acnErr) e2("MISSING_API_CONFIG", "apiConfigName", acnErr)

    // Optional fields
    if (e.status !== undefined && e.status !== null) {
        if (typeof e.status !== "string" || !VALID_STATUSES.has(e.status)) {
            e2("INVALID_STATUS", "status", `status must be one of active|delegated|completed|interrupted, got ${JSON.stringify(e.status)}`)
        }
    }
    // Missing status is normal — not corruption

    const cwErr = checkInteger(e, "cacheWrites", false)
    if (cwErr) w2("INVALID_CACHE_WRITES", "cacheWrites", cwErr)

    const crErr = checkInteger(e, "cacheReads", false)
    if (crErr) w2("INVALID_CACHE_READS", "cacheReads", crErr)

    const ptErr = checkUuid(e, "parentTaskId")
    if (ptErr) e2("INVALID_PARENT_TASK_ID", "parentTaskId", ptErr)

    const rtErr = checkUuid(e, "rootTaskId")
    if (rtErr) e2("INVALID_ROOT_TASK_ID", "rootTaskId", rtErr)

    const ciErr = checkUuidArray(e, "childIds")
    if (ciErr) e2("INVALID_CHILD_IDS", "childIds", ciErr)

    const ccErr = checkUuid(e, "completedByChildId")
    if (ccErr) e2("INVALID_COMPLETED_BY", "completedByChildId", ccErr)

    const dtErr = checkUuid(e, "delegatedToId")
    if (dtErr) e2("INVALID_DELEGATED_TO", "delegatedToId", dtErr)

    const acErr = checkUuid(e, "awaitingChildId")
    if (acErr) e2("INVALID_AWAITING_CHILD", "awaitingChildId", acErr)

    // Status-specific consistency (derived from real data analysis)
    const status = e.status as string | undefined
    if (status === "delegated") {
        if (!e.delegatedToId) e2("STATUS_DELEGATED_MISSING", "delegatedToId", "delegated tasks must have delegatedToId")
        if (!e.awaitingChildId) e2("STATUS_DELEGATED_MISSING", "awaitingChildId", "delegated tasks must have awaitingChildId")
        if (!e.childIds) e2("STATUS_DELEGATED_MISSING", "childIds", "delegated tasks must have childIds")
        if (!e.completedByChildId) e2("STATUS_DELEGATED_MISSING", "completedByChildId", "delegated tasks must have completedByChildId")
        if (!e.completionResultSummary) e2("STATUS_DELEGATED_MISSING", "completionResultSummary", "delegated tasks must have completionResultSummary")
    }
    if (status === "completed") {
        if (!e.parentTaskId) e2("STATUS_COMPLETED_MISSING", "parentTaskId", "completed tasks must have parentTaskId")
    }
    if (status === "interrupted") {
        if (!e.parentTaskId) e2("STATUS_INTERRUPTED_MISSING", "parentTaskId", "interrupted tasks must have parentTaskId")
    }
    if (status === "active") {
        if (e.awaitingChildId) e2("STATUS_ACTIVE_FORBIDDEN", "awaitingChildId", "active tasks must not have awaitingChildId")
    }

    // Cross-reference consistency (only when fullIndex is provided)
    if (fullIndex) {
        const refs: Array<[string, unknown]> = [
            ["rootTaskId", e.rootTaskId],
            ["parentTaskId", e.parentTaskId],
        ]
        if (Array.isArray(e.childIds)) {
            (e.childIds as string[]).forEach((cid, i) => refs.push([`childIds[${i}]`, cid]))
        }
        refs.push(["completedByChildId", e.completedByChildId])
        refs.push(["delegatedToId", e.delegatedToId])
        refs.push(["awaitingChildId", e.awaitingChildId])

        for (const [field, refId] of refs) {
            if (refId === undefined || refId === null) continue
            if (!fullIndex.has(refId as string)) {
                e2("DANGLING_REF", field, `reference "${refId}" does not exist in index`)
            }
        }
    }

    const errors = issues.filter(i => i.severity === "error")
    return {
        valid: errors.length === 0,
        issues,
        errorCount: errors.length,
        warningCount: issues.length - errors.length,
    }
}
