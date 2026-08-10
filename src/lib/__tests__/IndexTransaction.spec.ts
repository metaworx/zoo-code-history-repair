import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => path.join(r, "tasks")))
const mockResolveIndexPath = vi.hoisted(() => vi.fn((td: string) => path.join(td, "_index.json")))
const mockListTaskDirs = vi.hoisted(() => vi.fn((td: string) => []))

vi.mock("../cliContext.js", () => ({
    resolveRoot: mockResolveRoot,
}))

vi.mock("../paths.js", () => ({
    resolveTasksDir: mockResolveTasksDir,
    resolveIndexPath: mockResolveIndexPath,
    listTaskDirs: mockListTaskDirs,
    HISTORY_ITEM_NAME: "history_item.json",
}))

import {IndexTransaction} from "../IndexTransaction.js"

describe("IndexTransaction", () => {
    beforeEach(() => {
        mockResolveRoot.mockReturnValue("/fake/root")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    describe("getEntries", () => {
        it("returns empty array when no data", () => {
            const idx = new IndexTransaction()
            // read(false) returns null by default in tests (no real file)
            const entries = idx.getEntries()
            expect(entries).toEqual([])
        })
    })

    describe("getById", () => {
        it("returns null when not found", () => {
            const idx = new IndexTransaction()
            const entry = idx.getById("nonexistent")
            expect(entry).toBeNull()
        })
    })

    describe("getFullIndex", () => {
        it("returns empty Map when no entries", () => {
            const idx = new IndexTransaction()
            const map = idx.getFullIndex()
            expect(map.size).toBe(0)
        })
    })

    describe("repair fromDisk with temp dirs", () => {
        let tmpRoot: string
        let tasksDir: string

        beforeEach(() => {
            tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-idx-tx-"))
            tasksDir = path.join(tmpRoot, "tasks")
            fs.mkdirSync(tasksDir)

            mockResolveRoot.mockReturnValue(tmpRoot)
            mockResolveTasksDir.mockReturnValue(tasksDir)
            mockResolveIndexPath.mockReturnValue(path.join(tasksDir, "_index.json"))

            // Create _index.json
            fs.writeFileSync(path.join(tasksDir, "_index.json"), "[]")
        })

        afterEach(() => {
            fs.rmSync(tmpRoot, {recursive: true, force: true})
        })

        it("repair(true) dry-run returns items without writing", () => {
            const dir = path.join(tasksDir, "task-1")
            fs.mkdirSync(dir)
            fs.writeFileSync(
                path.join(dir, "history_item.json"),
                JSON.stringify({id: "task-1", task: "Real task", ts: 1}),
            )
            mockListTaskDirs.mockReturnValue([dir])

            const idx = new IndexTransaction(false)
            const {items, written} = idx.repair(true, undefined, {dryRun: true})
            expect(written).toBe(false)
            expect(items.length).toBe(1)
            expect(items[0].id).toBe("task-1")
        })

        it("repair(true) writes index to disk", () => {
            const dir = path.join(tasksDir, "task-1")
            fs.mkdirSync(dir)
            fs.writeFileSync(
                path.join(dir, "history_item.json"),
                JSON.stringify({id: "task-1", task: "Real task", ts: 100}),
            )
            mockListTaskDirs.mockReturnValue([dir])

            const idx = new IndexTransaction(false)
            const {items, written} = idx.repair(true, undefined, {
                dryRun: false,
                backup: false,
            })
            expect(written).toBe(true)
            expect(items.length).toBe(1)
            expect(items[0].id).toBe("task-1")
        })

        it("repair(true) scoped to single ID only touches that entry", () => {
            const dir1 = path.join(tasksDir, "task-1")
            fs.mkdirSync(dir1)
            fs.writeFileSync(
                path.join(dir1, "history_item.json"),
                JSON.stringify({id: "task-1", task: "Keep me", ts: 1}),
            )

            const dir2 = path.join(tasksDir, "task-2")
            fs.mkdirSync(dir2)
            fs.writeFileSync(
                path.join(dir2, "history_item.json"),
                JSON.stringify({id: "task-2", task: "Replace me", ts: 2}),
            )

            // Pre-populate index with both entries
            fs.writeFileSync(
                path.join(tasksDir, "_index.json"),
                JSON.stringify([
                    {id: "task-1", task: "Old task-1", ts: 1},
                    {id: "task-2", task: "Old task-2", ts: 2},
                ]),
            )

            mockListTaskDirs.mockReturnValue([dir1, dir2])

            // Repair only task-2 from disk
            const idx = new IndexTransaction(false)
            const {items} = idx.repair(true, "task-2", {dryRun: true})

            // task-1 should keep its original index value (not replaced from disk)
            const task1 = items.find(i => i.id === "task-1")
            expect(task1).toBeDefined()
            expect(task1!.task).toBe("Old task-1")

            // task-2 should get disk value
            const task2 = items.find(i => i.id === "task-2")
            expect(task2).toBeDefined()
            expect(task2!.task).toBe("Replace me")
        })
    })
})
