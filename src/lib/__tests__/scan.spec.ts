/**
 * @file src/lib/__tests__/scan.spec.ts
 *
 * Unit tests for scanStorage corruption detection.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {scanStorage} from "../scan.js"

describe("scanStorage", () => {
    let root: string
    let tasksDir: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-scan-"))
        tasksDir = path.join(root, "tasks")
        fs.mkdirSync(tasksDir)
    })

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    })

    it("reports folder_orphan when task dir is not in index", async () => {
        const dir = path.join(tasksDir, "orphan-id")
        fs.mkdirSync(dir)
        fs.writeFileSync(
            path.join(dir, "history_item.json"),
            JSON.stringify({id: "orphan-id", task: "Real", size: 99}),
        )
        fs.writeFileSync(path.join(tasksDir, "_index.json"), "[]")

        const result = await scanStorage(root)
        const hit = result.corruptions.find((c) => c.taskId === "orphan-id")
        expect(hit?.reasons).toContainEqual({reason: "folder_orphan", source: "hi"})
    })

    it("reports index_orphan when index entry has no folder", async () => {
        fs.writeFileSync(
            path.join(tasksDir, "_index.json"),
            JSON.stringify([{id: "ghost", task: "Ghost", size: 0}]),
        )

        const result = await scanStorage(root)
        const hit = result.corruptions.find((c) => c.taskId === "ghost")
        expect(hit?.reasons).toEqual(
            expect.arrayContaining([{reason: "index_orphan", source: "idx"}, {reason: "zero_size", source: "idx"}]),
        )
    })

    it("detects placeholder task names in index", async () => {
        const id = "bad"
        const dir = path.join(tasksDir, id)
        fs.mkdirSync(dir)
        const entry = {
            id, task: "Task #1", size: 0, ts: 1, number: 1,
            tokensIn: 10, tokensOut: 10, totalCost: 0.01,
            workspace: "/ws", mode: "code", apiConfigName: "default",
        }
        fs.writeFileSync(
            path.join(dir, "history_item.json"),
            JSON.stringify(entry),
        )
        fs.writeFileSync(
            path.join(tasksDir, "_index.json"),
            JSON.stringify([entry]),
        )

        const result = await scanStorage(root)
        const hit = result.corruptions.find((c) => c.taskId === id)
        expect(hit?.reasons).toEqual(
            expect.arrayContaining([{reason: "placeholder_task_name", source: "hi,idx"}, {
                reason: "zero_size",
                source: "hi,idx"
            }]),
        )
    })

    it("reports invalid_json when _index.json fails to parse", async () => {
        fs.writeFileSync(path.join(tasksDir, "_index.json"), "{ invalid", "utf8")

        const result = await scanStorage(root)
        const hit = result.corruptions.find((c) => c.taskId === "_index.json")
        expect(hit?.reasons).toContainEqual({reason: "invalid_json", source: "idx"})
    })

    it("reports missing_task_dir when an index entry references a missing dir", async () => {
        const a = {id: "a", task: "A", size: 100, parentTaskId: "ghost"}
        const ghost = {id: "ghost", task: "Ghost", size: 100}
        fs.writeFileSync(path.join(tasksDir, "_index.json"), JSON.stringify([a, ghost]))
        const dirA = path.join(tasksDir, "a")
        fs.mkdirSync(dirA)
        fs.writeFileSync(path.join(dirA, "history_item.json"), JSON.stringify(a))

        const result = await scanStorage(root)
        const hit = result.corruptions.find((c) => c.taskId === "a")
        expect(hit?.reasons).toContainEqual({reason: "missing_task_dir", source: "idx"})
    })
})
