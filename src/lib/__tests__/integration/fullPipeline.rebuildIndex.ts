/**
 * @file src/lib/__tests__/integration/fullPipeline.rebuildIndex.ts
 */

/**
 * Integration test: repair --index → scan --short reduces index_orphans, adds folder_orphans.
 *
 * repair --index reads task directories from disk and rebuilds _index.json.
 * This removes index_orphans (entries without folders) and adds folder_orphans
 * (folders without entries).
 */
import path from "node:path"
import { expect, vi } from "vitest"
import { action as scanAction } from "../../commands/scan.js"
import { action as repairAction } from "../../commands/repair.js"
import { getJsonOutput, quotePathRegex, readJson } from "../testHelpers.js"
import { DEFAULT_INDEX_NAME } from "../../paths.js"

export default (tasksDir: string, consoleLogSpy: ReturnType<typeof vi.spyOn>, tmpRoot: string) => async () => {
	// ── Phase 1: scan --short --json before rebuild ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcJson1 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const corruptions1 = lcJson1.corruptions as Array<Record<string, unknown>>
	expect(corruptions1.length).toBe(7)

	// ── Phase 2: repair --index dry-run ──
	consoleLogSpy.mockClear()
	await repairAction(undefined, { index: true, force: false })
	const dryOut = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(dryOut).toContain("Rebuilt index with 6 items")
	expect(dryOut).toContain("Dry-run — nothing written")

	// ── Phase 3: repair --index --force ──
	consoleLogSpy.mockClear()
	await repairAction(undefined, { index: true, force: true, backup: true })
	const forceOut = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(forceOut).toContain("Rebuilt index with 6 items")
	expect(forceOut).not.toContain("Dry-run")

	// ── Phase 4: scan --short --json after rebuild (folder_orphans added) ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcJson2 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const corruptions2 = lcJson2.corruptions as Array<Array<Record<string, unknown>>>
	// After repair --index, previously-indexed tasks that had folders become folder_orphans
	// The 019fde29 was already a folder_orphan. The 019ede5a is still missing_history_item + folder_orphan.
	// All tasks should still appear (some now with folder_orphan added)
	expect(corruptions2.length).toBe(7)

	// 019f0f12 should now also have folder_orphan (was previously in index, now rebuilt from disk only)
	const f0f12 = corruptions2.find((c: any) => c.taskId === "019f0f12-02f9-70df-a35e-2b110efe4107")
	expect(f0f12).toBeDefined()
	const f0f12Reasons = (f0f12 as any).reasons.map((r: any) => r.reason)
	expect(f0f12Reasons).toContain("folder_orphan")

	// ── Phase 5: repair --index --force again (idempotent) ──
	consoleLogSpy.mockClear()
	await repairAction(undefined, { index: true, force: true, backup: true })
	const idemOut = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(idemOut).toContain("Rebuilt index with 6 items")
	expect(idemOut).not.toContain("Dry-run")

	expect(readJson(path.join(tasksDir, DEFAULT_INDEX_NAME))).toDeepEqualJson(
		readJson("tests/fixtures/_index.rebuilt.json"),
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

	// ── Phase 6: scan --short --json stable after idempotent rebuild ──
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lcJson3 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const corruptions3 = lcJson3.corruptions as Array<Record<string, unknown>>
	expect(corruptions3.length).toBe(corruptions2.length)
}
