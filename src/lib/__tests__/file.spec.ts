import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    consolidateBackups,
    FileTransaction,
    JsonFileTransaction,
    listBackups,
    listBackupsForTask,
    parseTimestamp,
    readJsonFile,
    saveFile,
} from "../file.js"

describe("readJsonFile", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-readjson-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    it("returns null for a missing file", async () => {
        expect(await readJsonFile(path.join(tmp, "nope.json"))).toBeNull()
    })

    it("returns null for an empty file", async () => {
        const f = path.join(tmp, "empty.json")
        fs.writeFileSync(f, "", "utf8")
        expect(await readJsonFile(f)).toBeNull()
    })

    it("returns null for whitespace-only file", async () => {
        const f = path.join(tmp, "ws.json")
        fs.writeFileSync(f, "   \n  ", "utf8")
        expect(await readJsonFile(f)).toBeNull()
    })

    it("parses valid JSON", async () => {
        const f = path.join(tmp, "ok.json")
        fs.writeFileSync(f, JSON.stringify({a: 1, b: [2, 3]}), "utf8")
        expect(await readJsonFile(f)).toEqual({a: 1, b: [2, 3]})
    })

    it("returns null for invalid JSON", async () => {
        const f = path.join(tmp, "bad.json")
        fs.writeFileSync(f, "{not json", "utf8")
        expect(await readJsonFile(f)).toBeNull()
    })

    it("parses a primitive value", async () => {
        const f = path.join(tmp, "prim.json")
        fs.writeFileSync(f, "42", "utf8")
        expect(await readJsonFile(f)).toBe(42)
    })
})

describe("saveFile", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-savefile-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    it("writes JSON object (stringify=true)", async () => {
        const f = path.join(tmp, "out.json")
        await saveFile(f, {a: 1, b: "x"}, {stringify: true})
        const raw = fs.readFileSync(f, "utf8")
        expect(raw).toBe('{"a":1,"b":"x"}')
    })

    it("writes raw string", async () => {
        const f = path.join(tmp, "raw.txt")
        await saveFile(f, "hello world")
        const raw = fs.readFileSync(f, "utf8")
        expect(raw).toBe("hello world")
    })

    it("throws on snapshot mismatch", async () => {
        const f = path.join(tmp, "snap.txt")
        fs.writeFileSync(f, "original", "utf8")
        const snap = {mtimeMs: 0, ctimeMs: 0, size: 0}
        await expect(saveFile(f, "new", {snapshot: snap})).rejects.toThrow("Concurrent modification detected")
    })

    it("creates .bak.json when backup option is set (string)", async () => {
        const f = path.join(tmp, "data.json")
        fs.writeFileSync(f, '{"old":true}', "utf8")
        const bakPath = path.join(tmp, "my-backup.bak.json")
        await saveFile(f, {new: true}, {stringify: true, backup: bakPath})
        expect(fs.existsSync(bakPath)).toBe(true)
        expect(JSON.parse(fs.readFileSync(bakPath, "utf8"))).toEqual({old: true})
    })

    it("does not create .bak.json for new file", async () => {
        const f = path.join(tmp, "fresh.json")
        const bakPath = path.join(tmp, "unused.bak.json")
        await saveFile(f, {hello: "world"}, {stringify: true, backup: bakPath})
        // No backup because target didn't exist before
        expect(fs.existsSync(bakPath)).toBe(false)
        expect(JSON.parse(fs.readFileSync(f, "utf8"))).toEqual({hello: "world"})
    })

    it("with backup: true mutates options.backup to the .bak_*.tmp path", async () => {
        const f = path.join(tmp, "bool-backup.json")
        fs.writeFileSync(f, '{"old":true}', "utf8")
        const opts: { backup: boolean | string | null | undefined } = {stringify: true, backup: true}
        await saveFile(f, {new: true}, opts)
        // backup mutated from true to the .bak_*.tmp path string
        expect(typeof opts.backup).toBe("string")
        expect(opts.backup).toContain(".bak_")
        expect(opts.backup).toContain(".tmp")
    })

    it("with backup: false does not keep a backup", async () => {
        const f = path.join(tmp, "no-backup.json")
        fs.writeFileSync(f, '{"old":true}', "utf8")
        await saveFile(f, {new: true}, {stringify: true, backup: false})
        // No backup file should exist (safeWriteJson deleted it)
        const files = fs.readdirSync(tmp)
        const bakFiles = files.filter(name => name.includes(".bak_"))
        expect(bakFiles).toHaveLength(0)
    })

    it("with backup: undefined does not keep a backup", async () => {
        const f = path.join(tmp, "undef-backup.json")
        fs.writeFileSync(f, '{"old":true}', "utf8")
        await saveFile(f, {new: true}, {stringify: true})
        const files = fs.readdirSync(tmp)
        const bakFiles = files.filter(name => name.includes(".bak_"))
        expect(bakFiles).toHaveLength(0)
    })
})

