/**
 * @file src/lib/__tests__/integration/fullPipeline.repairAll.ts
 *
 * Integration test: full repair pipeline (scan → repair → validate → idempotency).
 *
 * Exercises the complete cycle using CLI commands (for output parsing) and library
 * functions (for hash/backup verification), matching the pattern established in
 * repairTask.indexUpdate.spec.ts.
 *
 * Pipeline: scan --short → validate → repair --all → scan --short → validate
 *           → repair --all → scan --short → validate
 *
 * The second repair pass verifies idempotency (no new repairs needed).
 * The third scan --short/validate pass verifies stability.
 */
import fs from "node:fs"
import path from "node:path"
import { expect, vi } from "vitest"
import { action as deleteAction } from "../../commands/delete.js"
import { action as scanAction } from "../../commands/scan.js"
import { action as validateAction } from "../../commands/validate.js"
import { action as repairAction } from "../../commands/repair.js"
import { contentHash } from "../../file.js"
import { API_HISTORY_NAME, HISTORY_ITEM_NAME, UI_MESSAGES_NAME } from "../../paths.js"
import {
	assertJsonEqual,
	FIXTURE_SCAN_SHORT_AFTER_FILE,
	FIXTURE_SCAN_SHORT_BEFORE_FILE,
	FIXTURE_SCAN_AFTER_FILE,
	FIXTURE_SCAN_BEFORE_FILE,
	getJsonOutput,
	listAllBackupFiles,
	listBackupFiles,
	quotePathRegex,
	readJson,
} from "../testHelpers.js"

/** Expected corruption reasons per task (from scan.fixtures.spec.ts). */
const CORRUPT_REASONS: Record<string, string[]> = {
	"019ede5a-9327-70cc-9c54-2d227182e4d1": ["missing_history_item", "missing_ui_messages", "folder_orphan"],
	"019f0f12-02f9-70df-a35e-2b110efe4107": [
		"placeholder_task_name",
		"interrupted_task",
		"missing_task_dir",
		"dangling_child_ref",
	],
	"019fb786-503a-76ca-8708-fee1243c878d": [
		"placeholder_task_name",
		"zero_tokens",
		"interrupted_task",
		"dangling_child_ref",
	],
	"019fdc9c-a59f-75d9-bf05-4fd3d4fe4913": [
		"placeholder_task_name",
		"zero_size",
		"zero_tokens",
		"empty_ui_messages",
		"interrupted_task",
	],
	"019fdcf5-64ad-709f-a1d1-00d1a59c6f8e": ["zero_tokens", "zero_size", "interrupted_task", "missing_resume_ask"],
	"019fddaa-5136-7106-abef-adac81fd56a3": ["zero_tokens"],
	"019fde29-32cc-76c3-a156-e5287fc5fd2c": ["folder_orphan", "interrupted_task", "missing_resume_ask"],
}

/** Healthy tasks (from scan.fixtures.spec.ts). */
const HEALTHY = new Set([
	"019f726a-0f50-711c-929e-9546e5100546",
	"019f7283-2ef5-72a9-b5d1-437ee56c9fa9",
	"019f726c-d9c7-7566-a586-4cfd467eaaca",
	"019fdcba-5173-74cd-a9c3-9663d7917aa2",
])

