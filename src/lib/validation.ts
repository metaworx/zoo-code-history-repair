/**
 * @file src/lib/validation.ts
 *
 * Corruption detection: validator-driven inspectTaskDir plus the issue-to-
 * CorruptionReason translation layer with per-file source annotation.
 */

import path from "node:path"
import fs from "node:fs/promises"
import type { CorruptionReason, HistoryItem, TaskCorruption } from "../types.js"
import {
	API_HISTORY_NAME,
	DEFAULT_INDEX_NAME,
	HISTORY_ITEM_NAME,
	TASK_METADATA_NAME,
	UI_MESSAGES_NAME,
} from "./paths.js"
import { JsonFileTransaction, resolveTarget } from "./file.js"
import { rebuildUiMessages } from "./rebuildUiMessages.js"
import { validateIndex } from "./validate/index.js"
import { validateHistoryItem } from "./validate/historyItem.js"
import { validateApiConversationHistory, validateInterruptedTask } from "./validate/apiConversationHistory.js"
import { validateUiMessages, validateUiSync } from "./validate/uiMessages.js"
import { validateTaskMetadata } from "./validate/taskMetadata.js"
import { resolveRoot } from "./cliContext.js"

const PLACEHOLDER_TASK_RE = /^Task\s*#\s*\d+(\s*\((Incomplete|No messages)\))?$/i

export type Severity = "error" | "warning"

export type ValidateResult = { file: string; result: ValidationResult }

export type ValidatorFn = (data: unknown) => ValidationResult

export interface InspectOptions {
	verifyUiSync?: boolean
	/** When false, warning-level validation issues are not mapped to corruption reasons. Default true. */
	showWarnings?: boolean
	/** Known task ids (directories) used to surface `missing_task_dir` for referenced-but-missing tasks. */
	knownTaskIds?: Set<string>
}

export interface ValidationIssue {
	/** Machine-readable issue code, e.g. "MISSING_ID", "INVALID_UUID", "STATUS_UNKNOWN" */
	code: string
	severity: Severity
	/** Dotted path to the field, e.g. "entries[3].tokensIn" or "tokensIn" */
	field: string
	message: string
	context?: Record<string, unknown>
}

export interface ValidationResult {
	/** False if any error-level issues exist */
	valid: boolean | null
	issues: ValidationIssue[]
	errorCount: number
	warningCount: number
}

export function isPlaceholderTaskName(task?: string): boolean {
	if (!task || !task.trim()) return true
	return PLACEHOLDER_TASK_RE.test(task.trim())
}

/** Build sorted comma-separated source string from a set of source abbreviations. */
function joinSources(sources: Set<string>): string {
	return [...sources].sort().join(",")
}

/** Map validator issue codes to CorruptionReason (context-free). */
function issueToReason(issue: { code: string; field?: string }): CorruptionReason | null {
	const map: Record<string, CorruptionReason> = {
		PLACEHOLDER_TASK: "placeholder_task_name",
		ZERO_SIZE: "zero_size",
		MISSING_TASK: "missing_task_text",
		MISSING_SIZE: "zero_size",
		ZERO_TOKENS_IN: "zero_tokens",
		ZERO_TOKENS_OUT: "zero_tokens",
		ZERO_TOTAL_COST: "zero_tokens",
		EMPTY_ARRAY: "empty_ui_messages",
		INTERRUPTED_TASK: "interrupted_task",
		UI_SYNC_MISMATCH: "ui_sync_mismatch",
		// Zod built-in codes mapped to reasons when on specific fields
		invalid_type: "missing_task_text", // when field is "task", treated as missing_task_text
	}
	if (map[issue.code]) {
		// invalid_type is only missing_task_text when on the "task" field
		if (issue.code === "invalid_type" && issue.field !== "task") return null
		return map[issue.code]
	}
	return null
}

