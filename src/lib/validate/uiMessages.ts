import type {ValidationResult} from "../validation.js"
import {error, validationOk, warning} from "../validation.js"

export function validateUiMessages(data: unknown): ValidationResult {
    if (data === null || data === undefined) {
        return {
            valid: false,
            issues: [error("NOT_JSON", "", "data is null or undefined")],
            errorCount: 1,
            warningCount: 0
        }
    }

    if (!Array.isArray(data)) {
        return {
            valid: false,
            issues: [error("NOT_ARRAY", "", "ui_messages must be an array")],
            errorCount: 1,
            warningCount: 0
        }
    }

    if (data.length === 0) {
        return {
            valid: true,
            issues: [warning("EMPTY_ARRAY", "", "ui_messages array is empty")],
            errorCount: 0,
            warningCount: 1
        }
    }

    const issues = []
    const events = data as Array<Record<string, unknown>>

    for (let i = 0; i < events.length; i++) {
        const ev = events[i]
        const prefix = `[${i}]`

        if (!ev || typeof ev !== "object") {
            issues.push(error("INVALID_EVENT", prefix, "event is not an object"))
            continue
        }

        if (typeof ev.ts !== "number") issues.push(error("MISSING_TS", `${prefix}.ts`, "ts must be a number (epoch ms)"))
        if (ev.type !== "say") issues.push(error("INVALID_TYPE", `${prefix}.type`, `expected "say", got ${JSON.stringify(ev.type)}`))
        if (ev.say !== "text" && ev.say !== "reasoning" && ev.say !== "tool") {
            issues.push(error("INVALID_SAY", `${prefix}.say`, `expected text|reasoning|tool, got ${JSON.stringify(ev.say)}`))
        }
        if (typeof ev.text !== "string") issues.push(error("MISSING_TEXT", `${prefix}.text`, "text must be a string"))
    }

    const errors = issues.filter(i => i.severity === "error")
    return {
        valid: errors.length === 0,
        issues,
        errorCount: errors.length,
        warningCount: issues.length - errors.length,
    }
}

/**
 * Cross-file validator: compare existing ui_messages.json on disk against
 * a reconstruction from api_conversation_history. Returns a UI_SYNC_MISMATCH
 * warning if event count or say/text content differ (ignores ts differences).
 */
export function validateUiSync(existingUi: unknown[], reconstructed: unknown[]): ValidationResult {
    if (reconstructed.length === 0) return validationOk()
    if (existingUi.length !== reconstructed.length) {
        return {valid: true, issues: [warning("UI_SYNC_MISMATCH", "", "ui_messages event count differs from ACH reconstruction")], errorCount: 0, warningCount: 1}
    }

    for (let i = 0; i < existingUi.length; i++) {
        const ex = existingUi[i] as Record<string, unknown> | null
        const re = reconstructed[i] as Record<string, unknown>
        if (!ex || typeof ex !== "object") {
            return {valid: true, issues: [warning("UI_SYNC_MISMATCH", `[${i}]`, "ui_messages event is not an object")], errorCount: 0, warningCount: 1}
        }
        if (ex.say !== re.say || ex.text !== re.text) {
            return {valid: true, issues: [warning("UI_SYNC_MISMATCH", `[${i}]`, "ui_messages say/text differs from ACH reconstruction")], errorCount: 0, warningCount: 1}
        }
    }

    return validationOk()
}
