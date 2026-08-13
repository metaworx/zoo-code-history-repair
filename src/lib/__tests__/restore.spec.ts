import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    deleteBackups,
    listBackupsForType,
    parseTimestamp,
    restoreFromBackups
} from "../restore.js"

describe("parseTimestamp", () => {
    it("parses valid YYYYMMDD-HHmmss", () => {
        const d = parseTimestamp("20260808-054500")
        expect(d).not.toBeNull()
        expect(d!.getFullYear()).toBe(2026)
        expect(d!.getMonth()).toBe(7)
        expect(d!.getDate()).toBe(8)
        expect(d!.getHours()).toBe(5)
        expect(d!.getMinutes()).toBe(45)
        expect(d!.getSeconds()).toBe(0)
    })

    it("returns null for invalid format", () => {
        expect(parseTimestamp("abc")).toBeNull()
        expect(parseTimestamp("20260808")).toBeNull()
        expect(parseTimestamp("20260808-054500.bak.json")).toBeNull()
    })
})

describe("listBackupsForType", () => {
    let root: string
    let tasksDir: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-restore-list-"))
        tasksDir = path.join(root, "tasks")
        fs.mkdirSync(tasksDir)
    })

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    })

    function makeTaskDir(id: string): string {
        const d = path.join(tasksDir, id)
        fs.mkdirSync(d)
        return d
    }

    function touch(filePath: string) {
        fs.writeFileSync(filePath, "content", "utf8")
    }

    it("returns empty when no backups exist", async () => {
        makeTaskDir("task-abc")
        expect(await listBackupsForType(tasksDir)).toEqual([])
    })

    it("returns empty for task dirs without .bak.json files", async () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json"))
        touch(path.join(d, "ui_messages.json"))
        expect(await listBackupsForType(tasksDir)).toEqual([])
    })

    it("finds single backup file", async () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json"))
        const bakName = "history_item.json.20260808-054500.bak.json"
        touch(path.join(d, bakName))

        const entries = await listBackupsForType(tasksDir)
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
            taskId: "task-abc",
            timestamp: "20260808-054500",
            baseName: "history_item.json",
        })
        expect(entries[0].bakPath).toContain(bakName)
        expect(entries[0].basePath).toContain("history_item.json")
        expect(entries[0].basePath).not.toContain(".bak")
    })

    it("finds multiple backups across tasks", async () => {
        const d1 = makeTaskDir("task-abc")
        const d2 = makeTaskDir("task-def")
        touch(path.join(d1, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d1, "ui_messages.json.20260807-120000.bak.json"))
        touch(path.join(d2, "_index.json.20260808-054500.bak.json"))

        const entries = await listBackupsForType(tasksDir, "all")
        expect(entries).toHaveLength(3)
    })

    it("ignores non-.bak.json files", async () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json"))
        touch(path.join(d, "history_item.json.old"))
        touch(path.join(d, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d, "history_item.json.20260808-054500.bak.json.extra"))

        const entries = await listBackupsForType(tasksDir)
        expect(entries).toHaveLength(1)
    })
})

