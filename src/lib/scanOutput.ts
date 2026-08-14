/**
 * @file src/lib/scanOutput.ts
 *
 * Scan output helpers: entry counting, recoverability scoring, and the
 * structured per-field recoverability report.
 */

import fs from "node:fs"
import path from "node:path"
import type { CorruptionReason, TaskCorruption } from "../types.js"
import { API_HISTORY_NAME } from "./paths.js"
import { collectBackupPaths } from "./file.js"
import { extractTaskFromApiHistory } from "./rebuildTaskField.js"
import { isPlaceholderTaskName } from "./validation.js"
import {
	nonEmptyString,
	positiveNumber,
	readBackupEntries,
	recoverFields,
	recoverTokens,
	resolveReferences,
	type ReferenceSource,
} from "./resolveReferences.js"

/** Count entries in a JSON array file. Returns 0 if missing or not an array. */
export function countEntries(dir: string | undefined, filename: string): number {
	if (!dir) return 0
	try {
		const raw = fs.readFileSync(path.join(dir, filename), "utf8")
		const data = JSON.parse(raw)
		return Array.isArray(data) ? data.length : 0
	} catch {
		return 0
	}
}

/**
 * Compute a recoverability percentage for a corrupted task.
 * Each CorruptionReason contributes to recoverable or unrecoverable based
 * on whether we have the data needed to fix it (ACH, index, etc.).
 */
export function recoverabilityScore(c: TaskCorruption): string {
	const reasons = c.reasons
	if (reasons.length === 0) return "100%"

	const hasIndex = c.indexItem != null
	const hasAch = c.dir ? countEntries(c.dir, API_HISTORY_NAME) > 0 : false
	const idxHasTokens = (c.indexItem?.tokensIn ?? 0) > 0

	let recoverable = 0
	const total = reasons.length

	for (const { reason } of reasons) {
		switch (reason as CorruptionReason) {
			case "placeholder_task_name":
				recoverable += hasAch ? 1 : 0
				break
			case "zero_tokens":
				recoverable += idxHasTokens ? 1 : hasAch ? 0.5 : 0
				break
			case "zero_size":
				recoverable += 1
				break
			case "missing_task_text":
				recoverable += hasAch ? 1 : 0
				break
			case "empty_ui_messages":
				recoverable += hasAch ? 1 : 0
				break
			case "empty_api_history":
			case "missing_history_item":
			case "invalid_json":
			case "missing_task_dir":
			case "index_orphan":
				recoverable += 0
				break
			case "interrupted_task":
				recoverable += 0
				break
			case "ui_sync_mismatch":
				recoverable += hasAch ? 1 : 0
				break
			case "folder_orphan":
				recoverable += hasIndex ? 1 : 0
				break
			default:
				recoverable += 0
		}
	}

	const pct = Math.round((recoverable / total) * 100)
	return `${pct}%`
}

/** Format a label:value pair with aligned values (label width = 16). */
export function align(label: string, value: string): string {
	return `  ${label.padEnd(17)}${value}`
}

/** Same as align() but without the 2-space indent — for top-level summary blocks. */
export function alignSummary(label: string, value: string): string {
	return `${label.padEnd(19)}${value}`
}

// ===== Structured per-field recoverability (L4) =====

export type RecoverabilitySource = "ach" | "index" | "backup" | "default" | "none"
export type RecoverabilityConfidence = "high" | "medium" | "low"

/** Recoverability of a single field: where its post-repair value will come from and how sure we are. */
export interface FieldRecoverability {
	source: RecoverabilitySource
	confidence: RecoverabilityConfidence
	/** Post-repair value, or null when the field cannot be recovered. */
	estimatedValue: unknown
}

