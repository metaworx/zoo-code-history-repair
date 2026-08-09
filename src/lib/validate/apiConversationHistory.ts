import type {ValidationResult} from "../validation.js"
import {error, validationOk} from "../validation.js"

export function validateApiConversationHistory(data: unknown): ValidationResult {
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
            issues: [error("NOT_ARRAY", "", "api_conversation_history must be an array")],
            errorCount: 1,
            warningCount: 0
        }
    }

    const issues = []
    const turns = data as Array<Record<string, unknown>>

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i]
        const prefix = `[${i}]`

        if (!turn || typeof turn !== "object") {
            issues.push(error("INVALID_TURN", prefix, "turn is not an object"))
            continue
        }

        if (turn.role !== "user" && turn.role !== "assistant") {
            issues.push(error("INVALID_ROLE", `${prefix}.role`, `expected "user" or "assistant", got ${JSON.stringify(turn.role)}`))
        }

        if (!Array.isArray(turn.content)) {
            issues.push(error("MISSING_CONTENT", `${prefix}.content`, "content must be an array"))
            continue
        }

        const content = turn.content as Array<Record<string, unknown>>
        for (let j = 0; j < content.length; j++) {
            const block = content[j]
            const bp = `${prefix}.content[${j}]`

            if (!block || typeof block !== "object") {
                issues.push(error("INVALID_BLOCK", bp, "content block is not an object"))
                continue
            }

            if (typeof block.type !== "string") {
                issues.push(error("MISSING_TYPE", `${bp}.type`, "content block missing type"))
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
