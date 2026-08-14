/**
 * @file src/lib/__tests__/IndexTransaction.spec.ts
 *
 * Tests for IndexTransaction: merge decision matrix, reference cleanup,
 * childIds reconciliation, and _index.task backup deduplication.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IndexTransaction } from "../IndexTransaction.js"
import { createTempDir, makeTaskDir, touch, writeJson } from "./testHelpers.js"

const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => path.join(r, "tasks")))
const mockResolveIndexPath = vi.hoisted(() => vi.fn((td: string) => path.join(td, "_index.json")))
const mockListTaskDirs = vi.hoisted(() => vi.fn((td: string) => []))
const mockReadJsonFile = vi.hoisted(() => vi.fn(() => null))
const mockBackupTimestamp = vi.hoisted(() => "20260812-120000")

vi.mock("../cliContext.js", () => ({
	resolveRoot: mockResolveRoot,
}))

vi.mock("../paths.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../paths.js")>()
	return {
		...actual,
		resolveTasksDir: mockResolveTasksDir,
		resolveIndexPath: mockResolveIndexPath,
		listTaskDirs: mockListTaskDirs,
	}
})

vi.mock("../file.js", async () => {
	const actual = await vi.importActual("../file.js")
	return {
		...actual,
		readJsonFile: mockReadJsonFile,
		backupTimestamp: mockBackupTimestamp,
	}
})

/** A "perfect" history item that passes validation with 0 errors, 0 warnings. */
function perfectEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
		number: 1,
		ts: 100,
		task: "Real task description",
		tokensIn: 500,
		tokensOut: 300,
		totalCost: 0.05,
		size: 2048,
		mode: "code",
		workspace: "/home/user",
		apiConfigName: "default",
		...overrides,
	}
}

/** An imperfect entry that triggers validation warnings (tokensIn===0). */
function imperfectWarnEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		...perfectEntry(overrides),
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}
}

/** An imperfect entry that triggers validation errors (placeholder task). */
function imperfectErrorEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		...perfectEntry(overrides),
		task: "Task #1",
	}
}

