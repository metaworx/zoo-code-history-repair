/**
 * @file src/lib/__tests__/repairAll.spec.ts
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { repairAllCorrupted } from "../repairAll.js"

describe("repairAllCorrupted", () => {
	let root: string
	let tasksDir: string

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-repair-all-"))
		tasksDir = path.join(root, "tasks")
		fs.mkdirSync(tasksDir)
	})

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true })
	})

	it("returns zero totals for clean storage", async () => {
		const result = await repairAllCorrupted(root)
		expect(result.total).toBe(0)
		expect(result.repaired).toBe(0)
		expect(result.failed).toBe(0)
		expect(result.results).toEqual([])
	})

	it("repairs a single corrupted task", async () => {
		const dir = path.join(tasksDir, "corrupt-1")
		fs.mkdirSync(dir)
		fs.writeFileSync(
			path.join(dir, "history_item.json"),
			JSON.stringify({ id: "corrupt-1", task: "Task #1", size: 1, ts: 1 }),
		)
		fs.writeFileSync(path.join(dir, "ui_messages.json"), "[]")
		fs.writeFileSync(
			path.join(dir, "api_conversation_history.json"),
			JSON.stringify([
				{ role: "user", content: [{ type: "text", text: "<user_message>Fix it</user_message>" }], ts: 100 },
			]),
		)
		fs.writeFileSync(path.join(dir, "task_metadata.json"), "{}")
		fs.writeFileSync(
			path.join(tasksDir, "_index.json"),
			JSON.stringify([{ id: "corrupt-1", task: "Task #1", size: 1 }]),
		)

		const result = await repairAllCorrupted(root)
		expect(result.total).toBe(1)
		expect(result.repaired).toBe(1)
		expect(result.failed).toBe(0)
		expect(result.results[0].taskId).toBe("corrupt-1")
		expect(result.results[0].uiRepaired || result.results[0].taskRepaired || result.results[0].sizeRepaired).toBe(
			true,
		)
	})

	it("repairs multiple corrupted tasks", async () => {
		for (const id of ["bad-1", "bad-2", "bad-3"]) {
			const dir = path.join(tasksDir, id)
			fs.mkdirSync(dir)
			fs.writeFileSync(
				path.join(dir, "history_item.json"),
				JSON.stringify({ id, task: "Task #1", size: 1, ts: 1 }),
			)
			fs.writeFileSync(path.join(dir, "ui_messages.json"), "[]")
			fs.writeFileSync(
				path.join(dir, "api_conversation_history.json"),
				JSON.stringify([
					{
						role: "user",
						content: [{ type: "text", text: `<user_message>Task ${id}</user_message>` }],
						ts: 100,
					},
				]),
			)
			fs.writeFileSync(path.join(dir, "task_metadata.json"), "{}")
		}
		fs.writeFileSync(
			path.join(tasksDir, "_index.json"),
			JSON.stringify([
				{ id: "bad-1", task: "Task #1", size: 1 },
				{ id: "bad-2", task: "Task #1", size: 1 },
				{ id: "bad-3", task: "Task #1", size: 1 },
			]),
		)

		const result = await repairAllCorrupted(root)
		expect(result.total).toBe(3)
		expect(result.repaired).toBe(3)
		expect(result.failed).toBe(0)
	})

	it("dry-run reports results but does not write", async () => {
		const dir = path.join(tasksDir, "dry")
		fs.mkdirSync(dir)
		fs.writeFileSync(
			path.join(dir, "history_item.json"),
			JSON.stringify({ id: "dry", task: "Task #1", size: 1, ts: 1 }),
		)
		fs.writeFileSync(path.join(dir, "ui_messages.json"), "[]")
		fs.writeFileSync(
			path.join(dir, "api_conversation_history.json"),
			JSON.stringify([
				{
					role: "user",
					content: [{ type: "text", text: "<user_message>Dry run task</user_message>" }],
					ts: 100,
				},
			]),
		)
		fs.writeFileSync(path.join(dir, "task_metadata.json"), "{}")
		fs.writeFileSync(path.join(tasksDir, "_index.json"), JSON.stringify([{ id: "dry", task: "Task #1", size: 1 }]))

		const result = await repairAllCorrupted(root, { dryRun: true })
		expect(result.total).toBe(1)
		expect(result.repaired).toBe(1)

		const uiRaw = fs.readFileSync(path.join(dir, "ui_messages.json"), "utf8")
		expect(uiRaw).toBe("[]")
	})

	it("verifyUiSync option is wired through to scanStorage", async () => {
		const dir = path.join(tasksDir, "sync-test")
		fs.mkdirSync(dir)
		fs.writeFileSync(
			path.join(dir, "history_item.json"),
			JSON.stringify({ id: "sync-test", task: "Task #1", size: 100, ts: 1 }),
		)
		fs.writeFileSync(
			path.join(dir, "ui_messages.json"),
			JSON.stringify([{ type: "say", say: "text", text: "only one" }]),
		)
		fs.writeFileSync(
			path.join(dir, "api_conversation_history.json"),
			JSON.stringify([
				{ role: "user", content: [{ type: "text", text: "<user_message>First</user_message>" }], ts: 100 },
				{ role: "assistant", content: [{ type: "text", text: "Response" }], ts: 200 },
				{ role: "user", content: [{ type: "text", text: "<user_message>Second</user_message>" }], ts: 300 },
				{ role: "assistant", content: [{ type: "text", text: "Response 2" }], ts: 400 },
			]),
		)
		fs.writeFileSync(path.join(dir, "task_metadata.json"), "{}")
		fs.writeFileSync(
			path.join(tasksDir, "_index.json"),
			JSON.stringify([{ id: "sync-test", task: "Task #1", size: 100 }]),
		)

		const result = await repairAllCorrupted(root, { verifyUiSync: true })
		const syncTask = result.results.find((r) => r.taskId === "sync-test")
		expect(syncTask).toBeDefined()
		expect(syncTask!.taskRepaired).toBe(true)
	})
})