/** Structured per-field recoverability report for a corrupted task. */
export interface PerFieldRecoverability {
	tokensIn: FieldRecoverability
	tokensOut: FieldRecoverability
	totalCost: FieldRecoverability
	cacheReads: FieldRecoverability
	cacheWrites: FieldRecoverability
	number: FieldRecoverability
	mode: FieldRecoverability
	workspace: FieldRecoverability
	apiConfigName: FieldRecoverability
	task: FieldRecoverability
	refs: FieldRecoverability
}

/** Read the task's api_conversation_history.json array, or null when absent/invalid. */
function readApiHistory(dir: string | undefined): unknown[] | null {
	if (!dir) return null
	try {
		const data = JSON.parse(fs.readFileSync(path.join(dir, API_HISTORY_NAME), "utf8"))
		return Array.isArray(data) ? data : null
	} catch {
		return null
	}
}

const REF_FIELDS = [
	"parentTaskId",
	"rootTaskId",
	"childIds",
	"completedByChildId",
	"delegatedToId",
	"awaitingChildId",
] as const

function refsValue(entry: Record<string, unknown>): Record<string, unknown> | null {
	const out: Record<string, unknown> = {}
	for (const field of REF_FIELDS) {
		if (entry[field] !== undefined) out[field] = entry[field]
	}
	return Object.keys(out).length > 0 ? out : null
}

const SOURCE_ABBREV: Record<RecoverabilitySource, string> = {
	ach: "ach",
	index: "idx",
	backup: "bak",
	default: "def",
	none: "—",
}

const CONFIDENCE_ABBREV: Record<RecoverabilityConfidence, string> = {
	high: "high",
	medium: "med",
	low: "low",
}

/** Compact single-line summary of the per-field recoverability report. */
export function formatPerFieldSummary(r: PerFieldRecoverability): string {
	return (Object.keys(r) as Array<keyof PerFieldRecoverability>)
		.map((field) => {
			const f = r[field]
			return `${field}(${SOURCE_ABBREV[f.source]},${CONFIDENCE_ABBREV[f.confidence]})`
		})
		.join(" ")
}

/**
 * Compute the structured per-field recoverability for a corrupted task.
 *
 * This is a read-only simulation of what `repairTaskDir` would do, reusing the
 * exact recovery functions (`recoverFields`, `resolveReferences`,
 * `extractTaskFromApiHistory`, and the token estimators) rather than a parallel
 * approximation. Only a private clone of the entry is mutated.
 *
 * Per-field semantics:
 * - `source` — where the post-repair value comes from: `ach` (api conversation
 *   history: task extraction, token estimation, reference recovery), `index`
 *   (the `_index.json` entry), `backup` (task/root index backups), `default`
 *   (configured fallback), or `none`.
 * - `confidence` — `high` for an exact value (present in the entry or copied
 *   from index/backup/ACH), `medium` for an estimated/derived value (token
 *   estimation), `low` for a default or an unrecoverable value.
 * - `estimatedValue` — the value repair will leave, or null when unrecoverable.
 *
 * `source: "none"` + `confidence: "high"` marks a field that already holds an
 * exact value and needs no recovery; `source: "none"` + `confidence: "low"`
 * marks a field repair cannot fill.
 */