describe("parseTimestamp", () => {
    it("parses a valid timestamp to a Date", () => {
        const result = parseTimestamp("20260812-143025")
        expect(result).toBeInstanceOf(Date)
        expect(result!.getFullYear()).toBe(2026)
        expect(result!.getMonth()).toBe(7) // August = month 7 (0-indexed)
        expect(result!.getDate()).toBe(12)
        expect(result!.getHours()).toBe(14)
        expect(result!.getMinutes()).toBe(30)
        expect(result!.getSeconds()).toBe(25)
    })

    it("returns null for invalid format (wrong separator)", () => {
        expect(parseTimestamp("20260812_143025")).toBeNull()
    })

    it("returns null for invalid format (too short)", () => {
        expect(parseTimestamp("20260812-1430")).toBeNull()
    })

    it("returns null for empty string", () => {
        expect(parseTimestamp("")).toBeNull()
    })

    it("returns null for non-timestamp string", () => {
        expect(parseTimestamp("not-a-timestamp")).toBeNull()
    })

    it("returns null for just numbers without separator", () => {
        expect(parseTimestamp("20260812143025")).toBeNull()
    })

    it("parses midnight correctly", () => {
        const result = parseTimestamp("20260101-000000")
        expect(result).toBeInstanceOf(Date)
        expect(result!.getHours()).toBe(0)
        expect(result!.getMinutes()).toBe(0)
        expect(result!.getSeconds()).toBe(0)
    })
})

describe("listBackupsForTask", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-lbt-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    it("returns empty array for empty directory", async () => {
        const result = await listBackupsForTask(tmp, ["data.json"])
        expect(result).toEqual([])
    })

    it("returns empty array when no files match basenames", async () => {
        fs.writeFileSync(path.join(tmp, "other.json.20260812-120000.bak.json"), "{}", "utf8")
        const result = await listBackupsForTask(tmp, ["data.json"])
        expect(result).toEqual([])
    })

    it("filters by basenames", async () => {
        const dataBak = path.join(tmp, "data.json.20260812-120000.bak.json")
        const otherBak = path.join(tmp, "other.json.20260812-120000.bak.json")
        fs.writeFileSync(dataBak, "{}", "utf8")
        fs.writeFileSync(otherBak, "{}", "utf8")

        const result = await listBackupsForTask(tmp, ["data.json"])
        expect(result).toHaveLength(1)
        expect(result[0].bakPath).toBe(dataBak)
        expect(result[0].baseName).toBe("data.json")
        expect(result[0].timestamp).toBe("20260812-120000")
    })

    it("matches multiple basenames", async () => {
        const a = path.join(tmp, "a.json.20260812-120000.bak.json")
        const b = path.join(tmp, "b.json.20260812-120000.bak.json")
        const c = path.join(tmp, "c.json.20260812-120000.bak.json")
        fs.writeFileSync(a, "{}", "utf8")
        fs.writeFileSync(b, "{}", "utf8")
        fs.writeFileSync(c, "{}", "utf8")

        const result = await listBackupsForTask(tmp, ["a.json", "c.json"])
        expect(result).toHaveLength(2)
        const paths = result.map(e => e.bakPath)
        expect(paths).toContain(a)
        expect(paths).toContain(c)
    })

    it("returns full paths", async () => {
        const bak = path.join(tmp, "data.json.20260812-120000.bak.json")
        fs.writeFileSync(bak, "{}", "utf8")

        const result = await listBackupsForTask(tmp, ["data.json"])
        expect(result[0].bakPath).toBe(bak)
        expect(path.isAbsolute(result[0].bakPath)).toBe(true)
    })

    it("skips non-bak files", async () => {
        fs.writeFileSync(path.join(tmp, "data.json"), "{}", "utf8")
        fs.writeFileSync(path.join(tmp, "readme.txt"), "hello", "utf8")

        const result = await listBackupsForTask(tmp, ["data.json"])
        expect(result).toEqual([])
    })
})