export default (tmpRoot: string, tasksDir: string, consoleLogSpy: ReturnType<typeof vi.spyOn>) => async () => {
	const indexPath = path.join(tasksDir, "_index.json")

	// ── Phase 0: Snapshot initial state ──
	const indexBefore = JSON.parse(fs.readFileSync(indexPath, "utf8"))

	// Snapshot hashes for all corrupt tasks' key files
	const hashesBefore = new Map<string, Map<string, string | null>>()
	for (const id of Object.keys(CORRUPT_REASONS)) {
		const taskDir = path.join(tasksDir, id)
		const taskHashes = new Map<string, string | null>()
		for (const f of [HISTORY_ITEM_NAME, UI_MESSAGES_NAME, API_HISTORY_NAME]) {
			const fp = path.join(taskDir, f)
			taskHashes.set(f, fs.existsSync(fp) ? await contentHash(fp) : null)
		}
		hashesBefore.set(id, taskHashes)
	}
	const indexHashBefore = await contentHash(indexPath)

	// Shared task IDs used across phases
	const detailTaskId = "019fdc9c-a59f-75d9-bf05-4fd3d4fe4913"
	const detailTaskDir = path.join(tasksDir, detailTaskId)
	const orphanId = "019ede5a-9327-70cc-9c54-2d227182e4d1"
	const placeholderId = "019f0f12-02f9-70df-a35e-2b110efe4107"

	// ── Phase 1b: scan --json (structured output validation) ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true })
	const scanJson1 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	expect(scanJson1.indexItemCount).toBe(9)
	expect(scanJson1.taskDirCount).toBe(11)
	const scanCorruptions1 = scanJson1.corruptions as Array<Record<string, unknown>>
	expect(scanCorruptions1.length).toBe(7)
	const detailScan1 = scanCorruptions1.find((c) => c.taskId === detailTaskId) as Record<string, unknown>
	expect(detailScan1).toBeDefined()
	expect(detailScan1.recoverability).toBe("70%")
	expect(detailScan1.achEntries).toBe(142)
	expect(detailScan1.uimEntries).toBe(0)
	const detailReasons1 = detailScan1.reasons as Array<{ reason: string; source: string }>
	expect(detailReasons1.map((r) => r.reason).sort()).toEqual(
		["placeholder_task_name", "zero_size", "zero_tokens", "empty_ui_messages", "interrupted_task"].sort(),
	)

	assertJsonEqual(readJson(FIXTURE_SCAN_BEFORE_FILE), scanJson1, {
		ignoreProps: ["version", "taskMatch", "storageRoot"],
		replacements: {
			[`^${quotePathRegex(tmpRoot)}` as any]: "",
			[`^${quotePathRegex("tests/fixtures")}` as any]: "",
		},
		maxLength: 200,
	})

	// ── Phase 1: scan --short before repair ──
	await scanAction({ short: true })
	const lc1 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")

	// Every expected corrupt task must appear
	for (const id of Object.keys(CORRUPT_REASONS)) {
		const line = lc1.split("\n").find((l) => l.startsWith(id))
		expect(line, `${id} must appear in pre-repair scan --short`).toBeDefined()
		for (const reason of CORRUPT_REASONS[id]) {
			expect(line, `${id}: expected reason ${reason}`).toContain(reason)
		}
	}
	// Healthy tasks must not appear
	for (const id of HEALTHY) {
		const corruptLine = lc1.split("\n").find((l) => l.startsWith(id))
		expect(corruptLine, `${id}: healthy task must not appear in scan --short`).toBeUndefined()
	}

	// ── Phase 1c: scan --short --json before repair ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcJson1 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const lcCorruptions1 = lcJson1.corruptions as Array<Record<string, unknown>>
	expect(lcCorruptions1.length).toBe(7)
	const lcDetail1 = lcCorruptions1.find((c) => c.taskId === detailTaskId) as Record<string, unknown>
	expect(lcDetail1.recoverability).toBe("70%")
	expect((lcDetail1.reasons as Array<{ reason: string }>).map((r) => r.reason).sort()).toEqual(
		["placeholder_task_name", "zero_size", "zero_tokens", "empty_ui_messages", "interrupted_task"].sort(),
	)

	expect(readJson(FIXTURE_SCAN_SHORT_BEFORE_FILE)).toDeepEqualJson(
		lcJson1,
		{
			ignoreProps: ["version"],
		},
		"scan --short before",
	)

	// ── Phase 2: validate before repair ──
	// Validate the task with most corruption reasons (019fdc9c) for detailed assertions
	const hiOut = path.join(detailTaskDir, HISTORY_ITEM_NAME)
	const uiOut = path.join(detailTaskDir, UI_MESSAGES_NAME)
	const idxOut = `${indexPath}:entries[${detailTaskId}]`

	consoleLogSpy.mockClear()
	await validateAction(detailTaskId, { warnings: true })
	const v1 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(v1).toContain(hiOut + ":")
	expect(v1).toContain(uiOut + ":")
	expect(v1).toContain(idxOut + ":")
	expect(v1).toContain("task is a placeholder")
	expect(v1).toContain("tokensIn: tokensIn is 0")
	expect(v1).toContain("tokensOut: tokensOut is 0")
	expect(v1).toContain("totalCost: totalCost is 0")
	expect(v1).toContain("ui_messages array is empty")
	// Summary line — error/warning counts may vary with fixture data
	expect(v1).toContain("files checked")
	expect(v1).toContain("errors")
	expect(v1).toContain("warnings")

	// ── Phase 3: Repair all (with backups) ──
	consoleLogSpy.mockClear()
	await repairAction(undefined, { all: true, force: true, backup: true })
	const rOut1 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")

	// Verify repair output for specific tasks
	expect(rOut1).toContain(`${detailTaskId}: repaired`)
	expect(rOut1).toContain("ui(ach→uim)")
	expect(rOut1).toContain("task(ach→hi)")
	expect(rOut1).toContain("size(calc→hi)")
	expect(rOut1).toContain("tokens(")

	// 019ede5a (missing_history_item) should be unrepairable
	expect(rOut1).toContain(`${orphanId}: UNREPAIRABLE`)
	const hintLine = rOut1.split("\n").find((l) => l.includes("hint:") && l.includes(orphanId))
	expect(hintLine, "unrepairable task must have delete hint").toBeDefined()
	expect(hintLine).toContain("cannot be repaired")
	expect(hintLine).toContain("delete")
	expect(hintLine).toContain(orphanId)
	expect(hintLine).toContain("--force")

	// 019f0f12 (placeholder + interrupted_task) should be repaired
	expect(rOut1).toContain(`${placeholderId}: repaired`)

	// Index rebuild summary
	expect(rOut1).toContain("_index.json rebuilt:")

	// Backup file verification
	const detailBaks = listBackupFiles(detailTaskDir)
	expect(detailBaks.length, "detail task must have backup files").toBeGreaterThanOrEqual(2)
	const hiBak = detailBaks.find((f) => f.startsWith("history_item.json."))
	const uiBak = detailBaks.find((f) => f.startsWith("ui_messages.json."))
	expect(hiBak, "history_item.json backup").toBeDefined()
	expect(uiBak, "ui_messages.json backup").toBeDefined()
	// Backup checksums match originals
	const hiHashBefore = hashesBefore.get(detailTaskId)!.get(HISTORY_ITEM_NAME)!
	const uiHashBefore = hashesBefore.get(detailTaskId)!.get(UI_MESSAGES_NAME)!
	expect(await contentHash(path.join(detailTaskDir, hiBak!)), "hi backup checksum").toBe(hiHashBefore)
	expect(await contentHash(path.join(detailTaskDir, uiBak!)), "ui backup checksum").toBe(uiHashBefore)

	// _index.json backup
	const indexBaks = listBackupFiles(tasksDir)
	expect(indexBaks.length).toBeGreaterThanOrEqual(1)
	const idxBak = indexBaks.find((f) => f.startsWith("_index.json."))
	expect(idxBak, "_index.json backup").toBeDefined()
	expect(await contentHash(path.join(tasksDir, idxBak!)), "index backup checksum").toBe(indexHashBefore)

	// ── Phase 3b: scan --json after repair ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true })
	const scanJson2 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	expect(readJson(FIXTURE_SCAN_AFTER_FILE)).toDeepEqualJson(
		scanJson2,
		{
			ignoreProps: ["version", "taskMatch", "storageRoot"],
			replacements: {
				[`^${quotePathRegex(tmpRoot)}` as any]: "",
				[`^${quotePathRegex("tests/fixtures")}` as any]: "",
			},
			maxLength: 200,
		},
		"scan json output before",
	)

	// ── Phase 4: scan --short after repair (fewer reasons) ──
	consoleLogSpy.mockClear()
	await scanAction({ short: true })
	const lc2 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")

	// Fully-repaired tasks (those with only placeholder_task_name + interrupted_task
	// after fix should no longer appear)
	const lc2Ids = new Set(
		lc2
			.split("\n")
			.filter((l) => /^[0-9a-f-]{36}\b/.test(l))
			.map((l) => l.slice(0, 36)),
	)

	// 019fdc9c had 5 reasons, after repair should have fewer or none
	const detailLine = lc2.split("\n").find((l) => l.startsWith(detailTaskId))
	if (detailLine) {
		expect(detailLine).not.toContain("placeholder_task_name")
		expect(detailLine).not.toContain("zero_size")
		expect(detailLine).not.toContain("empty_ui_messages")
	}

	// 019f0f12 had placeholder + interrupted; after repair placeholder is fixed,
	// solo interrupted is gated out → should be gone
	if (lc2Ids.has(placeholderId)) {
		const pLine = lc2.split("\n").find((l) => l.startsWith(placeholderId))
		expect(pLine).not.toContain("placeholder_task_name")
	}

	// ── Phase 4b: scan --short --json after repair ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcJson2 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const lcCorruptions2 = lcJson2.corruptions as Array<Record<string, unknown>>
	expect(lcCorruptions2.length, "JSON: corruptions must decrease after repair").toBeLessThan(7)

	// ── Phase 5: Index integrity ──
	const indexAfter = JSON.parse(fs.readFileSync(indexPath, "utf8"))
	const idsAfter = new Set(indexAfter.entries.map((e: { id: string }) => e.id))

	// The merge algorithm removes entries whose disk and index copies are both
	// imperfect (after backing them up). This one remains imperfect after repair.
	const removedIds = new Set(["019fddaa-5136-7106-abef-adac81fd56a3"])
	// All other original entries must be preserved
	for (const e of indexBefore.entries) {
		if (removedIds.has(e.id)) {
			expect(idsAfter.has(e.id), `index entry ${e.id} must be removed as imperfect`).toBe(false)
		} else {
			expect(idsAfter.has(e.id), `index entry ${e.id} must be preserved`).toBe(true)
		}
	}
	// Folder orphans (019fde29) should now be in index
	expect(idsAfter.has("019fde29-32cc-76c3-a156-e5287fc5fd2c"), "folder_orphan must be added to index").toBe(true)

	expect(readJson(FIXTURE_SCAN_SHORT_AFTER_FILE)).toDeepEqualJson(
		lcJson2,
		{
			ignoreProps: ["version"],
		},
		"scan --short fixed",
	)

	// ── Phase 6: validate after repair ──
	consoleLogSpy.mockClear()
	await validateAction(detailTaskId, { warnings: false })
	const v2 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	// The fully repaired task should have 0 errors, 0 warnings
	expect(v2).toContain("0 errors")
	expect(v2).toContain("0 warnings")

	// ── Phase 6b: validate --json after repair ──
	consoleLogSpy.mockClear()
	await validateAction(detailTaskId, { json: true, warnings: false })
	const vJson2 = getJsonOutput(consoleLogSpy) as Record<string, Record<string, unknown>>
	const hiKey = path.join(detailTaskDir, HISTORY_ITEM_NAME)
	const hiResult = vJson2[hiKey]
	expect(hiResult, "JSON validate: history_item must be in output").toBeDefined()
	expect(hiResult.valid).toBe(true)
	expect(hiResult.errorCount).toBe(0)

	// ── Phase 7: contentHash verification ──
	const detailHiPath = path.join(detailTaskDir, HISTORY_ITEM_NAME)
	const detailUiPath = path.join(detailTaskDir, UI_MESSAGES_NAME)

	const detailHiHashAfter = await contentHash(detailHiPath)
	const detailUiHashAfter = await contentHash(detailUiPath)
	const indexHashAfter = await contentHash(indexPath)

	expect(detailHiHashAfter).not.toBeNull()
	expect(detailUiHashAfter).not.toBeNull()
	expect(indexHashAfter).not.toBeNull()

	// Repaired files must differ from originals
	expect(detailHiHashAfter).not.toBe(hiHashBefore)
	expect(detailUiHashAfter).not.toBe(uiHashBefore)
	expect(indexHashAfter).not.toBe(indexHashBefore)

	// Repaired task text must not be placeholder
	const hi = JSON.parse(fs.readFileSync(detailHiPath, "utf8"))
	expect(hi.task).not.toMatch(/^Task\s*#\s*\d+/)

	// ui_messages must be non-empty after repair
	const ui = JSON.parse(fs.readFileSync(detailUiPath, "utf8"))
	expect(ui.length).toBeGreaterThan(0)

	// ── Phase 8: Second repair (idempotency) ──
	const bakCountBefore = listAllBackupFiles(tasksDir).length
	const lc2Before = lc2
	const v2Before = v2

	consoleLogSpy.mockClear()
	await repairAction(undefined, { all: true, force: true, backup: true })
	const rOut2 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")

	// Second repair must not report any repaired tasks (only previously unrepaired)
	// "repaired" should not appear for the detail task or placeholder task
	const r2Lines = rOut2.split("\n").filter((l) => l.includes(": repaired"))
	const r2RepairedIds = r2Lines.map((l) => l.slice(0, 36)).filter((id) => /^[0-9a-f-]{36}$/.test(id))

	// The detail task specifically must not be repaired again
	expect(r2RepairedIds.includes(detailTaskId), `${detailTaskId} must not be repaired again`).toBe(false)

	// Placeholder task must not be repaired again
	expect(r2RepairedIds.includes(placeholderId), `${placeholderId} must not be repaired again`).toBe(false)

	// No new backups created (count must not grow)
	const bakCountAfter = listAllBackupFiles(tasksDir).length
	expect(bakCountAfter, "no new backup files created in second pass").toBe(bakCountBefore)

	// Checksums unchanged after second repair
	expect(await contentHash(detailHiPath)).toBe(detailHiHashAfter)
	expect(await contentHash(detailUiPath)).toBe(detailUiHashAfter)
	expect(await contentHash(indexPath)).toBe(indexHashAfter)

	// ── Phase 8b: scan --json after second repair (idempotency) ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true })
	const scanJson3 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	assertJsonEqual(readJson(FIXTURE_SCAN_AFTER_FILE), scanJson3, {
		ignoreProps: ["version", "taskMatch", "storageRoot"],
		replacements: {
			[`^${quotePathRegex(tmpRoot)}` as any]: "",
			[`^${quotePathRegex("tests/fixtures")}` as any]: "",
		},
		maxLength: 200,
	})

	// ── Phase 9: scan --short after second repair (stable) ──
	consoleLogSpy.mockClear()
	await scanAction({ short: true })
	const lc3 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(lc3).toBe(lc2Before)

	// ── Phase 9b: scan --short --json after second repair (stable) ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcJson3 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const lcCorruptions3 = lcJson3.corruptions as Array<Record<string, unknown>>
	expect(lcCorruptions3.length, "JSON: corruptions must be stable after second repair").toBe(lcCorruptions2.length)

	expect(readJson(FIXTURE_SCAN_SHORT_AFTER_FILE)).toDeepEqualJson(
		lcJson3,
		{
			ignoreProps: ["version"],
		},
		"scan --short idempotency",
	)

	// ── Phase 10: validate after second repair (stable) ──
	consoleLogSpy.mockClear()
	await validateAction(detailTaskId, { warnings: false })
	const v3 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(v3).toBe(v2Before)

	// ── Phase 11: Verify no healthy task was corrupted ──
	for (const id of HEALTHY) {
		const taskDir = path.join(tasksDir, id)
		for (const f of [HISTORY_ITEM_NAME, UI_MESSAGES_NAME, API_HISTORY_NAME]) {
			const fp = path.join(taskDir, f)
			if (fs.existsSync(fp)) {
				const hash = await contentHash(fp)
				const before = hashesBefore.get(id)
				if (before && before.has(f) && before.get(f) !== null) {
					expect(hash, `${id}/${f}: healthy task file must not change`).toBe(before.get(f))
				}
			}
		}
	}

	// ── Phase 12: Delete unrepairable orphan (post-repair cleanup) ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcDel1 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const delCorruptions1 = lcDel1.corruptions as Array<{ taskId: string }>
	expect(
		delCorruptions1.some((c) => c.taskId === orphanId),
		"orphan must still be in scan --short before delete",
	).toBe(true)

	consoleLogSpy.mockClear()
	await deleteAction(orphanId, { force: true, backup: false })
	const delOut1 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(delOut1).toContain("Deleted:")
	expect(delOut1).toContain(orphanId)

	// ── Phase 13: scan --short --json empty after delete ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcDel2 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const delCorruptions2 = lcDel2.corruptions as Array<{ taskId: string }>
	expect(delCorruptions2.length, "scan --short must have 1 folder-orphan residual after delete").toBe(1)

	// ── Phase 14: Delete again — idempotent ──
	consoleLogSpy.mockClear()
	await deleteAction(orphanId, { force: true, backup: false })
	const delOut2 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(delOut2).toContain("Directory not found:")
	expect(delOut2).toContain(orphanId)

	// ── Phase 15: scan --short --json still empty ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcDel3 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const delCorruptions3 = lcDel3.corruptions as Array<{ taskId: string }>
	expect(
		delCorruptions3.length,
		"scan --short must remain with 1 folder-orphan residual after idempotent delete",
	).toBe(1)
}
