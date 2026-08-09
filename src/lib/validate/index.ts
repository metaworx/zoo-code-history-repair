import type {ValidationResult} from "../validation.js"
import {error, warning} from "../validation.js"
import {validateHistoryItem} from "./historyItem.js"

export function validateIndex(data: unknown): ValidationResult {
    if (data === null || data === undefined) {
        return {
            valid: false,
            issues: [error("NOT_JSON", "", "index is null or undefined")],
            errorCount: 1,
            warningCount: 0
        }
    }

    // Tolerate legacy array-only format: treat as {version:0, entries:data}
    // Only if the array contains objects (HistoryItem-like), not primitives
    if (Array.isArray(data)) {
        if (data.length > 0 && data.every(e => e && typeof e === "object")) {
            return validateIndex({version: 0, entries: data})
        }
        return {
            valid: false,
            issues: [error("NOT_OBJECT", "", "index must be an object")],
            errorCount: 1,
            warningCount: 0
        }
    }

    if (typeof data !== "object") {
        return {
            valid: false,
            issues: [error("NOT_OBJECT", "", "index must be an object")],
            errorCount: 1,
            warningCount: 0
        }
    }

    const idx = data as Record<string, unknown>
    const issues: ReturnType<typeof error>[] = []
    const e2 = (code: string, field: string, msg: string) => issues.push(error(code, field, msg))
    const w2 = (code: string, field: string, msg: string) => issues.push(warning(code, field, msg))

    // Structure checks
    if (!("version" in idx)) {
        e2("MISSING_VERSION", "version", "index must have a version field")
    } else if (idx.version !== 1) {
        w2("UNSUPPORTED_VERSION", "version", `index version ${idx.version} is not supported (expected 1)`)
    }

    if (!("updatedAt" in idx)) {
        e2("MISSING_UPDATED_AT", "updatedAt", "index must have an updatedAt field")
    } else if (typeof idx.updatedAt !== "number" || !Number.isFinite(idx.updatedAt as number)) {
        e2("INVALID_UPDATED_AT", "updatedAt", "updatedAt must be a number (epoch ms)")
    }

    if (!("entries" in idx)) {
        e2("MISSING_ENTRIES", "entries", "index must have an entries array")
        return finish(issues)
    }

    if (!Array.isArray(idx.entries)) {
        e2("INVALID_ENTRIES", "entries", "entries must be an array")
        return finish(issues)
    }

    const entries = idx.entries as Array<Record<string, unknown>>

    // Build id map for cross-reference validation
    const idMap = new Map<string, Record<string, unknown>>()
    for (const entry of entries) {
        if (entry && typeof entry === "object" && typeof entry.id === "string") {
            idMap.set(entry.id, entry)
        }
    }

    // Per-entry validation with cross-reference checks
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (!entry || typeof entry !== "object") {
            e2("INVALID_ENTRY", `entries[${i}]`, "entry is not an object")
            continue
        }

        if (typeof entry.id !== "string") {
            e2("MISSING_ENTRY_ID", `entries[${i}].id`, "entry must have a string id")
            // Still validate what we can
        }

        const hiResult = validateHistoryItem(entry, idMap)
        for (const issue of hiResult.issues) {
            issues.push({
                ...issue,
                field: `entries[${i}].${issue.field}`.replace(/\.$/, ""),
            })
        }
    }

    return finish(issues)
}

function finish(issues: ReturnType<typeof error>[]): ValidationResult {
    const errors = issues.filter(i => i.severity === "error")
    return {valid: errors.length === 0, issues, errorCount: errors.length, warningCount: issues.length - errors.length}
}
