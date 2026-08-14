/**
 * @file src/lib/scan.ts
 *
 * Storage scanning: cross-reference _index.json against task directories and
 * report corruption (including invalid_json and missing_task_dir).
 */

import path from "node:path"
import type { CorruptionReason, HistoryItem, ScanResult, TaskCorruption } from "../types.js"
import { DEFAULT_INDEX_NAME, listTaskDirs, resolveIndexPath, resolveTasksDir } from "./paths.js"
import { IndexTransaction } from "./IndexTransaction.js"
import { setRoot } from "./cliContext.js"
import { inspectTaskDir, referencedTaskIds } from "./validation.js"
import type { InspectOptions } from "./validation.js"

export interface ScanOptions extends InspectOptions {
	showWarnings?: boolean
}

export async function scanStorage(storageRoot: string, options: ScanOptions = {}): Promise<ScanResult> {
	setRoot(storageRoot)
	const tasksDir = resolveTasksDir(storageRoot)
	const indexPath = resolveIndexPath(tasksDir)

	const idx = new IndexTransaction()
	const indexItems = (await idx.getEntries()) as HistoryItem[]

	const dirs = listTaskDirs(tasksDir)
	const dirIds = new Set(dirs.map((d) => path.basename(d)))
	const byId = new Map(indexItems.map((i) => [i.id, i]))

	const corruptions: TaskCorruption[] = []
	const byTaskId = new Map<string, TaskCorruption>()

	// folders on disk
	for (const dir of dirs) {
		const taskId = path.basename(dir)
		const c = await inspectTaskDir(taskId, dir, byId.get(taskId) ?? null, {
			verifyUiSync: options.verifyUiSync,
			showWarnings: options.showWarnings,
			knownTaskIds: dirIds,
		})
		if (!byId.has(taskId)) c.reasons.push({ reason: "folder_orphan", source: "hi" })
		if (c.reasons.length) {
			corruptions.push(c)
			byTaskId.set(taskId, c)
		}
	}

	// index entries without folders
	for (const item of indexItems) {
		if (!dirIds.has(item.id)) {
			const reasons: Array<{ reason: CorruptionReason; source: string }> = [
				{ reason: "index_orphan", source: "idx" },
			]
			let idxErrCount = 1 // index_orphan
			if (item.size === 0) {
				reasons.push({ reason: "zero_size", source: "idx" })
				idxErrCount++
			}
			const c: TaskCorruption = {
				taskId: item.id,
				reasons,
				indexItem: item,
				diskItem: null,
				errorCount: idxErrCount,
				warningCount: 0,
			}
			corruptions.push(c)
			byTaskId.set(item.id, c)
		}
	}

	// missing_task_dir for index-orphan entries referencing a missing directory.
	// Entries with a directory surface this via inspectTaskDir (knownTaskIds).
	for (const item of indexItems) {
		if (dirIds.has(item.id)) continue
		if (!referencedTaskIds(item).some((refId) => !dirIds.has(refId))) continue
		const existing = byTaskId.get(item.id)
		if (existing) {
			existing.reasons.push({ reason: "missing_task_dir", source: "idx" })
			existing.errorCount++
		}
	}

	// invalid_json: the index file itself failed to parse
	if (idx.hadParseError()) {
		corruptions.push({
			taskId: DEFAULT_INDEX_NAME,
			reasons: [{ reason: "invalid_json", source: "idx" }],
			indexItem: null,
			diskItem: null,
			errorCount: 1,
			warningCount: 0,
		})
	}

	let totalErrorCount = 0
	let totalWarningCount = 0
	for (const c of corruptions) {
		totalErrorCount += c.errorCount
		totalWarningCount += c.warningCount
	}

	return {
		storageRoot,
		tasksDir,
		indexPath,
		indexItems,
		taskDirs: dirs,
		corruptions,
		totalErrorCount,
		totalWarningCount,
		filesChecked: dirs.length + 1, // task dirs + _index.json
	}
}
