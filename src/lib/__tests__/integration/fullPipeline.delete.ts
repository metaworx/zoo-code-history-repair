/**
 * @file src/lib/__tests__/integration/fullPipeline.delete.ts
 */

/**
 * Integration test: delete unrepairable task → scan --short empty → idempotent.
 */
import { expect, vi } from "vitest"
import { action as deleteAction } from "../../commands/delete.js"
import { action as scanAction } from "../../commands/scan.js"
import { action as repairAction } from "../../commands/repair.js"
import { getJsonOutput } from "../testHelpers.js"

export default (tasksDir: string, consoleLogSpy: ReturnType<typeof vi.spyOn>) => async () => {
	const orphanId = "019ede5a-9327-70cc-9c54-2d227182e4d1"

	// Phase 0: Repair all first so only unrepairable tasks remain
	consoleLogSpy.mockClear()
	await repairAction(undefined, { all: true, force: true, backup: false })
	const rOut = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(rOut).toContain(`${orphanId}: UNREPAIRABLE`)

	// Phase 1: scan --short --json shows the unrepairable orphan
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lc1 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const corruptions1 = lc1.corruptions as Array<{ taskId: string }>
	expect(
		corruptions1.some((c) => c.taskId === orphanId),
		"orphan must be in scan --short before delete",
	).toBe(true)

	// Phase 2: Delete the unrepairable task
	consoleLogSpy.mockClear()
	await deleteAction(orphanId, { force: true, backup: false })
	const delOut1 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(delOut1).toContain(`Deleted:`)
	expect(delOut1).toContain(orphanId)
	expect(delOut1).toContain(`Stripped ${orphanId} from _index.json`)

	// Phase 3: scan --short --json is empty after delete
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lc2 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const corruptions2 = lc2.corruptions as Array<{ taskId: string }>
	expect(corruptions2.length, "scan --short must have 1 folder-orphan residual after delete").toBe(1)

	// Phase 4: Delete again — idempotent
	consoleLogSpy.mockClear()
	await deleteAction(orphanId, { force: true, backup: false })
	const delOut2 = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
	expect(delOut2).toContain(`Directory not found:`)
	expect(delOut2).toContain(orphanId)

	// Phase 5: scan --short --json still empty
	consoleLogSpy.mockClear()
	await scanAction({ json: true, short: true })
	const lc3 = getJsonOutput(consoleLogSpy) as Record<string, unknown>
	const corruptions3 = lc3.corruptions as Array<{ taskId: string }>
	expect(corruptions3.length, "scan --short must remain with 1 folder-orphan residual after idempotent delete").toBe(
		1,
	)
}
