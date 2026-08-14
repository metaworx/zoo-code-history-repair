/**
 * @file src/lib/validate/apiConversationHistory.ts
 *
 * api_conversation_history.json validation.
 */

import { z } from "zod"
import type { ValidationResult } from "../validation.js"
import { error, validationOk, warning } from "../validation.js"
import { zodResultToValidationResult } from "./zod.js"

/**
 * Schema for an individual content block within an ACH turn.
 * Supports text, tool_use, and tool_result block types (Anthropic format).
 */
const contentBlockSchema = z
	.object({
		type: z.string(),
		text: z.string().optional(),
		tool_use_id: z.string().optional(),
		name: z.string().optional(),
		id: z.string().optional(),
		input: z.record(z.string(), z.unknown()).optional(),
		content: z.unknown().optional(),
	})
	.passthrough()

/**
 * Schema for a single ACH turn (role + content array).
 */
const achTurnSchema = z
	.object({
		role: z.enum(["user", "assistant"]),
		content: z.array(contentBlockSchema),
	})
	.passthrough()

export function validateApiConversationHistory(data: unknown): ValidationResult {
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
			issues: [error("NOT_ARRAY", "", "api_conversation_history must be an array")],
			errorCount: 1,
			warningCount: 0,
		}
	}

	if (data.length === 0) {
		return {
			valid: true,
			issues: [warning("EMPTY_ARRAY", "", "api_conversation_history array is empty")],
			errorCount: 0,
			warningCount: 1,
		}
	}

	const allIssues: ReturnType<typeof error>[] = []

	for (let i = 0; i < (data as unknown[]).length; i++) {
		const turn = (data as unknown[])[i]
		const prefix = `[${i}]`

		if (!turn || typeof turn !== "object") {
			allIssues.push(error("INVALID_TURN", prefix, "turn is not an object"))
			continue
		}

		const parsed = achTurnSchema.safeParse(turn)
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

	const errors = allIssues.filter((i) => i.severity === "error")
	return {
		valid: errors.length === 0,
		issues: allIssues,
		errorCount: errors.length,
		warningCount: allIssues.length - errors.length,
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
					warningCount: 1,
				}
			}
		}
	}

	return validationOk()
}