export async function perFieldRecoverability(
	c: TaskCorruption,
	fullIndex?: Map<string, Record<string, unknown>>,
): Promise<PerFieldRecoverability> {
	const taskId = c.taskId
	const ach = readApiHistory(c.dir)

	// Backup paths — same sources repairTaskDir searches (Block 2 L2/L3/L9).
	const { taskBackupPaths, indexBackupPaths } = c.dir
		? await collectBackupPaths(c.dir, path.dirname(c.dir))
		: { taskBackupPaths: [], indexBackupPaths: [] }

	// Repair target: the disk history_item.json, else the L1 rebuild base {id}.
	const entry: Record<string, unknown> = c.diskItem ? { ...c.diskItem } : { id: taskId }

	const recovered = new Map<string, { source: RecoverabilitySource; confidence: RecoverabilityConfidence }>()
	const mark = (field: string, source: RecoverabilitySource, confidence: RecoverabilityConfidence): void => {
		if (!recovered.has(field)) recovered.set(field, { source, confidence })
	}

	// --- 1. Token recovery (mirrors repairTaskDir step 3, run before recoverFields) ---
	const tokenRecovery = recoverTokens(entry, { indexEntry: c.indexItem ?? null, ach })
	for (const change of tokenRecovery.changes) {
		const source: RecoverabilitySource =
			change.from === "index" ? "index" : change.from === "default" ? "default" : "ach"
		const confidence: RecoverabilityConfidence =
			change.from === "index" ? "high" : change.from === "default" ? "low" : "medium"
		mark(change.field, source, confidence)
	}

	// --- 2. Backup-source field recovery (recoverFields — Block 2 L2/L3) ---
	const fieldRecovery = recoverFields(entry, {
		indexEntry: c.indexItem ?? undefined,
		taskBackups: readBackupEntries(taskBackupPaths),
		indexBackups: readBackupEntries(indexBackupPaths).filter((e) => e.id === taskId),
	})
	for (const r of fieldRecovery.recovered) {
		recovered.set(r.field, { source: r.source, confidence: r.source === "default" ? "low" : "high" })
	}

	// --- 3. task field recovery (extractTaskFromApiHistory — mirrors repairTaskDir step 3) ---
	const taskText = typeof entry.task === "string" ? entry.task.trim() : ""
	if (!taskText || isPlaceholderTaskName(taskText)) {
		const extracted = extractTaskFromApiHistory(ach ?? [])
		if (extracted) {
			entry.task = extracted
			mark("task", "ach", "high")
		}
	}

	// --- 4. Reference-field recovery (resolveReferences — Block 2) ---
	let refsRecovered: Array<{ field: string; source: ReferenceSource }> = []
	if (c.diskItem && fullIndex) {
		refsRecovered = resolveReferences(entry, {
			fullIndex,
			taskIds: new Set(fullIndex.keys()),
			ach,
			backups: [...taskBackupPaths, ...indexBackupPaths],
		}).recovered
	}

	// --- Assemble the per-field report ---
	const final = (field: string, valid: boolean): FieldRecoverability => {
		const r = recovered.get(field)
		if (r) return { source: r.source, confidence: r.confidence, estimatedValue: entry[field] ?? null }
		if (valid) return { source: "none", confidence: "high", estimatedValue: entry[field] }
		return { source: "none", confidence: "low", estimatedValue: null }
	}

	const refs = refsValue(entry)
	let refsReport: FieldRecoverability
	if (refsRecovered.length > 0) {
		const order: ReferenceSource[] = ["ach", "index", "backup"]
		const source = order.find((s) => refsRecovered.some((r) => r.source === s)) ?? "backup"
		refsReport = { source, confidence: "high", estimatedValue: refs }
	} else if (refs) {
		refsReport = { source: "none", confidence: "high", estimatedValue: refs }
	} else {
		refsReport = { source: "none", confidence: "low", estimatedValue: null }
	}

	return {
		tokensIn: final("tokensIn", positiveNumber(entry.tokensIn) !== null),
		tokensOut: final("tokensOut", positiveNumber(entry.tokensOut) !== null),
		totalCost: final("totalCost", positiveNumber(entry.totalCost) !== null),
		cacheReads: final("cacheReads", positiveNumber(entry.cacheReads) !== null),
		cacheWrites: final("cacheWrites", positiveNumber(entry.cacheWrites) !== null),
		number: final("number", positiveNumber(entry.number) !== null),
		mode: final("mode", nonEmptyString(entry.mode) !== null),
		workspace: final("workspace", nonEmptyString(entry.workspace) !== null),
		apiConfigName: final("apiConfigName", nonEmptyString(entry.apiConfigName) !== null),
		task: final("task", nonEmptyString(entry.task) !== null && !isPlaceholderTaskName(String(entry.task))),
		refs: refsReport,
	}
}
