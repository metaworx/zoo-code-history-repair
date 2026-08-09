import type {ValidationResult} from "../validation.js"
import {error, validationOk} from "../validation.js"

/**
 * Validate task_metadata.json. No required fields — this is Zoo Code internal
 * data. Just ensure it's a parseable JSON object.
 */
export function validateTaskMetadata(data: unknown): ValidationResult {
    if (data === null || data === undefined) return validationOk()

    if (typeof data !== "object" || Array.isArray(data)) {
        return {valid: false, issues: [error("NOT_OBJECT", "", "task_metadata must be a JSON object")], errorCount: 1, warningCount: 0}
    }

    // Accept any object — no required fields
    return validationOk()
}
