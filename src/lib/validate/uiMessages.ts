import {z} from "zod"
import type {ValidationResult} from "../validation.js"
import {error, validationOk, warning} from "../validation.js"
import {zodResultToValidationResult} from "./zod.js"

/**
 * Zoo Code ui_messages event schema.
 * Aligned with @roo-code/types message shape from rooCodeEventsSchema.
 *
 * Supports both "ask" and "say" event types with their respective
 * discrimination fields.
 */

// Enum values from Zoo Code's rooCodeEventsSchema (lines 104-106, 164-166)
const sayValues = [
    "api_req_deleted",
    "api_req_finished",
    "api_req_rate_limit_wait",
    "api_req_retried",
    "api_req_retry_delayed",
    "api_req_started",
    "checkpoint_saved",
    "codebase_search_result",
    "command_output",
    "completion_result",
    "condense_context",
    "condense_context_error",
    "diff_error",
    "error",
    "image",
    "mcp_server_request_started",
    "mcp_server_response",
    "reasoning",
    "rooignore_error",
    "shell_integration_warning",
    "sliding_window_truncation",
    "subtask_result",
    "text",
    "too_many_tools_warning",
    "tool",
    "user_edit_todos",
    "user_feedback",
    "user_feedback_diff",
] as const

const askValues = [
    "api_req_failed",
    "auto_approval_max_req_reached",
    "command",
    "command_output",
    "completion_result",
    "followup",
    "mistake_limit_reached",
    "resume_completed_task",
    "resume_task",
    "tool",
    "use_mcp_server",
] as const

/**
 * Schema for a single ui_messages event.
 */
export const uiMessageEventSchema = z.object({
    ts: z.number(),
    type: z.enum(["ask", "say"]),
    ask: z.enum(askValues).optional(),
    say: z.enum(sayValues).optional(),
    text: z.string().optional(),
    images: z.array(z.string()).optional(),
    partial: z.boolean().optional(),
    reasoning: z.string().optional(),
    conversationHistoryIndex: z.number().optional(),
    checkpoint: z.record(z.string(), z.unknown()).optional(),
    progressStatus: z.object({
        icon: z.string().optional(),
        text: z.string().optional(),
    }).optional(),
    contextCondense: z.object({
        cost: z.number(),
        prevContextTokens: z.number(),
        newContextTokens: z.number(),
        summary: z.string(),
        condenseId: z.string().optional(),
    }).optional(),
    contextTruncation: z.object({
        truncationId: z.string(),
        messagesRemoved: z.number(),
        prevContextTokens: z.number(),
        newContextTokens: z.number(),
    }).optional(),
    isProtected: z.boolean().optional(),
    apiProtocol: z.enum(["openai", "anthropic"]).optional(),
    isAnswered: z.boolean().optional(),
}).passthrough()

export type UiMessageEvent = z.infer<typeof uiMessageEventSchema>

export function validateUiMessages(data: unknown): ValidationResult {
    if (data === null || data === undefined) {
        return {
            valid: false,
            issues: [error("NOT_JSON", "", "data is null or undefined")],
            errorCount: 1,
            warningCount: 0,
        }
    }

    if (!Array.isArray(data)) {
        return {
            valid: false,
            issues: [error("NOT_ARRAY", "", "ui_messages must be an array")],
            errorCount: 1,
            warningCount: 0,
        }
    }

    if (data.length === 0) {
        return {
            valid: true,
            issues: [warning("EMPTY_ARRAY", "", "ui_messages array is empty")],
            errorCount: 0,
            warningCount: 1,
        }
    }

    const allIssues: ReturnType<typeof error>[] = []

    for (let i = 0; i < (data as unknown[]).length; i++) {
        const event = (data as unknown[])[i]
        const prefix = `[${i}]`

        if (!event || typeof event !== "object") {
            allIssues.push(error("INVALID_EVENT", prefix, "event is not an object"))
            continue
        }

        const parsed = uiMessageEventSchema.safeParse(event)
        if (!parsed.success) {
            const result = zodResultToValidationResult(parsed)
            for (const issue of result.issues) {
                allIssues.push({
                    ...issue,
                    field: `${prefix}.${issue.field}`.replace(/\.$/, ""),
                })
            }
        }
    }

    const errors = allIssues.filter(i => i.severity === "error")
    return {
        valid: errors.length === 0,
        issues: allIssues,
        errorCount: errors.length,
        warningCount: allIssues.length - errors.length,
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
        return {
            valid: true,
            issues: [warning("UI_SYNC_MISMATCH", "", "ui_messages event count differs from ACH reconstruction")],
            errorCount: 0, warningCount: 1,
        }
    }

    for (let i = 0; i < existingUi.length; i++) {
        const ex = existingUi[i] as Record<string, unknown> | null
        const re = reconstructed[i] as Record<string, unknown>
        if (!ex || typeof ex !== "object") {
            return {
                valid: true,
                issues: [warning("UI_SYNC_MISMATCH", `[${i}]`, "ui_messages event is not an object")],
                errorCount: 0, warningCount: 1,
            }
        }
        if (ex.say !== re.say || ex.text !== re.text) {
            return {
                valid: true,
                issues: [warning("UI_SYNC_MISMATCH", `[${i}]`, "ui_messages say/text differs from ACH reconstruction")],
                errorCount: 0, warningCount: 1,
            }
        }
    }

    return validationOk()
}
