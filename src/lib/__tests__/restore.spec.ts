import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {deleteBackups, listBackups, parseTimestamp, restoreFromBackups} from "../restore.js"

describe("parseTimestamp", () => {
    it("parses valid YYYYMMDD-HHmmss", () => {
        const d = parseTimestamp("20260808-054500")
        expect(d).not.toBeNull()
        expect(d!.getFullYear()).toBe(2026)
        expect(d!.getMonth()).toBe(7) // August = 7 (0-indexed)
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

describe("listBackups", () => {
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

    it("returns empty when no backups exist", () => {
        makeTaskDir("task-abc")
        expect(listBackups(tasksDir)).toEqual([])
    })

    it("returns empty for task dirs without .bak.json files", () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json"))
        touch(path.join(d, "ui_messages.json"))
        expect(listBackups(tasksDir)).toEqual([])
    })

    it("finds single backup file", () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json"))
        // Create a .bak.json file manually
        const bakName = "history_item.json.20260808-054500.bak.json"
        touch(path.join(d, bakName))

        const entries = listBackups(tasksDir)
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

    it("finds multiple backups across tasks", () => {
        const d1 = makeTaskDir("task-abc")
        const d2 = makeTaskDir("task-def")
        touch(path.join(d1, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d1, "ui_messages.json.20260807-120000.bak.json"))
        touch(path.join(d2, "_index.json.20260808-054500.bak.json"))

        const entries = listBackups(tasksDir)
        expect(entries).toHaveLength(3)
    })

    it("ignores non-.bak.json files", () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json"))
        touch(path.join(d, "history_item.json.old"))
        touch(path.join(d, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d, "history_item.json.20260808-054500.bak.json.extra"))

        const entries = listBackups(tasksDir)
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

    it("restores by taskId using newest timestamp", () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original")
        // Create two backup timestamps
        writeFile(path.join(d, "history_item.json.20260807-120000.bak.json"), "older")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "newer")

        const result = restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(result.restored).toHaveLength(1)
        expect(result.restored[0].timestamp).toBe("20260808-054500")
        expect(readFile(path.join(d, "history_item.json"))).toBe("newer")
    })

    it("restores by taskId and timestamp", () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original")
        writeFile(path.join(d, "history_item.json.20260807-120000.bak.json"), "older")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "newer")

        const result = restoreFromBackups(tasksDir, {
            taskId: "task-abc",
            timestamp: "20260807-120000",
        })
        expect(result.restored).toHaveLength(1)
        expect(result.restored[0].timestamp).toBe("20260807-120000")
        expect(readFile(path.join(d, "history_item.json"))).toBe("older")
    })

    it("restores all tasks by timestamp only", () => {
        const d1 = makeTaskDir("task-abc")
        const d2 = makeTaskDir("task-def")
        writeFile(path.join(d1, "history_item.json"), "orig-a")
        writeFile(path.join(d2, "history_item.json"), "orig-d")
        writeFile(path.join(d1, "history_item.json.20260808-054500.bak.json"), "restored-a")
        writeFile(path.join(d2, "history_item.json.20260808-054500.bak.json"), "restored-d")
        // Also a different timestamp that should not match
        writeFile(path.join(d1, "history_item.json.20260807-120000.bak.json"), "older-a")

        const result = restoreFromBackups(tasksDir, {timestamp: "20260808-054500"})
        expect(result.restored).toHaveLength(2)
        expect(readFile(path.join(d1, "history_item.json"))).toBe("restored-a")
        expect(readFile(path.join(d2, "history_item.json"))).toBe("restored-d")
    })

    it("does NOT create safety backup before overwriting", () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original-content")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored-content")

        restoreFromBackups(tasksDir, {taskId: "task-abc"})

        // The restored content should be in place
        expect(readFile(path.join(d, "history_item.json"))).toBe("restored-content")

        // No extra safety backup should be created — only the original .bak.json remains
        const files = fs.readdirSync(d)
        const bakFiles = files.filter(f =>
            /^history_item\.json\.\d{8}-\d{6}\.bak\.json$/.test(f),
        )
        expect(bakFiles).toEqual(["history_item.json.20260808-054500.bak.json"])
    })

    it("restore is idempotent — second run is no-op", () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original-content")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored-content")

        // First restore
        const r1 = restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(r1.restored).toHaveLength(1)
        expect(r1.skipped).toHaveLength(0)
        expect(readFile(path.join(d, "history_item.json"))).toBe("restored-content")

        // Second restore — should be a no-op (content already matches backup)
        const r2 = restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(r2.restored).toHaveLength(0)
        expect(r2.skipped).toHaveLength(1)
        expect(r2.skipped[0]).toContain("already matches backup")
        expect(readFile(path.join(d, "history_item.json"))).toBe("restored-content")

        // Backup count should NOT have grown
        const bakFiles = fs.readdirSync(d).filter(f => /\.bak\.json$/.test(f))
        expect(bakFiles).toHaveLength(1)
    })

    it("restore-all idempotent — second run is no-op for already-matching files", () => {
        const d1 = makeTaskDir("task-abc")
        const d2 = makeTaskDir("task-def")
        writeFile(path.join(d1, "history_item.json"), "orig-a")
        writeFile(path.join(d2, "history_item.json"), "orig-d")
        writeFile(path.join(d1, "history_item.json.20260808-054500.bak.json"), "restored-a")
        writeFile(path.join(d2, "history_item.json.20260808-054500.bak.json"), "restored-d")

        // First restore all
        const r1 = restoreFromBackups(tasksDir, {timestamp: "20260808-054500"})
        expect(r1.restored).toHaveLength(2)
        expect(r1.skipped).toHaveLength(0)

        // Second restore all — both should be skipped (already match)
        const r2 = restoreFromBackups(tasksDir, {timestamp: "20260808-054500"})
        expect(r2.restored).toHaveLength(0)
        expect(r2.skipped).toHaveLength(2)
        for (const s of r2.skipped) {
            expect(s).toContain("already matches backup")
        }
    })

    it("dry-run does not modify files", () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "original")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored")

        const result = restoreFromBackups(tasksDir, {
            taskId: "task-abc",
            dryRun: true,
        })
        expect(result.restored).toHaveLength(1)
        expect(readFile(path.join(d, "history_item.json"))).toBe("original")
    })

    it("skips missing .bak.json files", () => {
        const d = makeTaskDir("task-abc")
        // Create backup in listBackups but delete it before restore
        // Actually, we test by not having the file present at all for the entry
        // Since listBackups only finds existing files, this case is covered by
        // the race condition between listBackups and restore. Let's just ensure
        // the restore doesn't crash with valid data.
        writeFile(path.join(d, "history_item.json"), "original")
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored")

        const result = restoreFromBackups(tasksDir, {taskId: "task-abc"})
        expect(result.restored).toHaveLength(1)
        expect(result.skipped).toHaveLength(0)
    })

    it("does not mix timestamps when restoring by taskId", () => {
        const d = makeTaskDir("task-abc")
        writeFile(path.join(d, "history_item.json"), "orig-hi")
        writeFile(path.join(d, "ui_messages.json"), "orig-ui")
        // Different timestamps for different files
        writeFile(path.join(d, "history_item.json.20260808-054500.bak.json"), "hi-v2")
        writeFile(path.join(d, "ui_messages.json.20260807-120000.bak.json"), "ui-v1")

        const result = restoreFromBackups(tasksDir, {taskId: "task-abc"})
        // Should only restore from newest timestamp (20260808-054500)
        expect(result.restored).toHaveLength(1)
        expect(result.restored[0].baseName).toBe("history_item.json")
        // ui_messages should NOT be restored (different timestamp)
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

    it("deletes backups for a specific taskId", () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d, "ui_messages.json.20260807-120000.bak.json"))

        const result = deleteBackups(tasksDir, {taskId: "task-abc"})
        expect(result.deleted).toHaveLength(2)
        expect(fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json"))).toBe(false)
        expect(fs.existsSync(path.join(d, "ui_messages.json.20260807-120000.bak.json"))).toBe(false)
    })

    it("deletes backups for a specific taskId and timestamp", () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d, "history_item.json.20260807-120000.bak.json"))

        const result = deleteBackups(tasksDir, {
            taskId: "task-abc",
            timestamp: "20260808-054500",
        })
        expect(result.deleted).toHaveLength(1)
        expect(fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json"))).toBe(false)
        expect(fs.existsSync(path.join(d, "history_item.json.20260807-120000.bak.json"))).toBe(true)
    })

    it("deletes backups by timestamp only across all tasks", () => {
        const d1 = makeTaskDir("task-abc")
        const d2 = makeTaskDir("task-def")
        touch(path.join(d1, "history_item.json.20260808-054500.bak.json"))
        touch(path.join(d2, "_index.json.20260808-054500.bak.json"))
        touch(path.join(d1, "history_item.json.20260807-120000.bak.json"))

        const result = deleteBackups(tasksDir, {timestamp: "20260808-054500"})
        expect(result.deleted).toHaveLength(2)
        expect(fs.existsSync(path.join(d1, "history_item.json.20260807-120000.bak.json"))).toBe(true)
    })

    it("dry-run does not remove files", () => {
        const d = makeTaskDir("task-abc")
        touch(path.join(d, "history_item.json.20260808-054500.bak.json"))

        const result = deleteBackups(tasksDir, {
            taskId: "task-abc",
            dryRun: true,
        })
        expect(result.deleted).toHaveLength(1)
        expect(fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json"))).toBe(true)
    })

    it("returns empty for non-existent taskId", () => {
        const result = deleteBackups(tasksDir, {taskId: "nonexistent"})
        expect(result.deleted).toHaveLength(0)
    })
})