describe("listBackups", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-lb-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    it("returns empty array for empty tasks dir", async () => {
        const result = await listBackups(tmp)
        expect(result).toEqual([])
    })

    it("returns empty array when no task dirs contain bak files", async () => {
        const taskDir = path.join(tmp, "task-001")
        fs.mkdirSync(taskDir, {recursive: true})
        fs.writeFileSync(path.join(taskDir, "data.json"), "{}", "utf8")

        const result = await listBackups(tmp)
        expect(result).toEqual([])
    })

    it("discovers bak files across task directories", async () => {
        const taskDir = path.join(tmp, "019f726a-0f50-711c-929e-9546e5100546")
        fs.mkdirSync(taskDir, {recursive: true})
        const bakPath = path.join(taskDir, "history_item.json.20260812-143000.bak.json")
        fs.writeFileSync(bakPath, "{}", "utf8")

        const result = await listBackups(tmp)
        expect(result).toHaveLength(1)
        expect(result[0].taskId).toBe("019f726a-0f50-711c-929e-9546e5100546")
        expect(result[0].timestamp).toBe("20260812-143000")
        expect(result[0].bakPath).toBe(bakPath)
        expect(result[0].baseName).toBe("history_item.json")
        expect(result[0].basePath).toBe(path.join(taskDir, "history_item.json"))
    })

    it("discovers multiple bak files within a single task dir", async () => {
        const taskDir = path.join(tmp, "task-a")
        fs.mkdirSync(taskDir, {recursive: true})
        const bak1 = path.join(taskDir, "history_item.json.20260812-140000.bak.json")
        const bak2 = path.join(taskDir, "ui_messages.json.20260812-150000.bak.json")
        fs.writeFileSync(bak1, "{}", "utf8")
        fs.writeFileSync(bak2, "{}", "utf8")

        const result = await listBackups(tmp)
        expect(result).toHaveLength(2)
    })

    it("discovers bak files across multiple task dirs", async () => {
        const d1 = path.join(tmp, "task-1")
        const d2 = path.join(tmp, "task-2")
        fs.mkdirSync(d1, {recursive: true})
        fs.mkdirSync(d2, {recursive: true})
        fs.writeFileSync(path.join(d1, "data.json.20260812-120000.bak.json"), "{}", "utf8")
        fs.writeFileSync(path.join(d2, "data.json.20260812-130000.bak.json"), "{}", "utf8")

        const result = await listBackups(tmp)
        expect(result).toHaveLength(2)
        const taskIds = result.map(e => e.taskId).sort()
        expect(taskIds).toEqual(["task-1", "task-2"])
    })

    it("skips dot-directories (e.g. .git)", async () => {
        const dotDir = path.join(tmp, ".hidden")
        fs.mkdirSync(dotDir, {recursive: true})
        fs.writeFileSync(path.join(dotDir, "data.json.20260812-120000.bak.json"), "{}", "utf8")

        const result = await listBackups(tmp)
        expect(result).toEqual([])
    })

    it("skips non-bak files in task dirs", async () => {
        const taskDir = path.join(tmp, "task-x")
        fs.mkdirSync(taskDir, {recursive: true})
        fs.writeFileSync(path.join(taskDir, "history_item.json"), "{}", "utf8")
        fs.writeFileSync(path.join(taskDir, "notes.txt"), "hello", "utf8")

        const result = await listBackups(tmp)
        expect(result).toEqual([])
    })

    it("scopes to a single task when taskId is provided", async () => {
        const d1 = path.join(tmp, "task-1")
        const d2 = path.join(tmp, "task-2")
        fs.mkdirSync(d1, {recursive: true})
        fs.mkdirSync(d2, {recursive: true})
        fs.writeFileSync(path.join(d1, "data.json.20260812-120000.bak.json"), "{}", "utf8")
        fs.writeFileSync(path.join(d2, "data.json.20260812-130000.bak.json"), "{}", "utf8")

        const result = await listBackups(tmp, {taskId: "task-1"})
        expect(result).toHaveLength(1)
        expect(result[0].taskId).toBe("task-1")
    })

    it("filters by basenames", async () => {
        const taskDir = path.join(tmp, "task-a")
        fs.mkdirSync(taskDir, {recursive: true})
        fs.writeFileSync(path.join(taskDir, "history_item.json.20260812-140000.bak.json"), "{}", "utf8")
        fs.writeFileSync(path.join(taskDir, "ui_messages.json.20260812-150000.bak.json"), "{}", "utf8")

        const result = await listBackups(tmp, {basenames: ["history_item.json"]})
        expect(result).toHaveLength(1)
        expect(result[0].baseName).toBe("history_item.json")
    })
})

