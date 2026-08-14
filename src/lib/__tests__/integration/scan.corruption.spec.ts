/**
 * @file src/lib/__tests__/integration/scan.corruption.spec.ts
 *
 * Integration tests: scan detects `invalid_json` and `missing_task_dir`
 * against the dedicated corruption fixture.
 */
import path from "node:path"
import { scanStorage } from "../../scan.js"

const FIXTURE_ROOT = path.resolve("tests/fixtures/corruption")

describe("scan corruption fixture (integration)", async () => {
	const result = await scanStorage(FIXTURE_ROOT)

	it("produces invalid_json for a task with corrupted JSON", async () => {
		const c = result.corruptions.find((x) => x.taskId === "11111111-1111-4111-8111-111111111111")
		expect(c).toBeDefined()
		expect(c!.reasons).toContainEqual({ reason: "invalid_json", source: "uim" })
	})

	it("produces missing_task_dir for an entry referencing a missing dir", async () => {
		const c = result.corruptions.find((x) => x.taskId === "11111111-1111-4111-8111-111111111111")
		expect(c).toBeDefined()
		expect(c!.reasons).toContainEqual({ reason: "missing_task_dir", source: "idx" })
	})

	it("produces index_orphan for the referenced entry without a directory", async () => {
		const c = result.corruptions.find((x) => x.taskId === "22222222-2222-4222-8222-222222222222")
		expect(c).toBeDefined()
		expect(c!.reasons).toContainEqual({ reason: "index_orphan", source: "idx" })
	})
})