/** File basename to source abbreviation for CorruptionReason.source */
function fileSource(filePath: string): string {
	const base = path.basename(filePath)
	if (base === HISTORY_ITEM_NAME) return "hi"
	if (base === API_HISTORY_NAME) return "ach"
	if (base === UI_MESSAGES_NAME) return "uim"
	if (base === TASK_METADATA_NAME) return "tmd"
	return base
}

async function validateAndMap(
	filePath: string,
	fileName: string,
): Promise<{
	data: unknown
	reasons: Array<{ reason: CorruptionReason; source: string }>
	errors: number
	warnings: number
}> {
	const tx = new JsonFileTransaction(filePath)
	await tx.load(false)
	const parseFailed = tx.hadParseError()
	const result = await tx.validate()
	const data = tx.getData()
	const codes = new Set(result.issues.map((i) => i.code))
	let errors = 0
	let warnings = 0
	const reasons: Array<{ reason: CorruptionReason; source: string }> = []

	for (const issue of result.issues) {
		if (issue.severity === "error") errors++
		else warnings++
	}

	// zero_tokens requires all three zero-field codes present
	const hasAllZeroTokens = codes.has("ZERO_TOKENS_IN") && codes.has("ZERO_TOKENS_OUT") && codes.has("ZERO_TOTAL_COST")

	for (const issue of result.issues) {
		if (issue.code === "NOT_FOUND") {
			if (parseFailed) {
				reasons.push({ reason: "invalid_json", source: fileSource(filePath) })
			} else if (fileName === HISTORY_ITEM_NAME) {
				reasons.push({ reason: "missing_history_item", source: "hi" })
			}
			continue
		}
		// Skip individual zero-token codes; only report if all three present
		if (issue.code === "ZERO_TOKENS_IN" || issue.code === "ZERO_TOKENS_OUT" || issue.code === "ZERO_TOTAL_COST") {
			if (!hasAllZeroTokens) continue
		}
		const reason =
			issue.code === "EMPTY_ARRAY" && fileName === API_HISTORY_NAME ? "empty_api_history" : issueToReason(issue)
		if (reason) reasons.push({ reason, source: fileSource(filePath) })
	}

	return { data, reasons, errors, warnings }
}

const REFERENCE_FIELDS = [
	"parentTaskId",
	"rootTaskId",
	"delegatedToId",
	"awaitingChildId",
	"completedByChildId",
] as const

/** Task IDs an index entry references via its cross-reference fields. */
export function referencedTaskIds(item: HistoryItem): string[] {
	const refs: string[] = []
	for (const field of REFERENCE_FIELDS) {
		const v = item[field]
		if (typeof v === "string" && v.length > 0) refs.push(v)
	}
	const childIds = item.childIds
	if (Array.isArray(childIds)) {
		for (const c of childIds) {
			if (typeof c === "string" && c.length > 0) refs.push(c)
		}
	}
	return refs
}