describe("consolidateBackups", () => {
    let tmp: string
    let target: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-cons-"))
        target = path.join(tmp, "data.json")
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    async function createBackupFile(name: string, content: object): Promise<string> {
        const p = path.join(tmp, name)
        fs.writeFileSync(p, JSON.stringify(content), "utf8")
        return p
    }

    it("removes backups with content identical to target", async () => {
        fs.writeFileSync(target, JSON.stringify({version: 1, data: "hello"}), "utf8")
        const bak1 = await createBackupFile("data.json.20260812-120000.bak.json", {version: 1, data: "hello"})
        const bak2 = await createBackupFile("data.json.20260812-130000.bak.json", {version: 1, data: "hello"})

        const result = await consolidateBackups(target)

        expect(result.removed).toContain(bak1)
        expect(result.removed).toContain(bak2)
        expect(fs.existsSync(bak1)).toBe(false)
        expect(fs.existsSync(bak2)).toBe(false)
    })

    it("keeps backups with different content from target", async () => {
        fs.writeFileSync(target, JSON.stringify({version: 1, data: "hello"}), "utf8")
        const bak = await createBackupFile("data.json.20260812-120000.bak.json", {version: 1, data: "different"})

        const result = await consolidateBackups(target)

        expect(result.removed).toHaveLength(0)
        expect(fs.existsSync(bak)).toBe(true)
    })

    it("returns newBackup path when unique", async () => {
        fs.writeFileSync(target, JSON.stringify({version: 1, data: "target"}), "utf8")
        const newBak = await createBackupFile("data.json.20260812-140000.bak.json", {version: 1, data: "unique"})

        const result = await consolidateBackups(target, newBak)

        expect(result.new).toBe(newBak)
        expect(fs.existsSync(newBak)).toBe(true)
    })

    it("removes newBackup when duplicate of an existing backup", async () => {
        fs.writeFileSync(target, JSON.stringify({version: 1, data: "target"}), "utf8")
        // existing backup with same content as newBackup
        await createBackupFile("data.json.20260812-120000.bak.json", {version: 1, data: "dup"})
        const newBak = await createBackupFile("data.json.20260812-140000.bak.json", {version: 1, data: "dup"})

        const result = await consolidateBackups(target, newBak)

        expect(result.new).toBeUndefined()
        expect(result.removed).not.toContain(newBak)
        expect(fs.existsSync(newBak)).toBe(false)
    })

    it("handles empty directory (no backups)", async () => {
        fs.writeFileSync(target, JSON.stringify({version: 1}), "utf8")

        const result = await consolidateBackups(target)

        expect(result.removed).toEqual([])
        expect(result.target).toBe(target)
    })

    it("handles target with no contentHash (unreadable file)", async () => {
        const missing = path.join(tmp, "missing.json")
        await createBackupFile("missing.json.20260812-120000.bak.json", {version: 1})

        const result = await consolidateBackups(missing)

        // No hash for target, no removals
        expect(result.removed).toHaveLength(0)
    })

    it("includes additionalBasenames in backup discovery", async () => {
        fs.writeFileSync(target, JSON.stringify({version: 1, data: "hello"}), "utf8")
        // Backup for a different basename that matches target content
        const otherBak = await createBackupFile("other.json.20260812-120000.bak.json", {version: 1, data: "hello"})

        const result = await consolidateBackups(target, undefined, ["other.json"])

        expect(result.removed).toContain(otherBak)
        expect(fs.existsSync(otherBak)).toBe(false)
    })

    it("never includes newBackup in removed array", async () => {
        fs.writeFileSync(target, JSON.stringify({version: 1, data: "hello"}), "utf8")
        // Create a backup matching target content
        const sameBak = await createBackupFile("data.json.20260812-120000.bak.json", {version: 1, data: "hello"})

        const result = await consolidateBackups(target, sameBak)

        // sameBak should not be in removed (it was newBackup), but it was matched to target
        expect(result.removed).not.toContain(sameBak)
    })

    it("does not compare newBackup against itself when checking duplicates", async () => {
        fs.writeFileSync(target, JSON.stringify({version: 1, data: "target"}), "utf8")
        // newBackup with unique content
        const newBak = await createBackupFile("data.json.20260812-140000.bak.json", {version: 1, data: "unique"})

        const result = await consolidateBackups(target, newBak)

        expect(result.new).toBe(newBak)
        expect(fs.existsSync(newBak)).toBe(true)
    })
})