describe("restoreFromBackups", () => {
    let root: string
    let tasksDir: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-restore-op-"))
        tasksDir = path.join(root, "tasks")
        fs.mkdirSync(tasksDir)
    })

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    })

    function makeTaskDir(id: string): string {
        const d = path.join(tasksDir, id)
        fs.mkdirSync(d)
        return d
    }

    function writeFile(filePath: string, content: string) {
        fs.writeFileSync(filePath, content, "utf8")
    }

    function readFile(filePath: string): string {
        return fs.readFileSync(filePath, "utf8")
    }

    it("restores by taskId using newest timestamp", async () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original")
        writeFile(path.join(d, "history_item.json.20260807-120000.bak.json"), "older")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "newer")

        const result = await restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(result.restored).toHaveLength(1)
        expect(result.restored[0].timestamp).toBe("20260808-054500")
        expect(readFile(path.join(d, "history_item.json"))).toBe("newer")
    })

    it("restores by taskId and timestamp", async () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original")
        writeFile(path.join(d, "history_item.json.20260807-120000.bak.json"), "older")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "newer")

        const result = await restoreFromBackups(tasksDir, {
            taskId: "task-abc",
            timestamp: "20260807-120000",
        })
        expect(result.restored).toHaveLength(1)
        expect(result.restored[0].timestamp).toBe("20260807-120000")
        expect(readFile(path.join(d, "history_item.json"))).toBe("older")
    })

    it("restores all tasks by timestamp only", async () => {
        const d1 = makeTaskDir("task-abc")
        const d2 = makeTaskDir("task-def")
        writeFile(path.join(d1, "history_item.json"), "orig-a")
        writeFile(path.join(d2, "history_item.json"), "orig-d")
        writeFile(path.join(d1, "history_item.json.20260808-054500.bak.json"), "restored-a")
        writeFile(path.join(d2, "history_item.json.20260808-054500.bak.json"), "restored-d")
        writeFile(path.join(d1, "history_item.json.20260807-120000.bak.json"), "older-a")

        const result = await restoreFromBackups(tasksDir, {timestamp: "20260808-054500"})
        expect(result.restored).toHaveLength(2)
        expect(readFile(path.join(d1, "history_item.json"))).toBe("restored-a")
        expect(readFile(path.join(d2, "history_item.json"))).toBe("restored-d")
    })

    it("creates a safety backup before overwriting", async () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original-content")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored-content")

        await restoreFromBackups(tasksDir, {taskId: "task-abc"})

        expect(readFile(path.join(d, "history_item.json"))).toBe("restored-content")

        const files = fs.readdirSync(d)
        const bakFiles = files.filter(f =>
            /^history_item\.json\.\d{8}-\d{6}\.bak\.json$/.test(f),
        )
        // Source backup + safety backup holding the prior content
        expect(bakFiles).toHaveLength(2)
        expect(bakFiles).toContain("history_item.json.20260808-054500.bak.json")

        const safety = bakFiles.find(f => f !== "history_item.json.20260808-054500.bak.json")
        expect(readFile(path.join(d, safety!))).toBe("original-content")
    })

    it("restore is idempotent — second run is no-op", async () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original-content")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored-content")

        const r1 = await restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(r1.restored).toHaveLength(1)
        expect(r1.skipped).toHaveLength(0)
        expect(readFile(path.join(d, "history_item.json"))).toBe("restored-content")

        const r2 = await restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(r2.restored).toHaveLength(0)
        expect(r2.skipped).toHaveLength(1)
        expect(r2.skipped[0]).toContain("already matches backup")
        expect(readFile(path.join(d, "history_item.json"))).toBe("restored-content")

        const bakFiles = fs.readdirSync(d).filter(f => /\.bak\.json$/.test(f))
        expect(bakFiles).toHaveLength(2)
    })

    it("restore-all idempotent — second run is no-op for already-matching files", async () => {
        const d1 = makeTaskDir("task-abc")
        const d2 = makeTaskDir("task-def")
        writeFile(path.join(d1, "history_item.json"), "orig-a")
        writeFile(path.join(d2, "history_item.json"), "orig-d")
        writeFile(path.join(d1, "history_item.json.20260808-054500.bak.json"), "restored-a")
        writeFile(path.join(d2, "history_item.json.20260808-054500.bak.json"), "restored-d")

        const r1 = await restoreFromBackups(tasksDir, {timestamp: "20260808-054500"})
        expect(r1.restored).toHaveLength(2)
        expect(r1.skipped).toHaveLength(0)

        const r2 = await restoreFromBackups(tasksDir, {timestamp: "20260808-054500"})
        expect(r2.restored).toHaveLength(0)
        expect(r2.skipped).toHaveLength(2)
        for (const s of r2.skipped) {
            expect(s).toContain("already matches backup")
        }
    })

    it("dry-run does not modify files", async () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored")

        const result = await restoreFromBackups(tasksDir, {
            taskId: "task-abc",
            dryRun: true,
        })
        expect(result.restored).toHaveLength(1)
        expect(readFile(path.join(d, "history_item.json"))).toBe("original")
    })

    it("skips missing .bak.json files", async () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored")

        const result = await restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(result.restored).toHaveLength(1)
        expect(result.skipped).toHaveLength(0)
    })

    it("does not mix timestamps when restoring by taskId", async () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "orig-hi")
        writeFile(path.join(d, "ui_messages.json"), "orig-ui")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "hi-v2")
        writeFile(path.join(d, "ui_messages.json.20260807-120000.bak.json"), "ui-v1")

        const result = await restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(result.restored).toHaveLength(1)
        expect(result.restored[0].baseName).toBe("history_item.json")
        expect(readFile(path.join(d, "ui_messages.json"))).toBe("orig-ui")
    })
})

describe("deleteBackups", () => {
    let root: string
    let tasksDir: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-restore-del-"))
        tasksDir = path.join(root, "tasks")
        fs.mkdirSync(tasksDir)
    })

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    })

    function makeTaskDir(id: string): string {
        const d = path.join(tasksDir, id)
        fs.mkdirSync(d)
        return d
    }

    function touch(filePath: string) {
        fs.writeFileSync(filePath, "content", "utf8")
    }

    it("deletes backups for a specific taskId", async () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d, "ui_messages.json.20260807-120000.bak.json"))

        const result = await deleteBackups(tasksDir, {taskId: "task-abc", type: "all"})
        expect(result.deleted).toHaveLength(2)
        expect(fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json"))).toBe(false)
        expect(fs.existsSync(path.join(d, "ui_messages.json.20260807-120000.bak.json"))).toBe(false)
    })

    it("deletes backups for a specific taskId and timestamp", async () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d, "history_item.json.20260807-120000.bak.json"))

        const result = await deleteBackups(tasksDir, {
            taskId: "task-abc",
            timestamp: "20260808-054500",
        })
        expect(result.deleted).toHaveLength(1)
        expect(fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json"))).toBe(false)
        expect(fs.existsSync(path.join(d, "history_item.json.20260807-120000.bak.json"))).toBe(true)
    })

    it("deletes backups by timestamp only across all tasks", async () => {
        const d1 = makeTaskDir("task-abc")
        const d2 = makeTaskDir("task-def")
        touch(path.join(d1, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d2, "_index.json.20260808-054500.bak.json"))
        touch(path.join(d1, "history_item.json.20260807-120000.bak.json"))

        const result = await deleteBackups(tasksDir, {timestamp: "20260808-054500", type: "all"})
        expect(result.deleted).toHaveLength(2)
        expect(fs.existsSync(path.join(d1, "history_item.json.20260807-120000.bak.json"))).toBe(true)
    })

    it("dry-run does not remove files", async () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json.20260808-054500.bak.json"))

        const result = await deleteBackups(tasksDir, {
            taskId: "task-abc",
            dryRun: true,
        })
        expect(result.deleted).toHaveLength(1)
        expect(fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json"))).toBe(true)
    })

    it("returns empty for non-existent taskId", async () => {
        const result = await deleteBackups(tasksDir, {taskId: "nonexistent"})
        expect(result.deleted).toHaveLength(0)
    })
})