export async function inspectTaskDir(
	taskId: string,
	dir: string,
	indexItem?: HistoryItem | null,
	options: InspectOptions = {},
): Promise<TaskCorruption> {
	const reasonMap = new Map<CorruptionReason, Set<string>>()
	let errorCount = 0
	let warningCount = 0
	const showWarnings = options.showWarnings !== false

	const add = (reason: CorruptionReason, source: string) => {
		const sources = reasonMap.get(reason)
		if (sources) {
			sources.add(source)
		} else {
			reasonMap.set(reason, new Set([source]))
		}
	}

	// File-level validation via JsonFileTransaction with auto-registered validators
	const historyPath = path.join(dir, HISTORY_ITEM_NAME)
	const apiPath = path.join(dir, API_HISTORY_NAME)
	const uiPath = path.join(dir, UI_MESSAGES_NAME)

	// Parallel validation of three independent files
	const [hiResult, apiResult, uiResult] = await Promise.all([
		validateAndMap(historyPath, HISTORY_ITEM_NAME),
		validateAndMap(apiPath, API_HISTORY_NAME),
		validateAndMap(uiPath, UI_MESSAGES_NAME),
	])

	const diskItem = hiResult.data as HistoryItem | null
	const api = apiResult.data as unknown[] | null
	const ui = uiResult.data as unknown[] | null

	// Merge results
	errorCount += hiResult.errors + apiResult.errors + uiResult.errors
	warningCount += hiResult.warnings + apiResult.warnings + uiResult.warnings

	// task_metadata.json is optional; only its JSON parse failure is corruption.
	const tmTx = new JsonFileTransaction(path.join(dir, TASK_METADATA_NAME))
	await tmTx.load(false)
	if (tmTx.hadParseError()) {
		add("invalid_json", fileSource(path.join(dir, TASK_METADATA_NAME)))
		errorCount++
	}

	for (const r of [hiResult, apiResult, uiResult]) {
		for (const { reason, source } of r.reasons) {
			const sources = reasonMap.get(reason)
			if (sources) {
				sources.add(source)
			} else {
				reasonMap.set(reason, new Set([source]))
			}
		}
	}

	// Cross-file validators (not auto-registered — take multiple inputs)
	if (
		showWarnings &&
		options.verifyUiSync &&
		Array.isArray(api) &&
		api.length > 0 &&
		Array.isArray(ui) &&
		ui.length > 0
	) {
		const reconstructed = rebuildUiMessages(api as Parameters<typeof rebuildUiMessages>[0], {
			status: diskItem?.status,
		})
		if (reconstructed.length > 0) {
			const syncResult = validateUiSync(ui, reconstructed)
			for (const issue of syncResult.issues) {
				if (issue.severity === "error") errorCount++
				else warningCount++
				const reason = issueToReason(issue)
				if (reason) add(reason, "uim,ach")
			}
		}
	}

	// Interrupted task detection (warning-level only)
	if (showWarnings && Array.isArray(api) && api.length > 0) {
		const intResult = validateInterruptedTask(api)
		for (const issue of intResult.issues) {
			if (issue.severity === "error") errorCount++
			else warningCount++
			const reason = issueToReason(issue)
			if (reason) add(reason, "ach")
		}
	}

	// Index item checks (no file to validate — manual checks)
	if (indexItem) {
		if (isPlaceholderTaskName(indexItem.task)) {
			add("placeholder_task_name", "idx")
			errorCount++
		}
		if (indexItem.size === 0 || indexItem.size == null) {
			add("zero_size", "idx")
			errorCount++
		}
		if (options.knownTaskIds) {
			for (const refId of referencedTaskIds(indexItem)) {
				if (!options.knownTaskIds.has(refId)) {
					add("missing_task_dir", "idx")
					errorCount++
					break
				}
			}
		}
	}

	// Convert map to sorted array
	const reasons = [...reasonMap.entries()].map(([reason, sources]) => ({
		reason,
		source: joinSources(sources),
	}))

	// v0.3.0: gate interrupted_task — only flag when co-occurring
	// with other corruption. Solo interrupted_task = user simply moved on.
	if (reasons.length === 1 && reasons[0].reason === "interrupted_task") {
		reasons.length = 0
	}

	return {
		taskId,
		dir,
		reasons,
		indexItem: indexItem ?? null,
		diskItem,
		errorCount,
		warningCount,
	}
}

export function validationOk(): ValidationResult {
	return { valid: true, issues: [], errorCount: 0, warningCount: 0 }
}

export function error(
	code: string,
	field: string,
	message: string,
	context?: Record<string, unknown>,
): ValidationIssue {
	return { code, severity: "error", field, message, context }
}

export function warning(
	code: string,
	field: string,
	message: string,
	context?: Record<string, unknown>,
): ValidationIssue {
	return { code, severity: "warning", field, message, context }
}

