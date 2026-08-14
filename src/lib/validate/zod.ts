import { ZodError, ZodIssue } from "zod"
import type { ValidationIssue, ValidationResult } from "../validation.js"

/**
 * Convert a single ZodIssue to our ValidationIssue format.
 * For custom issues (from .superRefine()), reads severity and code from params.
 */
export function zodIssueToValidationIssue(
	issue: ZodIssue,
	defaultSeverity: "error" | "warning" = "error",
): ValidationIssue {
	const isCustom = issue.code === "custom"
	const params = isCustom ? (issue as ZodIssue & { params?: Record<string, unknown> }).params : undefined

	// Build dotted field path from Zod's path array
	const field = issue.path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".")

	return {
		code: isCustom && params?.code ? String(params.code) : issue.code,
		severity: isCustom && params?.severity ? (params.severity as "error" | "warning") : defaultSeverity,
		field,
		message: issue.message,
		context: params,
	}
}

/**
 * Convert a ZodError (or safeParse failure) plus optional custom issues
 * into a ValidationResult. Handles the common pattern:
 *
 *   const parsed = schema.safeParse(data)
 *   if (!parsed.success) {
 *     return zodResultToValidationResult(parsed)
 *   }
 *   // ... add custom warnings/errors ...
 *   return zodResultToValidationResult(null, customIssues)
 */
export function zodResultToValidationResult(
	zodResult: { success: false; error: ZodError } | null,
	customIssues?: ValidationIssue[],
): ValidationResult {
	const issues: ValidationIssue[] = [
		...(zodResult?.error.issues.map((i) => zodIssueToValidationIssue(i)) ?? []),
		...(customIssues ?? []),
	]
	const errors = issues.filter((i) => i.severity === "error")
	return {
		valid: errors.length === 0,
		issues,
		errorCount: errors.length,
		warningCount: issues.length - errors.length,
	}
}

/**
 * Wrap a Zod schema's safeParse, adding a custom severity to all issues.
 * Useful when a schema should produce only warnings (not errors).
 */
export function safeParseAsWarning<T>(
	schema: { safeParse: (data: unknown) => { success: boolean; error?: ZodError; data?: T } },
	data: unknown,
): { data: T | null; issues: ValidationIssue[] } {
	const result = schema.safeParse(data)
	if (result.success) {
		return { data: result.data as T, issues: [] }
	}
	const issues = result.error!.issues.map((i) => zodIssueToValidationIssue(i, "warning"))
	return { data: null, issues }
}
