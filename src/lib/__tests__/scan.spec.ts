import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { scanStorage } from "../scan.js"

describe("scanStorage", () => {
    let root: string
    let tasksDir: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-scan-"))
        tasksDir = path.join(root, "tasks")
        fs.mkdirSync(tasksDir)
    })

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true })
    })

    it("reports folder_orphan when task dir is not in index", () => {
        const dir = path.join(tasksDir, "orphan-id")
        fs.mkdirSync(dir)
        fs.writeFileSync(
            path.join(dir, "history_item.json"),
            JSON.stringify({ id: "orphan-id", task: "Real", size: 99 }),
        )
        fs.writeFileSync(path.join(tasksDir, "_index.json"), "[]")

        const result = scanStorage(root)
        const hit = result.corruptions.find((c) => c.taskId === "orphan-id")
        expect(hit?.reasons).toContainEqual({reason: "folder_orphan", source: "hi"})
    })

    it("reports index_orphan when index entry has no folder", () => {
        fs.writeFileSync(
            path.join(tasksDir, "_index.json"),
            JSON.stringify([{ id: "ghost", task: "Ghost", size: 0 }]),
        )

        const result = scanStorage(root)
        const hit = result.corruptions.find((c) => c.taskId === "ghost")
        expect(hit?.reasons).toEqual(
            expect.arrayContaining([{reason: "index_orphan", source: "idx"}, {reason: "zero_size", source: "idx"}]),
        )
    })

    it("detects placeholder task names in index", () => {
        const id = "bad"
        const dir = path.join(tasksDir, id)
        fs.mkdirSync(dir)
        fs.writeFileSync(
            path.join(dir, "history_item.json"),
            JSON.stringify({ id, task: "Task #1", size: 0 }),
        )
        fs.writeFileSync(
            path.join(tasksDir, "_index.json"),
            JSON.stringify([{ id, task: "Task #1", size: 0 }]),
        )

        const result = scanStorage(root)
        const hit = result.corruptions.find((c) => c.taskId === id)
        expect(hit?.reasons).toEqual(
            expect.arrayContaining([{reason: "placeholder_task_name", source: "hi,idx"}, {reason: "zero_size", source: "hi,idx"}]),
        )
    })
})