describe("IndexTransaction", () => {
	beforeEach(() => {
		mockResolveRoot.mockReturnValue("/fake/root")
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("getEntries", () => {
		it("returns empty array when no data", async () => {
			const idx = new IndexTransaction()
			const entries = await idx.getEntries()
			expect(entries).toEqual([])
		})
	})

	describe("getById", () => {
		it("returns null when not found", async () => {
			const idx = new IndexTransaction()
			const entry = await idx.getById("nonexistent")
			expect(entry).toBeNull()
		})
	})

	describe("getFullIndex", () => {
		it("returns empty Map when no entries", async () => {
			const idx = new IndexTransaction()
			const map = await idx.getFullIndex()
			expect(map.size).toBe(0)
		})
	})

	describe("repair with temp dirs", () => {
		let tmpRoot: string
		let tasksDir: string

		beforeEach(() => {
			tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-idx-tx-"))
			tasksDir = path.join(tmpRoot, "tasks")
			fs.mkdirSync(tasksDir)

			mockResolveRoot.mockReturnValue(tmpRoot)
			mockResolveTasksDir.mockReturnValue(tasksDir)
			mockResolveIndexPath.mockReturnValue(path.join(tasksDir, "_index.json"))
			mockListTaskDirs.mockReturnValue([])
			mockReadJsonFile.mockReturnValue(null)

			// Create _index.json
			fs.writeFileSync(path.join(tasksDir, "_index.json"), "[]")
		})

		afterEach(() => {
			fs.rmSync(tmpRoot, { recursive: true, force: true })
		})

		it("dry-run returns items without writing", async () => {
			const dir = path.join(tasksDir, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
			fs.mkdirSync(dir)
			const diskEntry = perfectEntry()
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items, written } = await idx.repair(undefined, { dryRun: true })
			expect(written).toBe(false)
			expect(items.length).toBe(1)
			expect(items[0].id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
		})

		it("writes index to disk", async () => {
			const dir = path.join(tasksDir, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
			fs.mkdirSync(dir)
			const diskEntry = perfectEntry({ ts: 100 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items, written } = await idx.repair(undefined, { dryRun: false, backup: false })
			expect(written).toBe(true)
			expect(items.length).toBe(1)
			expect(items[0].id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
		})

		it("scoped to single ID only touches that entry", async () => {
			const task1Id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const task2Id = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"

			const dir1 = path.join(tasksDir, task1Id)
			fs.mkdirSync(dir1)
			const disk1 = perfectEntry({ id: task1Id, task: "Keep me", ts: 1 })
			fs.writeFileSync(path.join(dir1, "history_item.json"), JSON.stringify(disk1))

			const dir2 = path.join(tasksDir, task2Id)
			fs.mkdirSync(dir2)
			const disk2 = perfectEntry({ id: task2Id, task: "Replace me", ts: 2 })
			fs.writeFileSync(path.join(dir2, "history_item.json"), JSON.stringify(disk2))

			// Pre-populate index with both entries
			fs.writeFileSync(
				path.join(tasksDir, "_index.json"),
				JSON.stringify([
					perfectEntry({ id: task1Id, task: "Old task-1", ts: 1 }),
					perfectEntry({ id: task2Id, task: "Old task-2", ts: 2 }),
				]),
			)

			mockListTaskDirs.mockReturnValue([dir1, dir2])
			mockReadJsonFile.mockImplementation((p: string) => {
				if (p.includes(task2Id)) return disk2
				return null
			})

			// Repair only task-2
			const idx = new IndexTransaction(false)
			const { items } = await idx.repair(task2Id, { dryRun: true })

			// task-1 should keep its original index value
			const task1 = items.find((i) => i.id === task1Id)
			expect(task1).toBeDefined()
			expect(task1!.task).toBe("Old task-1")

			// task-2 should get disk value (disk perfect → disk wins)
			const task2 = items.find((i) => i.id === task2Id)
			expect(task2).toBeDefined()
			expect(task2!.task).toBe("Replace me")
		})

		it("verifyUiSync cross-check returns mismatching task ids", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = perfectEntry({ id: taskId, task: "Real task", ts: 200 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			fs.writeFileSync(
				path.join(dir, "ui_messages.json"),
				JSON.stringify([{ ts: 100, type: "say", say: "text", text: "Mismatch", partial: false }]),
			)
			fs.writeFileSync(
				path.join(dir, "api_conversation_history.json"),
				JSON.stringify([{ role: "user", content: [{ type: "text", text: "Hello" }], ts: 100 }]),
			)

			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items, uiSyncMismatches } = await idx.repair(undefined, { dryRun: true, verifyUiSync: true })

			expect(items).toHaveLength(1)
			expect(uiSyncMismatches).toContain(taskId)
		})

		it("verifyUiSync disabled returns no mismatches", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = perfectEntry({ id: taskId, task: "Real task", ts: 200 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { uiSyncMismatches } = await idx.repair(undefined, { dryRun: true })

			expect(uiSyncMismatches).toEqual([])
		})
	})

	describe("repair decision matrix (unit)", () => {
		let tmpRoot: string
		let tasksDir: string

		beforeEach(() => {
			tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-idx-matrix-"))
			tasksDir = path.join(tmpRoot, "tasks")
			fs.mkdirSync(tasksDir)
			fs.writeFileSync(path.join(tasksDir, "_index.json"), "[]")

			mockResolveRoot.mockReturnValue(tmpRoot)
			mockResolveTasksDir.mockReturnValue(tasksDir)
			mockResolveIndexPath.mockReturnValue(path.join(tasksDir, "_index.json"))
			mockListTaskDirs.mockReturnValue([])
			mockReadJsonFile.mockReturnValue(null)
		})

		afterEach(() => {
			fs.rmSync(tmpRoot, { recursive: true, force: true })
		})

		it("both-perfect → disk wins", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = perfectEntry({ id: taskId, task: "Disk task", ts: 200 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			// Pre-populate index with a different perfect entry
			fs.writeFileSync(
				path.join(tasksDir, "_index.json"),
				JSON.stringify([perfectEntry({ id: taskId, task: "Index task", ts: 100 })]),
			)

			const idx = new IndexTransaction(false)
			const { items, replacedFromDisk } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(1)
			expect(items[0].task).toBe("Disk task")
			expect(replacedFromDisk).toBe(1)
		})

		it("disk-imperfect + idx-perfect → keeps index", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = imperfectWarnEntry({ id: taskId, task: "Disk task", ts: 200 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			fs.writeFileSync(
				path.join(tasksDir, "_index.json"),
				JSON.stringify([perfectEntry({ id: taskId, task: "Index task", ts: 100 })]),
			)

			const idx = new IndexTransaction(false)
			const { items, replacedFromDisk } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(1)
			expect(items[0].task).toBe("Index task")
			expect(replacedFromDisk).toBe(0)
		})

		it("both-imperfect → backup + remove", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = imperfectErrorEntry({ id: taskId, ts: 200 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			fs.writeFileSync(
				path.join(tasksDir, "_index.json"),
				JSON.stringify([imperfectWarnEntry({ id: taskId, ts: 100 })]),
			)

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(0)
			expect(backedUpToDisk).toBe(1)
		})

		it("disk-missing + idx-exists → backup + remove (stale)", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			// No task dir on disk, no disk entry
			mockListTaskDirs.mockReturnValue([])
			mockReadJsonFile.mockReturnValue(null)

			fs.writeFileSync(
				path.join(tasksDir, "_index.json"),
				JSON.stringify([perfectEntry({ id: taskId, ts: 100 })]),
			)

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk } = await idx.repair(undefined, { dryRun: false, backup: false })

			expect(items).toHaveLength(0)
			expect(backedUpToDisk).toBe(1)

			const bakPath = path.join(tasksDir, taskId, "_index.task.20260812-120000.bak.json")
			const bak = JSON.parse(fs.readFileSync(bakPath, "utf8"))
			expect(bak._removedReason).toBe("stale_entry")
		})

		it("disk-present-no-hi + idx-exists → backup + remove (no_history_item)", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)
			// No history_item.json in the dir
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(null)

			fs.writeFileSync(
				path.join(tasksDir, "_index.json"),
				JSON.stringify([perfectEntry({ id: taskId, ts: 100 })]),
			)

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk } = await idx.repair(undefined, { dryRun: false, backup: false })

			expect(items).toHaveLength(0)
			expect(backedUpToDisk).toBe(1)

			const bakPath = path.join(tasksDir, taskId, "_index.task.20260812-120000.bak.json")
			const bak = JSON.parse(fs.readFileSync(bakPath, "utf8"))
			expect(bak._removedReason).toBe("no_history_item")
		})

		it("disk-imperfect + no-idx → skip", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = imperfectErrorEntry({ id: taskId, ts: 200 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(0)
		})

		it("awaitingChildId-dangling → status='interrupted', keep entry", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = perfectEntry({
				id: taskId,
				task: "Parent task",
				ts: 200,
				awaitingChildId: "cccccccc-dddd-4eee-8fff-000000000000",
			})
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(1)
			expect(items[0].status).toBe("interrupted")
			expect(items[0].awaitingChildId).toBeUndefined()
			expect(items[0].delegatedToId).toBeUndefined()
		})

		it("other-dangling (parentTaskId) → nullify ref, keep entry", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = perfectEntry({
				id: taskId,
				task: "Child task",
				ts: 200,
				parentTaskId: "cccccccc-dddd-4eee-8fff-000000000000",
				status: "completed",
			})
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(1)
			expect(items[0].parentTaskId).toBeUndefined()
			expect(items[0].status).toBe("completed")
		})

		it("childIds reconciliation", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const childId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"

			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)
			const diskEntry = perfectEntry({
				id: taskId,
				task: "Parent task",
				ts: 200,
				delegatedToId: childId,
				childIds: [],
			})
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))

			const childDir = path.join(tasksDir, childId)
			fs.mkdirSync(childDir)
			const childDisk = perfectEntry({
				id: childId,
				task: "Child task",
				ts: 100,
				parentTaskId: taskId,
			})
			fs.writeFileSync(path.join(childDir, "history_item.json"), JSON.stringify(childDisk))

			mockListTaskDirs.mockReturnValue([dir, childDir])
			mockReadJsonFile.mockImplementation((p: string) => {
				if (p.includes(taskId)) return diskEntry
				if (p.includes(childId)) return childDisk
				return null
			})

			const idx = new IndexTransaction(false)
			const { items } = await idx.repair(undefined, { dryRun: true })

			const parent = items.find((i) => i.id === taskId)
			expect(parent).toBeDefined()
			const childIds = parent!.childIds as string[]
			expect(childIds).toContain(childId)
		})

		it("childIds key removed when entry has no children", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			// Perfect entry with no childIds and no child reference fields
			const diskEntry = perfectEntry({ id: taskId, task: "Lonely task", ts: 200 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(1)
			expect(items[0].childIds).toBeUndefined()
		})

		it("cleanup loops until stable (A→B→C chain)", async () => {
			const aId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const bId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
			const cId = "cccccccc-dddd-4eee-8fff-000000000000"

			// A references B
			const dirA = path.join(tasksDir, aId)
			fs.mkdirSync(dirA)
			const diskA = perfectEntry({ id: aId, task: "A", ts: 300, parentTaskId: bId })
			fs.writeFileSync(path.join(dirA, "history_item.json"), JSON.stringify(diskA))

			// B references C
			const dirB = path.join(tasksDir, bId)
			fs.mkdirSync(dirB)
			const diskB = perfectEntry({ id: bId, task: "B", ts: 200, parentTaskId: cId })
			fs.writeFileSync(path.join(dirB, "history_item.json"), JSON.stringify(diskB))

			// C is imperfect — will be removed
			const dirC = path.join(tasksDir, cId)
			fs.mkdirSync(dirC)
			const diskC = imperfectErrorEntry({ id: cId, task: "Task #1", ts: 100 })
			fs.writeFileSync(path.join(dirC, "history_item.json"), JSON.stringify(diskC))

			mockListTaskDirs.mockReturnValue([dirA, dirB, dirC])
			mockReadJsonFile.mockImplementation((p: string) => {
				if (p.includes(aId)) return diskA
				if (p.includes(bId)) return diskB
				if (p.includes(cId)) return diskC
				return null
			})

			const idx = new IndexTransaction(false)
			const { items } = await idx.repair(undefined, { dryRun: true })

			// C is removed, B's parentTaskId→C becomes dangling, B's ref nullified
			// A's parentTaskId→B is valid (B still in index), so A survives
			const a = items.find((i) => i.id === aId)
			expect(a).toBeDefined()

			const b = items.find((i) => i.id === bId)
			expect(b).toBeDefined()
			expect(b!.parentTaskId).toBeUndefined()

			// C should be removed (both imperfect)
			const c = items.find((i) => i.id === cId)
			expect(c).toBeUndefined()
		})

		it("empty index after all removed → valid empty index written", async () => {
			const taskId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const dir = path.join(tasksDir, taskId)
			fs.mkdirSync(dir)

			const diskEntry = imperfectErrorEntry({ id: taskId, ts: 200 })
			fs.writeFileSync(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items, written } = await idx.repair(undefined, { dryRun: false, backup: false })

			expect(items).toHaveLength(0)
			expect(written).toBe(true)
		})

		it("summary format string", async () => {
			// orphan disk (no index) + orphan idx (no disk) scenario
			const taskId1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
			const taskId2 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"

			const dir1 = path.join(tasksDir, taskId1)
			fs.mkdirSync(dir1)
			const disk1 = perfectEntry({ id: taskId1, task: "Disk only", ts: 100 })
			fs.writeFileSync(path.join(dir1, "history_item.json"), JSON.stringify(disk1))
			mockListTaskDirs.mockReturnValue([dir1])

			// Only taskId2 in index, no disk
			fs.writeFileSync(
				path.join(tasksDir, "_index.json"),
				JSON.stringify([perfectEntry({ id: taskId2, task: "Index only", ts: 50 })]),
			)

			// Mock readJsonFile: only taskId1 has disk entry
			mockReadJsonFile.mockImplementation((p: string) => {
				if (p.includes(taskId1)) return disk1
				return null
			})

			const idx = new IndexTransaction(false)
			const { warnings } = await idx.repair(undefined, { dryRun: true })

			expect(warnings).toHaveLength(1)
			expect(warnings[0]).toContain("orphan: 1 disk, 1 index")
		})
	})

	describe("repair fixture edge cases (Block 5)", () => {
		const TASK_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
		const MISSING_ID = "cccccccc-dddd-4eee-8fff-000000000000"
		const BAK_NAME = "_index.task.20260812-120000.bak.json"

		let td: ReturnType<typeof createTempDir>
		let tasksDir: string

		beforeEach(() => {
			td = createTempDir("zoo-idx-fixture-")
			tasksDir = td.tasksDir

			mockResolveRoot.mockReturnValue(td.root)
			mockResolveTasksDir.mockReturnValue(tasksDir)
			mockResolveIndexPath.mockReturnValue(path.join(tasksDir, "_index.json"))
			mockListTaskDirs.mockReturnValue([])
			mockReadJsonFile.mockReturnValue(null)

			writeJson(path.join(tasksDir, "_index.json"), [])
		})

		afterEach(() => {
			td.cleanup()
		})

		it("index-clean-disk-corrupt keeps the clean index entry", async () => {
			const dir = makeTaskDir(tasksDir, TASK_ID)
			const diskEntry = perfectEntry({
				id: TASK_ID,
				task: "Task #1",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				ts: 200,
			})
			touch(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			writeJson(path.join(tasksDir, "_index.json"), [
				perfectEntry({
					id: TASK_ID,
					task: "Clean index task",
					ts: 100,
				}),
			])

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk, warnings } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(1)
			expect(items[0].task).toBe("Clean index task")
			expect(backedUpToDisk).toBe(0)
			expect(warnings[0]).toContain("corrupt: 1 disk, 0 index")
			expect(warnings[0]).toContain("warnings: 3 disk, 0 index")
		})

		it("dangling-parent nullifies parentTaskId and keeps entry with backup", async () => {
			const dir = makeTaskDir(tasksDir, TASK_ID)
			const diskEntry = perfectEntry({ id: TASK_ID, task: "Child task", ts: 200, parentTaskId: MISSING_ID })
			touch(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			writeJson(path.join(tasksDir, "_index.json"), [
				perfectEntry({
					id: TASK_ID,
					task: "Child task",
					ts: 100,
					parentTaskId: MISSING_ID,
				}),
			])

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk } = await idx.repair(undefined, { dryRun: false, backup: false })

			expect(items).toHaveLength(1)
			expect(items[0].id).toBe(TASK_ID)
			expect(items[0].parentTaskId).toBeUndefined()
			expect(backedUpToDisk).toBe(1)

			const bak = JSON.parse(fs.readFileSync(path.join(tasksDir, TASK_ID, BAK_NAME), "utf8"))
			expect(bak._removedReason).toBe("dangling_ref")
		})

		it("dangling-awaiting marks interrupted and clears awaitingChildId + delegatedToId", async () => {
			const dir = makeTaskDir(tasksDir, TASK_ID)
			const diskEntry = perfectEntry({
				id: TASK_ID,
				task: "Parent task",
				ts: 200,
				awaitingChildId: MISSING_ID,
				delegatedToId: MISSING_ID,
			})
			touch(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			writeJson(path.join(tasksDir, "_index.json"), [
				perfectEntry({
					id: TASK_ID,
					task: "Parent task",
					ts: 100,
					awaitingChildId: MISSING_ID,
					delegatedToId: MISSING_ID,
				}),
			])

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk } = await idx.repair(undefined, { dryRun: false, backup: false })

			expect(items).toHaveLength(1)
			expect(items[0].status).toBe("interrupted")
			expect(items[0].awaitingChildId).toBeUndefined()
			expect(items[0].delegatedToId).toBeUndefined()
			expect(backedUpToDisk).toBe(1)

			const bak = JSON.parse(fs.readFileSync(path.join(tasksDir, TASK_ID, BAK_NAME), "utf8"))
			expect(bak._removedReason).toBe("dangling_awaiting_child")
		})

		it("folder-orphan adds disk task to the index", async () => {
			const dir = makeTaskDir(tasksDir, TASK_ID)
			const diskEntry = perfectEntry({ id: TASK_ID, task: "Disk only task", ts: 100 })
			touch(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk, warnings } = await idx.repair(undefined, { dryRun: true })

			expect(items).toHaveLength(1)
			expect(items[0].id).toBe(TASK_ID)
			expect(items[0].task).toBe("Disk only task")
			expect(backedUpToDisk).toBe(0)
			expect(warnings[0]).toContain("orphan: 1 disk, 0 index")
		})

		it("stale-entry removes index entry with stale_entry backup", async () => {
			// no task dir on disk
			writeJson(path.join(tasksDir, "_index.json"), [perfectEntry({ id: TASK_ID, ts: 100 })])

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk, warnings } = await idx.repair(undefined, { dryRun: false, backup: false })

			expect(items).toHaveLength(0)
			expect(backedUpToDisk).toBe(1)
			expect(warnings[0]).toContain("orphan: 0 disk, 1 index")

			const bak = JSON.parse(fs.readFileSync(path.join(tasksDir, TASK_ID, BAK_NAME), "utf8"))
			expect(bak._removedReason).toBe("stale_entry")
		})

		it("deduplicates identical _index.task backups (N1)", async () => {
			const dir = makeTaskDir(tasksDir, TASK_ID)
			const entry = perfectEntry({ id: TASK_ID, ts: 100 })

			const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000)
			try {
				// Pre-existing backup with identical content (modulo volatile `ts`).
				touch(
					path.join(dir, "_index.task.20260812-110000.bak.json"),
					JSON.stringify({ ...entry, _removedReason: "no_history_item", _removedAt: 1700000000000 }),
				)

				writeJson(path.join(tasksDir, "_index.json"), [entry])
				mockListTaskDirs.mockReturnValue([dir])
				mockReadJsonFile.mockReturnValue(null)

				const idx = new IndexTransaction(false)
				const { items, backedUpToDisk } = await idx.repair(undefined, { dryRun: false, backup: false })

				expect(items).toHaveLength(0)
				expect(backedUpToDisk).toBe(1)

				// The duplicate (newer) backup is removed; the original survives.
				expect(fs.existsSync(path.join(dir, "_index.task.20260812-120000.bak.json"))).toBe(false)
				expect(fs.existsSync(path.join(dir, "_index.task.20260812-110000.bak.json"))).toBe(true)
			} finally {
				nowSpy.mockRestore()
			}
		})

		it("both-corrupt-different-fields backs up and removes both", async () => {
			const dir = makeTaskDir(tasksDir, TASK_ID)
			const diskEntry = perfectEntry({
				id: TASK_ID,
				task: "Real task",
				ts: 200,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			})
			touch(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			writeJson(path.join(tasksDir, "_index.json"), [perfectEntry({ id: TASK_ID, task: "Task #1", ts: 100 })])

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk, warnings } = await idx.repair(undefined, { dryRun: false, backup: false })

			expect(items).toHaveLength(0)
			expect(backedUpToDisk).toBe(1)
			expect(warnings[0]).toContain("corrupt: 0 disk, 1 index")
			expect(warnings[0]).toContain("warnings: 3 disk, 0 index")

			const bak = JSON.parse(fs.readFileSync(path.join(tasksDir, TASK_ID, BAK_NAME), "utf8"))
			expect(bak._removedReason).toBe("both_corrupt")
		})

		it("disk-missing-hi removes index entry with no_history_item backup", async () => {
			const dir = makeTaskDir(tasksDir, TASK_ID) // dir exists but no history_item.json
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(null)

			writeJson(path.join(tasksDir, "_index.json"), [perfectEntry({ id: TASK_ID, ts: 100 })])

			const idx = new IndexTransaction(false)
			const { items, backedUpToDisk } = await idx.repair(undefined, { dryRun: false, backup: false })

			expect(items).toHaveLength(0)
			expect(backedUpToDisk).toBe(1)

			const bak = JSON.parse(fs.readFileSync(path.join(tasksDir, TASK_ID, BAK_NAME), "utf8"))
			expect(bak._removedReason).toBe("no_history_item")
		})

		it("edge-case-empty-index writes an empty entries array", async () => {
			const dir = makeTaskDir(tasksDir, TASK_ID)
			const diskEntry = imperfectErrorEntry({ id: TASK_ID, ts: 200 })
			touch(path.join(dir, "history_item.json"), JSON.stringify(diskEntry))
			mockListTaskDirs.mockReturnValue([dir])
			mockReadJsonFile.mockReturnValue(diskEntry)

			writeJson(path.join(tasksDir, "_index.json"), [imperfectErrorEntry({ id: TASK_ID, ts: 100 })])

			const idx = new IndexTransaction(false)
			const { items, written, backedUpToDisk, warnings } = await idx.repair(undefined, {
				dryRun: false,
				backup: false,
			})

			expect(items).toHaveLength(0)
			expect(written).toBe(true)
			expect(backedUpToDisk).toBe(1)
			expect(warnings[0]).toContain("corrupt: 1 disk, 1 index")

			const indexOnDisk = JSON.parse(fs.readFileSync(path.join(tasksDir, "_index.json"), "utf8"))
			expect(indexOnDisk.entries).toEqual([])
		})
	})
})
