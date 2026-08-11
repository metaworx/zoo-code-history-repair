import {z} from "zod"
import type {ValidationResult} from "../validation.js"
import {zodResultToValidationResult} from "./zod.js"

/**
 * Schema for task_metadata.json — Zoo Code internal file tracking.
 *
 * Describes files in context with their record state and source,
 * plus read/edit timestamps for Roo and the user.
 */
export const taskMetadataSchema = z.object({
    files_in_context: z.array(z.object({
        path: z.string(),
        record_state: z.string(),
        record_source: z.string(),
        roo_read_date: z.number().nullable(),
        roo_edit_date: z.number().nullable(),
        user_edit_date: z.number().nullable(),
    })).optional(),
}).passthrough() // allow unknown top-level fields for forward compatibility

export type TaskMetadata = z.infer<typeof taskMetadataSchema>

/**
 * Validate task_metadata.json. Null/undefined is accepted (optional file).
 */
export function validateTaskMetadata(data: unknown): ValidationResult {
    if (data === null || data === undefined) {
        return {valid: true, issues: [], errorCount: 0, warningCount: 0}
    }

    const result = taskMetadataSchema.safeParse(data)
    if (!result.success) {
        return zodResultToValidationResult(result)
    }

    return {valid: true, issues: [], errorCount: 0, warningCount: 0}
}