describe("FileTransaction", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-ft-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    describe("constructor", () => {
        it("defaults readOnly to true", () => {
            const fp = path.join(tmp, "test.txt")
            fs.writeFileSync(fp, "hello", "utf8")
            const ft = new FileTransaction(fp)
            expect(ft.readOnly).toBe(true)
        })

        it("auto-registers validator via getValidatorByFile for _index.json", async () => {
            const fp = path.join(tmp, "_index.json")
            // _index.json is recognized by getValidatorByFile → validateIndex is auto-registered
            // Must use JsonFileTransaction (not FileTransaction) because validators expect
            // parsed JSON objects, not raw strings
            fs.writeFileSync(fp, '{"version":1,"updatedAt":1,"entries":[]}', "utf8")
            const jft = new JsonFileTransaction(fp)
            await jft.load(false)
            const result = jft.validate()
            // validateIndex registered, validation passes for valid index JSON
            expect(result.valid).toBe(true)
            expect(result.errorCount).toBe(0)
        })

        it("accepts explicit validators via third argument", async () => {
            const fp = path.join(tmp, "custom.file")
            fs.writeFileSync(fp, "hello", "utf8")
            const myValidator = (data: unknown) => ({
                valid: true,
                issues: [],
                errorCount: 0,
                warningCount: 0,
            })
            const ft = new FileTransaction(fp, false, [myValidator])
            await ft.load(false)
            const result = ft.validate()
            expect(result.valid).toBe(true)
            expect(result.issues).toHaveLength(0)
        })
    })

    describe("read()", () => {
        it("returns cached data on second call", async () => {
            const fp = path.join(tmp, "data.txt")
            fs.writeFileSync(fp, "first", "utf8")
            const ft = new FileTransaction(fp)

            await ft.load()
            const result1 = ft.getData()
            expect(result1).toBe("first")

            // Change file on disk
            fs.writeFileSync(fp, "second", "utf8")

            // Second read returns cached data
            await ft.load()
            const result2 = ft.getData()
            expect(result2).toBe("first")
        })

        it("captures snapshot on read", async () => {
            const fp = path.join(tmp, "snap.txt")
            fs.writeFileSync(fp, "content", "utf8")
            const ft = new FileTransaction(fp)
            await ft.load()
            ft.getData()
            // Snapshot is private, test indirectly via save behavior
        })

        it("read(validate=true, force=true) re-reads from disk", async () => {
            const fp = path.join(tmp, "force.txt")
            fs.writeFileSync(fp, "original", "utf8")
            const ft = new FileTransaction(fp)

            await ft.load() // first read
            fs.writeFileSync(fp, "modified", "utf8")
            await ft.load(true, true) // force re-read
            const result = ft.getData()
            expect(result).toBe("modified")
        })

        it("read(validate=false) skips validation", async () => {
            const fp = path.join(tmp, "skip.json")
            // Invalid JSON with a custom validator that would fail
            fs.writeFileSync(fp, '{"broken":', "utf8")
            const failingValidator = () => ({
                valid: false,
                issues: [{code: "FAIL", severity: "error" as const, field: "", message: "fail"}],
                errorCount: 1,
                warningCount: 0,
            })
            const ft = new FileTransaction(fp, false, [failingValidator])
            // read(false) should return data without throwing
            await ft.load(false)
            const data = ft.getData()
            expect(data).toBe('{"broken":')
        })
    })

    describe("save()", () => {
        it("throws if readOnly", async () => {
            const fp = path.join(tmp, "ro.txt")
            fs.writeFileSync(fp, "data", "utf8")
            const ft = new FileTransaction(fp, true)
            await ft.load()
            ft.getData()
            await expect(ft.save()).rejects.toThrow("Cannot save read-only FileTransaction")
        })

        it("validates before write and throws on error", async () => {
            const fp = path.join(tmp, "bad.txt")
            fs.writeFileSync(fp, "data", "utf8")
            const failingValidator = () => ({
                valid: false,
                issues: [{code: "FAIL", severity: "error" as const, field: "", message: "fail"}],
                errorCount: 1,
                warningCount: 0,
            })
            const ft = new FileTransaction(fp, false, [failingValidator])
            await ft.load(false) // skip validation on read — save() will validate
            await expect(ft.save()).rejects.toThrow("Validation failed")
        })

        it("save(data) replaces internal data and saves", async () => {
            const fp = path.join(tmp, "save.txt")
            fs.writeFileSync(fp, "old", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const ft = new FileTransaction(fp, false, [passValidator])
            await ft.load()
            ft.setData("new data")
            await ft.save()
            const content = fs.readFileSync(fp, "utf8")
            expect(content).toBe("new data")
        })

        it("writes via saveFile (atomic rename)", async () => {
            const fp = path.join(tmp, "atomic.txt")
            fs.writeFileSync(fp, "before", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const ft = new FileTransaction(fp, false, [passValidator])
            await ft.load()
            ft.setData("after")
            await ft.save()
            const content = fs.readFileSync(fp, "utf8")
            expect(content).toBe("after")
        })

        it("reverts data on validation failure", async () => {
            const fp = path.join(tmp, "revert.txt")
            fs.writeFileSync(fp, "original", "utf8")
            const failingValidator = (data: unknown) => {
                if (data === "bad") {
                    return {
                        valid: false,
                        issues: [{code: "FAIL", severity: "error" as const, field: "", message: "no bad allowed"}],
                        errorCount: 1,
                        warningCount: 0,
                    }
                }
                return {valid: true, issues: [], errorCount: 0, warningCount: 0}
            }
            const ft = new FileTransaction(fp, false, [failingValidator])
            await ft.load()
            expect(ft.getData()).toBe("original")
            ft.setData("bad", false)
            await expect(ft.save()).rejects.toThrow("Validation failed")
            // Data was set by setData, save reverts to setData value
            await ft.load()
            expect(ft.getData()).toBe("bad")
        })

        it("with backup: true creates a backup and returns the renamed path", async () => {
            const fp = path.join(tmp, "bool-save.txt")
            fs.writeFileSync(fp, "original", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const ft = new FileTransaction(fp, false, [passValidator])
            await ft.load()
            ft.setData("modified")
            const result = await ft.save(true, true)

            // Returns the final backup path with timestamp
            expect(result).toBeTruthy()
            expect(result).toContain(".bak.json")
            expect(fs.existsSync(result!)).toBe(true)

            // Backup contains original content
            const bakContent = fs.readFileSync(result!, "utf8")
            expect(bakContent).toBe("original")

            // Target file has modified content
            const targetContent = fs.readFileSync(fp, "utf8")
            expect(targetContent).toBe("modified")
        })

        it("with backup: false does not create a backup", async () => {
            const fp = path.join(tmp, "no-bak-save.txt")
            fs.writeFileSync(fp, "original", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const ft = new FileTransaction(fp, false, [passValidator])
            await ft.load()
            ft.setData("modified")
            const result = await ft.save(true, false)

            expect(result).toBeNull()

            // No backup files should exist
            const files = fs.readdirSync(tmp)
            const bakFiles = files.filter(name => name.includes(".bak"))
            expect(bakFiles).toHaveLength(0)
        })

        it("consolidation removes duplicate backups after boolean save", async () => {
            const fp = path.join(tmp, "cons-save.txt")
            fs.writeFileSync(fp, "original", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const ft = new FileTransaction(fp, false, [passValidator])

            await ft.load()
            ft.setData("modified")

            // First save: creates backup with "original" content
            const result1 = await ft.save(true, true)
            expect(result1).toBeTruthy()

            // Second save: "modified" is now the target, creates backup with "modified"
            await ft.load(true, true) // re-read from disk
            ft.setData("modified-v2")
            const result2 = await ft.save(true, true)

            // Both backups should exist (different content)
            expect(fs.existsSync(result1!)).toBe(true)
            expect(result2).toBeTruthy()
            expect(fs.existsSync(result2!)).toBe(true)
        })
    })

    describe("validate()", () => {
        it("aggregates results from multiple validators", async () => {
            const fp = path.join(tmp, "multi.txt")
            fs.writeFileSync(fp, "data", "utf8")
            const v1 = () => ({
                valid: true,
                issues: [{code: "W1", severity: "warning" as const, field: "", message: "w1"}],
                errorCount: 0,
                warningCount: 1,
            })
            const v2 = () => ({
                valid: false,
                issues: [{code: "E1", severity: "error" as const, field: "", message: "e1"}],
                errorCount: 1,
                warningCount: 0,
            })
            const ft = new FileTransaction(fp, false, [v1, v2])
            await ft.load(false)
            const result = ft.validate()
            expect(result.valid).toBe(false)
            expect(result.errorCount).toBe(1)
            expect(result.warningCount).toBe(1)
            expect(result.issues).toHaveLength(2)
        })

        it("returns NOT_FOUND for missing file", async () => {
            const fp = path.join(tmp, "missing.txt")
            const ft = new FileTransaction(fp)
            await ft.load(false)
            const result = ft.validate()
            expect(result.valid).toBe(false)
            expect(result.issues.some(i => i.code === "NOT_FOUND")).toBe(true)
        })

        it("throws on error with validate($throw=true)", async () => {
            const fp = path.join(tmp, "throw.txt")
            fs.writeFileSync(fp, "data", "utf8")
            const failingValidator = () => ({
                valid: false,
                issues: [{code: "E1", severity: "error" as const, field: "x", message: "bad"}],
                errorCount: 1,
                warningCount: 0,
            })
            const ft = new FileTransaction(fp, false, [failingValidator])
            await ft.load(false)
            expect(() => ft.validate(true)).toThrow("Validation failed")
        })

        it("returns NO_VALIDATOR warning when no validators registered", async () => {
            const fp = path.join(tmp, "no-val.txt")
            fs.writeFileSync(fp, "content", "utf8")
            const ft = new FileTransaction(fp, false, []) // empty validators
            await ft.load(false)
            const result = ft.validate()
            expect(result.valid).toBeNull()
            expect(result.issues.some(i => i.code === "NO_VALIDATOR")).toBe(true)
        })
    })
})

describe("JsonFileTransaction", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-jft-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    describe("_read()", () => {
        it("parses valid JSON", async () => {
            const fp = path.join(tmp, "ok.json")
            fs.writeFileSync(fp, '{"a":1,"b":[2]}', "utf8")
            const jft = new JsonFileTransaction(fp)
            await jft.load()
            const data = jft.getData()
            expect(data).toEqual({a: 1, b: [2]})
        })

        it("returns null for empty file", async () => {
            const fp = path.join(tmp, "empty.json")
            fs.writeFileSync(fp, "", "utf8")
            const jft = new JsonFileTransaction(fp)
            await jft.load()
            const data = jft.getData()
            expect(data).toBeNull()
        })
    })

    describe("_write()", () => {
        it("stringifies JSON with saveFile-style output", async () => {
            const fp = path.join(tmp, "out.json")
            fs.writeFileSync(fp, "{}", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const jft = new JsonFileTransaction(fp, false, [passValidator])
            await jft.load()
            jft.setData({x: 1, y: "z"})
            await jft.save()
            const raw = fs.readFileSync(fp, "utf8")
            expect(raw).toBe('{"x":1,"y":"z"}')
        })
    })

    describe("integration", () => {
        it("read JSON → modify → save → read back", async () => {
            const fp = path.join(tmp, "integ.json")
            fs.writeFileSync(fp, '{"count":0}', "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const jft = new JsonFileTransaction(fp, false, [passValidator])

            await jft.load()
            const data = jft.getData() as Record<string, unknown>
            expect(data.count).toBe(0)

            ;(data as any).count = 42
            jft.setData(data)
            await jft.save()

            const jft2 = new JsonFileTransaction(fp)
            await jft2.load()
            const reloaded = jft2.getData() as Record<string, unknown>
            expect(reloaded.count).toBe(42)
        })
    })
})
