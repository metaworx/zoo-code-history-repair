import {z, ZodIssueCode} from "zod"
import {historyItemSchema} from "@roo-code/types"
import type {ValidationResult} from "../validation.js"
import {error, warning} from "../validation.js"
import {zodResultToValidationResult} from "./zod.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type EntryMap = Map<string, Record<string, unknown>>

function isUuid(v: unknown): boolean {
    return typeof v === "string" && UUID_RE.test(v)
}

/**
 * Extended history item schema for repair validation.
 *
 * Builds on Zoo Code's canonical historyItemSchema, making repair-critical
 * fields required and adding corruption heuristics via .superRefine().
 */
export const historyItemForRepair = historyItemSchema.extend({
    // Zoo makes these optional; we require them for repair
    size: z.number(),
    workspace: z.string(),
    mode: z.string(),
    apiConfigName: z.string(),

    // Zoo's status enum lacks "interrupted" — we add it
    status: z.enum(["active", "completed", "delegated", "interrupted"]).optional(),

    // Re-declare for clarity (already in base schema but we want explicit types)
    parentTaskId: z.string().optional(),
    rootTaskId: z.string().optional(),
    delegatedToId: z.string().optional(),
    awaitingChildId: z.string().optional(),
    completedByChildId: z.string().optional(),
    childIds: z.array(z.string()).optional(),
    completionResultSummary: z.string().optional(),
}).superRefine((item, ctx) => {
    // --- Required field format checks (Zoo accepts any string/number) ---

    if (!isUuid(item.id)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "id must be a UUID",
            path: ["id"],
            params: {severity: "error", code: "INVALID_UUID"},
        })
    }

    if (!Number.isInteger(item.number) || item.number <= 0) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "number must be an integer > 0",
            path: ["number"],
            params: {severity: "error", code: "INVALID_NUMBER"},
        })
    }

    if (!Number.isInteger(item.tokensIn)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "tokensIn must be an integer",
            path: ["tokensIn"],
            params: {severity: "error", code: "MISSING_TOKENS_IN"},
        })
    }

    if (!Number.isInteger(item.tokensOut)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "tokensOut must be an integer",
            path: ["tokensOut"],
            params: {severity: "error", code: "MISSING_TOKENS_OUT"},
        })
    }

    if (!Number.isInteger(item.size)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "size must be an integer",
            path: ["size"],
            params: {severity: "error", code: "MISSING_SIZE"},
        })
    }

    // --- Corruption heuristics ---

    // PLACEHOLDER_TASK: "Task #N" or "Task #N (...)" pattern
    // Also flag empty or whitespace-only task as missing
    const task = (item.task as string).trim()
    if (!task) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "task is empty",
            path: ["task"],
            params: {severity: "error", code: "MISSING_TASK"},
        })
    } else if (/^Task\s*#\s*\d+(\s*\(.*\))?$/i.test(task)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "task is a placeholder: " + task,
            path: ["task"],
            params: {severity: "error", code: "PLACEHOLDER_TASK"},
        })
    }

    // Zero-value corruption indicators
    if (item.size === 0) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "size is 0",
            path: ["size"],
            params: {severity: "error", code: "ZERO_SIZE"},
        })
    }

    if (item.tokensIn === 0) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "tokensIn is 0",
            path: ["tokensIn"],
            params: {severity: "warning", code: "ZERO_TOKENS_IN"},
        })
    }

    if (item.tokensOut === 0) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "tokensOut is 0",
            path: ["tokensOut"],
            params: {severity: "warning", code: "ZERO_TOKENS_OUT"},
        })
    }

    if (item.totalCost === 0) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "totalCost is 0",
            path: ["totalCost"],
            params: {severity: "warning", code: "ZERO_TOTAL_COST"},
        })
    }

    // Optional field format checks (warnings, not errors)
    if (item.cacheWrites !== undefined && !Number.isInteger(item.cacheWrites)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "cacheWrites must be an integer",
            path: ["cacheWrites"],
            params: {severity: "warning", code: "INVALID_CACHE_WRITES"},
        })
    }

    if (item.cacheReads !== undefined && !Number.isInteger(item.cacheReads)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "cacheReads must be an integer",
            path: ["cacheReads"],
            params: {severity: "warning", code: "INVALID_CACHE_READS"},
        })
    }

    if (item.parentTaskId !== undefined && item.parentTaskId !== null && !isUuid(item.parentTaskId)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "parentTaskId must be a UUID",
            path: ["parentTaskId"],
            params: {severity: "error", code: "INVALID_PARENT_TASK_ID"},
        })
    }

    if (item.rootTaskId !== undefined && item.rootTaskId !== null && !isUuid(item.rootTaskId)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "rootTaskId must be a UUID",
            path: ["rootTaskId"],
            params: {severity: "error", code: "INVALID_ROOT_TASK_ID"},
        })
    }

    if (item.delegatedToId !== undefined && item.delegatedToId !== null && !isUuid(item.delegatedToId)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "delegatedToId must be a UUID",
            path: ["delegatedToId"],
            params: {severity: "error", code: "INVALID_DELEGATED_TO"},
        })
    }

    if (item.awaitingChildId !== undefined && item.awaitingChildId !== null && !isUuid(item.awaitingChildId)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "awaitingChildId must be a UUID",
            path: ["awaitingChildId"],
            params: {severity: "error", code: "INVALID_AWAITING_CHILD"},
        })
    }

    if (item.completedByChildId !== undefined && item.completedByChildId !== null && !isUuid(item.completedByChildId)) {
        ctx.addIssue({
            code: ZodIssueCode.custom,
            message: "completedByChildId must be a UUID",
            path: ["completedByChildId"],
            params: {severity: "error", code: "INVALID_COMPLETED_BY"},
        })
    }

    if (item.childIds !== undefined && item.childIds !== null) {
        for (let i = 0; i < item.childIds.length; i++) {
            if (!isUuid(item.childIds[i])) {
                ctx.addIssue({
                    code: ZodIssueCode.custom,
                    message: `childIds[${i}] must be a UUID`,
                    path: ["childIds", i],
                    params: {severity: "error", code: "INVALID_CHILD_IDS"},
                })
            }
        }
    }

    // --- Status-specific consistency checks ---

    const status = item.status
    if (status === "delegated") {
        if (!item.delegatedToId) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "delegated tasks must have delegatedToId",
                path: ["delegatedToId"],
                params: {severity: "error", code: "STATUS_DELEGATED_MISSING"},
            })
        }
        if (!item.awaitingChildId) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "delegated tasks must have awaitingChildId",
                path: ["awaitingChildId"],
                params: {severity: "error", code: "STATUS_DELEGATED_MISSING"},
            })
        }
        if (!item.childIds || item.childIds.length === 0) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "delegated tasks must have childIds",
                path: ["childIds"],
                params: {severity: "error", code: "STATUS_DELEGATED_MISSING"},
            })
        }
        if (!item.completedByChildId) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "delegated tasks must have completedByChildId",
                path: ["completedByChildId"],
                params: {severity: "error", code: "STATUS_DELEGATED_MISSING"},
            })
        }
        if (!item.completionResultSummary) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "delegated tasks must have completionResultSummary",
                path: ["completionResultSummary"],
                params: {severity: "error", code: "STATUS_DELEGATED_MISSING"},
            })
        }
    }

    if (status === "active") {
        if (item.awaitingChildId) {
            ctx.addIssue({
                code: ZodIssueCode.custom,
                message: "active tasks must not have awaitingChildId",
                path: ["awaitingChildId"],
                params: {severity: "error", code: "STATUS_ACTIVE_FORBIDDEN"},
            })
        }
    }
})

export type HistoryItemForRepair = z.infer<typeof historyItemForRepair>

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

    const parsed = historyItemForRepair.safeParse(data)
    const result = zodResultToValidationResult(
        parsed.success ? null : parsed,
    )

    // Cross-reference consistency (post-parse — needs external id map)
    if (fullIndex) {
        const e = data as Record<string, unknown>
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
                result.issues.push(error("DANGLING_REF", field, `reference "${refId}" does not exist in index`))
            }
        }
    }

    // Recalculate error/warning counts after adding cross-ref issues
    const errors = result.issues.filter(i => i.severity === "error")
    return {
        valid: errors.length === 0,
        issues: result.issues,
        errorCount: errors.length,
        warningCount: result.issues.length - errors.length,
    }
}
