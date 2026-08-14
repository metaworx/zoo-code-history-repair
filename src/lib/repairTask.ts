import path from "node:path"
import type { HistoryItem } from "../types.js"
import {
	API_HISTORY_NAME,
	DEFAULT_INDEX_NAME,
	HISTORY_ITEM_NAME,
	TASK_METADATA_NAME,
	UI_MESSAGES_NAME,
} from "./paths.js"
import { JsonFileTransaction, listBackupsForTask } from "./file.js"
import { inspectTaskDir, isPlaceholderTaskName } from "./validation.js"
import { readPartialJsonArray } from "./io/readJson.js"
import { rebuildUiMessages } from "./rebuildUiMessages.js"
import { extractTaskFromApiHistory } from "./rebuildTaskField.js"
import {
	recoverFields,
	readBackupEntries,
	type FieldSource,
	type ReferenceSource,
	resolveReferences,
} from "./resolveReferences.js"
import { computeTaskSize } from "./size.js"
import { estimateCacheReads, estimateTokensIn, estimateTokensOut, estimateTotalCost } from "./estimateTokens.js"

export interface RepairResult {
	taskId: string
	uiRepaired: boolean
	taskRepaired: boolean
	sizeRepaired: boolean
	tokensRepaired: boolean
	refsRepaired: boolean
	refsRecoverySources?: Array<ReferenceSource>
	interruptedRepaired: boolean
	tokensRecoverySource?: "index" | "estimate" | "user_override"
	apiTruncated: boolean
	/** True when history_item.json was rebuilt from scratch (L1 --force-rebuild-hi). */
	hiRebuilt: boolean
	/** True when missing/zero fields were recovered from backups or defaults (L2/L3). */
	fieldsRepaired: boolean
	fieldRecoverySources?: Array<FieldSource>
	unrepairable: boolean
	errors: string[]
	touchedFiles: string[]
	backups: string[]
	/** User-facing hint (e.g. delete suggestion for unrepairable tasks). */
	hint?: string
}

/** Format repair result as human-readable parts array (e.g. ["ui(ach→uim)", "task(ach→hi)"]). */
export function formatRepairParts(r: RepairResult): string[] {
	const parts: string[] = []
	if (r.uiRepaired) parts.push("ui(ach→uim)")
	if (r.taskRepaired) parts.push("task(ach→hi)")
	if (r.sizeRepaired) parts.push("size(calc→hi)")
	if (r.tokensRepaired) {
		const src = r.tokensRecoverySource ?? "?"
		parts.push(`tokens(${src}→hi)`)
	}
	if (r.interruptedRepaired) {
		parts.push("ach(interrupted→ach)")
	}
	if (r.refsRepaired) {
		for (const src of r.refsRecoverySources ?? []) {
			parts.push(`refs(${src}→hi)`)
		}
	}
	if (r.fieldsRepaired) {
		for (const src of r.fieldRecoverySources ?? []) {
			parts.push(`fields(${src}→hi)`)
		}
	}
	if (r.hiRebuilt) parts.push("hi(rebuild→hi)")
	return parts
}

/** Return the id of the last assistant tool_use when the ACH ends with an unanswered tool call. */
function lastUnansweredToolUseId(apiHistory: unknown[]): string | null {
	if (!Array.isArray(apiHistory) || apiHistory.length === 0) return null
	const lastTurn = apiHistory[apiHistory.length - 1] as Record<string, unknown> | null
	if (!lastTurn || lastTurn.role !== "assistant" || !Array.isArray(lastTurn.content)) return null
	const blocks = lastTurn.content as Array<Record<string, unknown>>
	if (blocks.length === 0) return null
	const lastBlock = blocks[blocks.length - 1]
	if (!lastBlock || lastBlock.type !== "tool_use") return null
	return typeof lastBlock.id === "string" ? lastBlock.id : null
}

/**
 * Derive a history_item `ts` for a rebuild: first numeric `ts` in the ACH,
 * else the first numeric `ts` in backup entry metadata. Returns null when no
 * source carries a timestamp.
 */
function deriveHistoryItemTs(apiHistory: unknown[], backupEntries: Array<Record<string, unknown>>): number | null {
	if (Array.isArray(apiHistory)) {
		for (const turn of apiHistory) {
			if (turn && typeof turn === "object") {
				const ts = (turn as Record<string, unknown>).ts
				if (typeof ts === "number") return ts
			}
		}
	}
	for (const e of backupEntries) {
		if (typeof e.ts === "number") return e.ts
	}
	return null
}

