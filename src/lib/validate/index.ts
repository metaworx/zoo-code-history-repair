import { z, ZodIssueCode } from "zod"
import type { ValidationResult } from "../validation.js"
import { error } from "../validation.js"
import { zodResultToValidationResult } from "./zod.js"
import { historyItemForRepair } from "./historyItem.js"

/**
 * Entries array with cross-reference validation.
 * Checks for duplicate IDs and dangling references between entries.
 */
const entriesWithRefs = z.array(historyItemForRepair).superRefine((entries, ctx) => {
	const ids = new Set<string>()
	const duplicates = new Set<string>()

	for (const e of entries) {
		if (ids.has(e.id)) {
			duplicates.add(e.id)
		}
		ids.add(e.id)
	}

	for (const id of duplicates) {
		ctx.addIssue({
			code: ZodIssueCode.custom,
			message: `duplicate entry id: ${id}`,
			path: ["entries"],
			params: { severity: "error", code: "DUPLICATE_ID" },
		})
	}

	// Per-entry cross-reference validation
	const refOk = (ref: string | undefined | null, field: string, i: number) => {
		if (ref === undefined || ref === null) return
		if (!ids.has(ref)) {
			ctx.addIssue({
				code: ZodIssueCode.custom,
				message: `${field} references missing id: ${ref}`,
				path: ["entries", i, field],
				params: { severity: "error", code: "DANGLING_REF" },
			})
		}
	}

	entries.forEach((e, i) => {
		refOk(e.parentTaskId, "parentTaskId", i)
		refOk(e.rootTaskId, "rootTaskId", i)
		refOk(e.delegatedToId, "delegatedToId", i)
		refOk(e.completedByChildId, "completedByChildId", i)
		refOk(e.awaitingChildId, "awaitingChildId", i)

		if (e.childIds) {
			e.childIds.forEach((cid, j) => {
				if (!ids.has(cid)) {
					ctx.addIssue({
						code: ZodIssueCode.custom,
						message: `childIds[${j}] references missing id: ${cid}`,
						path: ["entries", i, "childIds", j],
						params: { severity: "error", code: "DANGLING_REF" },
					})
				}
			})
		}

		// Self-reference check
		if (e.parentTaskId && e.parentTaskId === e.id) {
			ctx.addIssue({
				code: ZodIssueCode.custom,
				message: "parentTaskId must not equal own id",
				path: ["entries", i, "parentTaskId"],
				params: { severity: "error", code: "SELF_REFERENCE" },
			})
		}
	})
})

/**
 * Full index schema: {version, updatedAt, entries} with cross-reference
 * validation embedded in the entries array.
 */
export const indexSchema = z.object({
	version: z.number(),
	updatedAt: z.number().finite(),
	entries: entriesWithRefs,
})

export type IndexData = z.infer<typeof indexSchema>

export function validateIndex(data: unknown): ValidationResult {
	if (data === null || data === undefined) {
		return {
			valid: false,
			issues: [error("NOT_JSON", "", "index is null or undefined")],
			errorCount: 1,
			warningCount: 0,
		}
	}

	// Tolerate legacy array-only format: treat as {version:0, entries:data}
	// Only if the array contains objects (HistoryItem-like), not primitives
	if (Array.isArray(data)) {
		if (data.length > 0 && data.every((e) => e && typeof e === "object")) {
			return validateIndex({ version: 0, entries: data })
		}
		return {
			valid: false,
			issues: [error("NOT_OBJECT", "", "index must be an object")],
			errorCount: 1,
			warningCount: 0,
		}
	}

	if (typeof data !== "object") {
		return {
			valid: false,
			issues: [error("NOT_OBJECT", "", "index must be an object")],
			errorCount: 1,
			warningCount: 0,
		}
	}

	const idx = data as Record<string, unknown>

	// Pre-checks before Zod parsing (version, structure)
	const issues: ReturnType<typeof error>[] = []

	if (!("version" in idx)) {
		issues.push(error("MISSING_VERSION", "version", "index must have a version field"))
	} else if (idx.version !== 1) {
		issues.push({
			code: "UNSUPPORTED_VERSION",
			severity: "warning",
			field: "version",
			message: `index version ${idx.version} is not supported (expected 1)`,
		})
	}

	if (!("updatedAt" in idx)) {
		issues.push(error("MISSING_UPDATED_AT", "updatedAt", "index must have an updatedAt field"))
	} else if (typeof idx.updatedAt !== "number" || !Number.isFinite(idx.updatedAt as number)) {
		issues.push(error("INVALID_UPDATED_AT", "updatedAt", "updatedAt must be a number (epoch ms)"))
	}

	if (!("entries" in idx)) {
		issues.push(error("MISSING_ENTRIES", "entries", "index must have an entries array"))
		const errs = issues.filter((i) => i.severity === "error")
		return { valid: errs.length === 0, issues, errorCount: errs.length, warningCount: issues.length - errs.length }
	}

	if (!Array.isArray(idx.entries)) {
		issues.push(error("INVALID_ENTRIES", "entries", "entries must be an array"))
		const errs = issues.filter((i) => i.severity === "error")
		return { valid: errs.length === 0, issues, errorCount: errs.length, warningCount: issues.length - errs.length }
	}

	// Zod parsing with cross-reference validation
	const parsed = indexSchema.safeParse(data)
	if (!parsed.success) {
		const result = zodResultToValidationResult(parsed)
		// Prepend pre-check issues
		result.issues.unshift(...issues)
		const errs = result.issues.filter((i) => i.severity === "error")
		return {
			valid: errs.length === 0,
			issues: result.issues,
			errorCount: errs.length,
			warningCount: result.issues.length - errs.length,
		}
	}

	// If Zod passes, still include pre-check issues (warnings like UNSUPPORTED_VERSION)
	const allIssues = [...issues]
	const errs = allIssues.filter((i) => i.severity === "error")
	return {
		valid: errs.length === 0,
		issues: allIssues,
		errorCount: errs.length,
		warningCount: allIssues.length - errs.length,
	}
}
