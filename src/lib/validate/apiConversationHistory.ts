import type {ValidationResult} from "../validation.js"
import {error, validationOk, warning} from "../validation.js"

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

    if (data.length === 0) {
        return {
            valid: true,
            issues: [warning("EMPTY_ARRAY", "", "api_conversation_history array is empty")],
            errorCount: 0,
            warningCount: 1
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

/**
 * Content-pattern validator: detect interrupted tasks where the last turn
 * ends with an assistant tool_use (no tool_result follows).
 * Returns an INTERRUPTED_TASK warning if the pattern is detected.
 */
export function validateInterruptedTask(apiHistory: unknown[]): ValidationResult {
    if (!Array.isArray(apiHistory) || apiHistory.length === 0) return validationOk()

    const lastTurn = apiHistory[apiHistory.length - 1] as Record<string, unknown> | null
    if (lastTurn && lastTurn.role === "assistant" && Array.isArray(lastTurn.content)) {
        const blocks = lastTurn.content as Array<Record<string, unknown>>
        if (blocks.length > 0) {
            const lastBlock = blocks[blocks.length - 1]
            if (lastBlock && lastBlock.type === "tool_use") {
                return {
                    valid: true,
                    issues: [warning("INTERRUPTED_TASK", "", "last turn ends with tool_use — task may be interrupted")],
                    errorCount: 0,
                    warningCount: 1
                }
            }
        }
    }

    return validationOk()
}
