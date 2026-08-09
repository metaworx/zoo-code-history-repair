import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {rebuildIndexFromDisk} from "../rebuildIndex.js"
import {readJsonFile} from "../file.js";
import type {HistoryItem, IndexFile} from "../../types.js"

describe("rebuildIndexFromDisk", () => {
    let root: string
    let tasksDir: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-rebuild-"))
        tasksDir = path.join(root, "tasks")
        fs.mkdirSync(tasksDir)
    })

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    })

    function addTask(id: string, item: Partial<HistoryItem>) {
        const dir = path.join(tasksDir, id)
        fs.mkdirSync(dir)
        fs.writeFileSync(
            path.join(dir, "history_item.json"),
            JSON.stringify({id, ts: item.ts ?? 0, task: item.task ?? "x", ...item}),
        )
    }

    it("rebuilds index from history_item.json files (dry-run)", () => {
        addTask("t1", {task: "First", ts: 100, size: 10})
        addTask("t2", {task: "Second", ts: 200, size: 20})

        const {items, written} = rebuildIndexFromDisk(root, {dryRun: true})
        expect(written).toBe(false)
        expect(items).toHaveLength(2)
        // newest first
        expect(items[0].id).toBe("t2")
        expect(items[1].id).toBe("t1")
        expect(fs.existsSync(path.join(tasksDir, "_index.json"))).toBe(false)
    })

    it("writes compact _index.json and optional backup", () => {
        addTask("t1", {task: "Only", ts: 50, size: 5})

        // seed an existing index so backup has something to copy
        fs.writeFileSync(path.join(tasksDir, "_index.json"), "[]")

        const {items, written, backupPath} = rebuildIndexFromDisk(root, {
            dryRun: false,
            backup: true,
        })

        expect(written).toBe(true)
        expect(items).toHaveLength(1)
        expect(backupPath).toBeTruthy()

        const index = readJsonFile<IndexFile>(path.join(tasksDir, "_index.json"))
        expect(index?.entries).toEqual([
            expect.objectContaining({id: "t1", task: "Only", size: 5}),
        ])
    })

    it("skips dirs without history_item.json", () => {
        fs.mkdirSync(path.join(tasksDir, "empty-dir"))
        addTask("ok", {task: "Ok", ts: 1})

        const {items} = rebuildIndexFromDisk(root, {dryRun: true})
        expect(items.map((i) => i.id)).toEqual(["ok"])
    })
})