export function getValidatorByFile(filePath: string): ValidatorFn | undefined {
	const base = path.basename(filePath)

	if (base === DEFAULT_INDEX_NAME) return validateIndex

	if (base === HISTORY_ITEM_NAME) return validateHistoryItem

	if (base === API_HISTORY_NAME) return validateApiConversationHistory

	if (base === UI_MESSAGES_NAME) return validateUiMessages

	if (base === TASK_METADATA_NAME) return validateTaskMetadata

	return undefined
}

export async function validatePath(target: string | undefined): Promise<ValidateResult[]> {
	const root = resolveRoot()
	const resolved = resolveTarget(target, root)

	const results: ValidateResult[] = []

	let stat: Awaited<ReturnType<typeof fs.stat>> | undefined
	try {
		stat = await fs.stat(resolved)
	} catch {
		throw new Error(`file not found: ${resolved}`)
	}

	if (stat.isDirectory()) {
		// Detect if this is a task directory (contains task JSON files)
		let isTaskDir = false
		try {
			await fs.access(path.join(resolved, HISTORY_ITEM_NAME))
			isTaskDir = true
		} catch {
			// not a task dir
		}

		if (isTaskDir) {
			// Validate a single task directory's files
			for (const f of [HISTORY_ITEM_NAME, API_HISTORY_NAME, UI_MESSAGES_NAME, TASK_METADATA_NAME]) {
				const fp = path.join(resolved, f)
				try {
					await fs.access(fp)
					const file = new JsonFileTransaction(fp)
					await file.load(false)
					results.push({ file: fp, result: await file.validate() })
				} catch {
					// file doesn't exist, skip
				}
			}

			// Also validate the _index.json entry for this task with cross-references
			const parentDir = path.dirname(resolved)
			const indexPath = path.join(parentDir, DEFAULT_INDEX_NAME)
			try {
				await fs.access(indexPath)
				const indexTx = new JsonFileTransaction(indexPath)
				await indexTx.load(false)
				const indexData = indexTx.getData() as
					| Array<{ id: string }>
					| {
					entries: Array<{ id: string }>
				}
					| null
				const entries: Array<Record<string, unknown>> = Array.isArray(indexData)
					? (indexData as Array<Record<string, unknown>>)
					: (indexData as { entries: Array<Record<string, unknown>> })?.entries ?? []

				const fullIndex = new Map<string, Record<string, unknown>>()
				for (const e of entries) {
					if (e.id && typeof e.id === "string") fullIndex.set(e.id, e)
				}

				const taskId = path.basename(resolved)
				const entry = fullIndex.get(taskId)
				if (entry) {
					const entryResult = validateHistoryItem(entry, fullIndex)
					results.push({ file: `${indexPath}:entries[${taskId}]`, result: entryResult })
				}
			} catch {
				// index doesn't exist, skip
			}
		} else {
			// Validate all task dirs + index (storage root)
			const indexPath = path.join(resolved, DEFAULT_INDEX_NAME)
			try {
				await fs.access(indexPath)
				const file = new JsonFileTransaction(indexPath)
				await file.load(false)
				results.push({ file: indexPath, result: await file.validate() })
			} catch {
				// no index file
			}

			const entries = await fs.readdir(resolved, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isDirectory() || entry.name.startsWith(".")) continue
				const taskDir = path.join(resolved, entry.name)
				for (const f of [HISTORY_ITEM_NAME, API_HISTORY_NAME, UI_MESSAGES_NAME, TASK_METADATA_NAME]) {
					const fp = path.join(taskDir, f)
					try {
						await fs.access(fp)
						const file = new JsonFileTransaction(fp)
						await file.load(false)
						results.push({ file: fp, result: await file.validate() })
					} catch {
						// file doesn't exist, skip
					}
				}
			}
		}
	} else {
		const file = new JsonFileTransaction(resolved)
		await file.load(false)
		results.push({ file: resolved, result: await file.validate() })
	}

	return results
}