/**
 * Fully repair a single task directory:
 *  1. Rebuild ui_messages.json from api_conversation_history.json
 *  2. Rebuild history_item.json task field from ACH
 *  3. Recompute history_item.json size field
 *
 * All writes are compact JSON. Backups are created before overwriting.
 */
export interface RepairTaskOptions {
	dryRun?: boolean
	backup?: boolean
	/** Force ui_messages.json rebuild even when not corrupt. */
	forceUim?: boolean
	/** User-supplied tokensIn override. 0 = disable estimation (keep zeros). */
	fixedInputToken?: number
	/** Index entries for token recovery lookup. */
	indexItems?: Array<{
		id: string
		tokensIn?: number
		tokensOut?: number
		totalCost?: number
		cacheReads?: number
		cacheWrites?: number
	}>
	/** Full index (id → entry) for cross-task reference-field recovery. */
	fullIndex?: Map<string, Record<string, unknown>>
	/** Known task ids for filtering reference-field recovery candidates. */
	taskIds?: Set<string>
	/** Rebuild a missing history_item.json from ACH + backups (L1). */
	forceRebuildHi?: boolean
}

export async function repairTaskDir(taskDir: string, options: RepairTaskOptions = {}): Promise<RepairResult> {
	const taskId = path.basename(taskDir)
	const result: RepairResult = {
		taskId,
		uiRepaired: false,
		taskRepaired: false,
		sizeRepaired: false,
		tokensRepaired: false,
		refsRepaired: false,
		interruptedRepaired: false,
		apiTruncated: false,
		hiRebuilt: false,
		fieldsRepaired: false,
		unrepairable: false,
		errors: [],
		touchedFiles: [],
		backups: [],
	}

	const uiPath = path.join(taskDir, UI_MESSAGES_NAME)
	const hiPath = path.join(taskDir, HISTORY_ITEM_NAME)
	const apiPath = path.join(taskDir, API_HISTORY_NAME)
	const tmPath = path.join(taskDir, TASK_METADATA_NAME)

	// Read existing files via JsonFileTransaction — tolerant reads for repair
	const apiTx = new JsonFileTransaction(apiPath, false, [])
	const hiTx = new JsonFileTransaction(hiPath, false, [])
	const tmTx = new JsonFileTransaction(tmPath, false, [])

	await apiTx.load(false)
	let apiHistory = apiTx.getData() as unknown[] | null
	await hiTx.load(false)
	const historyItem = hiTx.getData() as HistoryItem | null
	await tmTx.load(false)
	const taskMetadata = tmTx.getData()

	if (!apiHistory || !Array.isArray(apiHistory)) {
		const partial = await readPartialJsonArray(apiPath)
		if (partial && partial.data.length > 0) {
			apiHistory = partial.data
			if (partial.truncated) {
				result.apiTruncated = true
			}
		}
	}

	if (!apiHistory || !Array.isArray(apiHistory)) {
		result.unrepairable = true
		result.errors.push(`missing or invalid ${API_HISTORY_NAME} — cannot repair`)
		result.hint = `This task cannot be repaired. Remove it with: zoo-code-history-repair delete ${taskId} --force`
		return result
	}

	// R-2: Pre-repair detection — drive repair from detected corruption reasons
	const corruption = await inspectTaskDir(taskId, taskDir, null, {})
	const reasonSet = new Set(corruption.reasons.map((r) => r.reason))

	// --- 0. §9.1 synthetic failed tool_result for interrupted tasks ---
	const interruptedToolUseId = lastUnansweredToolUseId(apiHistory)
	if (interruptedToolUseId !== null) {
		apiHistory.push({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: interruptedToolUseId,
					is_error: true,
					content: "Task was interrupted before completion.",
				},
			],
		})
		result.interruptedRepaired = true
		if (!options.dryRun) {
			apiTx.setData(apiHistory)
			const bak = await apiTx.save(true, options.backup !== false)
			if (bak) result.backups.push(bak)
		}
		if (!result.touchedFiles.includes(API_HISTORY_NAME)) {
			result.touchedFiles.push(API_HISTORY_NAME)
		}
	}

	// Backup sources shared by reference-field recovery and field recovery (L1/L2/L3).
	const tasksDir = path.dirname(taskDir)
	const taskBackupPaths: string[] = []
	for (const b of await listBackupsForTask(taskDir, [HISTORY_ITEM_NAME, "_index.task"])) {
		taskBackupPaths.push(b.bakPath)
	}
	const indexBackupPaths: string[] = []
	for (const b of await listBackupsForTask(tasksDir, [DEFAULT_INDEX_NAME])) {
		indexBackupPaths.push(b.bakPath)
	}
	const allBackupPaths = [...taskBackupPaths, ...indexBackupPaths]

	// --- 1. Repair reference fields (before UI rebuild, so newTask taskIds resolve) ---
	let hiModified = false
	if (historyItem && options.fullIndex) {
		const taskIds = options.taskIds ?? new Set(options.fullIndex.keys())
		const resolution = resolveReferences(historyItem, {
			fullIndex: options.fullIndex,
			taskIds,
			ach: apiHistory,
			backups: allBackupPaths,
		})
		if (resolution.changed) {
			result.refsRepaired = true
			result.refsRecoverySources = [...new Set(resolution.recovered.map((r) => r.source))]
			hiModified = true
		}
	}

	// --- 2. Rebuild ui_messages.json ---
	const uiTx = new JsonFileTransaction(uiPath, false, [])
	await uiTx.load(false)
	const existingUi = uiTx.getData() as unknown[] | null
	const existingIsEmpty = !Array.isArray(existingUi) || existingUi.length === 0
	const shouldRebuildUi = existingIsEmpty || options.forceUim || reasonSet.has("empty_ui_messages")

	if (shouldRebuildUi) {
		const newUi = rebuildUiMessages(apiHistory as Parameters<typeof rebuildUiMessages>[0], {
			childIds: historyItem?.childIds as string[] | undefined,
			delegatedToId: historyItem?.delegatedToId as string | undefined,
		})
		if (newUi.length > 0) {
			if (!options.dryRun) {
				uiTx.setData(newUi)
				const bak = await uiTx.save(true, options.backup !== false)
				if (bak) result.backups.push(bak)
			}
			result.uiRepaired = true
			result.touchedFiles.push(UI_MESSAGES_NAME)
		} else {
			result.errors.push("ui_messages reconstruction produced 0 events")
		}
	}

	// --- 3. Repair history_item.json task field ---
	if (historyItem) {
		let modified = hiModified

		const taskText = historyItem.task?.trim()
		const isMissing = !taskText
		const isPlaceholder = isPlaceholderTaskName(taskText ?? "")

		if (isMissing || isPlaceholder) {
			const extracted = extractTaskFromApiHistory(apiHistory)
			if (extracted) {
				historyItem.task = extracted
				result.taskRepaired = true
				modified = true
			} else {
				result.errors.push("could not extract task from api_conversation_history")
			}
		}

		// --- 3. Repair token fields ---
		if (
			historyItem.tokensIn === 0 &&
			historyItem.tokensOut === 0 &&
			historyItem.totalCost === 0 &&
			Array.isArray(apiHistory) &&
			apiHistory.length > 0
		) {
			// a. Try index recovery first
			const idxEntry = options.indexItems?.find((e) => e.id === taskId)
			if (idxEntry && idxEntry.tokensIn && idxEntry.tokensIn > 0) {
				historyItem.tokensIn = idxEntry.tokensIn
				historyItem.tokensOut = idxEntry.tokensOut ?? 0
				historyItem.totalCost = idxEntry.totalCost ?? 0
				if (idxEntry.cacheReads != null) historyItem.cacheReads = idxEntry.cacheReads
				if (idxEntry.cacheWrites != null) historyItem.cacheWrites = idxEntry.cacheWrites
				result.tokensRepaired = true
				result.tokensRecoverySource = "index"
				modified = true
			} else if (options.fixedInputToken !== undefined) {
				// b. User override (0 = disable, keep zeros)
				if (options.fixedInputToken > 0) {
					historyItem.tokensIn = options.fixedInputToken
					historyItem.tokensOut = estimateTokensOut(apiHistory as Parameters<typeof estimateTokensOut>[0])
					historyItem.totalCost = estimateTotalCost(
						historyItem.tokensIn,
						historyItem.tokensOut,
						historyItem.apiConfigName as string | undefined,
					)
					result.tokensRepaired = true
					result.tokensRecoverySource = "user_override"
					modified = true
				}
				// fixedInputToken === 0: explicitly skip estimation, keep zeros
			} else {
				// c. Default: estimate from ACH
				const estOut = estimateTokensOut(apiHistory as Parameters<typeof estimateTokensOut>[0])
				const estIn = estimateTokensIn(apiHistory as Parameters<typeof estimateTokensIn>[0])
				if (estOut > 0 || estIn > 0) {
					historyItem.tokensOut = estOut
					historyItem.tokensIn = estIn
					historyItem.totalCost = estimateTotalCost(
						estIn,
						estOut,
						historyItem.apiConfigName as string | undefined,
					)
					result.tokensRepaired = true
					result.tokensRecoverySource = "estimate"
					modified = true
				}
			}

			// Estimate cacheReads if still zero/missing after repair
			if (result.tokensRepaired && historyItem.tokensIn > 0) {
				const provider = historyItem.apiConfigName as string | undefined
				if (!historyItem.cacheReads || historyItem.cacheReads === 0) {
					historyItem.cacheReads = estimateCacheReads(historyItem.tokensIn, provider)
				}
				if (historyItem.cacheWrites === undefined || historyItem.cacheWrites === null) {
					historyItem.cacheWrites = 0
				}
			}
		}

		// --- 3b. Backup-source field recovery with defaults (L2/L3/L9) ---
		const fieldRecovery = recoverFields(historyItem, {
			indexEntry: options.indexItems?.find((e) => e.id === taskId),
			taskBackups: readBackupEntries(taskBackupPaths),
			indexBackups: readBackupEntries(indexBackupPaths).filter((e) => e.id === taskId),
		})
		if (fieldRecovery.changed) {
			result.fieldsRepaired = true
			result.fieldRecoverySources = [...new Set(fieldRecovery.recovered.map((r) => r.source))]
			modified = true
		}

		// --- 4. Recompute size (after all modifications) ---
		await uiTx.load(false)
		const uiMessages = uiTx.getData() as unknown[] | null
		const expectedSize = computeTaskSize(uiMessages ?? [], apiHistory, historyItem, taskMetadata ?? {})

		if (historyItem.size !== expectedSize) {
			historyItem.size = expectedSize
			result.sizeRepaired = true
			modified = true
		}

		if (modified && !options.dryRun) {
			hiTx.setData(historyItem)
			const bak = await hiTx.save(true, options.backup !== false)
			if (bak) result.backups.push(bak)
		}
		if (modified && !result.touchedFiles.includes(HISTORY_ITEM_NAME)) {
			result.touchedFiles.push(HISTORY_ITEM_NAME)
		}
	} else if (options.forceRebuildHi) {
		// L1: rebuild a minimum-viable history_item.json from ACH + backups.
		const extractedTask = extractTaskFromApiHistory(apiHistory)
		if (!extractedTask) {
			result.unrepairable = true
			result.errors.push(
				`missing ${HISTORY_ITEM_NAME} and no task extractable from ${API_HISTORY_NAME} — cannot rebuild`,
			)
			result.hint = `This task cannot be repaired. Remove it with: zoo-code-history-repair delete ${taskId} --force`
			return result
		}

		const rebuilt: HistoryItem = { id: taskId, task: extractedTask }
		const ts = deriveHistoryItemTs(apiHistory, readBackupEntries(allBackupPaths))
		if (ts !== null) rebuilt.ts = ts

		const fieldRecovery = recoverFields(rebuilt, {
			indexEntry: options.indexItems?.find((e) => e.id === taskId),
			taskBackups: readBackupEntries(taskBackupPaths),
			indexBackups: readBackupEntries(indexBackupPaths).filter((e) => e.id === taskId),
		})
		if (fieldRecovery.changed) {
			result.fieldsRepaired = true
			result.fieldRecoverySources = [...new Set(fieldRecovery.recovered.map((r) => r.source))]
		}

		// Recompute size (after rebuild).
		await uiTx.load(false)
		const uiMessages = uiTx.getData() as unknown[] | null
		rebuilt.size = computeTaskSize(uiMessages ?? [], apiHistory, rebuilt, taskMetadata ?? {})

		result.hiRebuilt = true

		if (!options.dryRun) {
			hiTx.setData(rebuilt)
			const bak = await hiTx.save(true, options.backup !== false)
			if (bak) result.backups.push(bak)
		}
		if (!result.touchedFiles.includes(HISTORY_ITEM_NAME)) {
			result.touchedFiles.push(HISTORY_ITEM_NAME)
		}
	} else {
		result.errors.push(`missing ${HISTORY_ITEM_NAME} — cannot repair task or size`)
		result.hint = `This task cannot be repaired. Remove it with: zoo-code-history-repair delete ${taskId} --force`
	}

	return result
}
