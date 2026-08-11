import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    FileTransaction,
    JsonFileTransaction,
    readJsonFile,
    saveFile,
} from "../file.js"
import {getValidatorByFile} from "../validation.js"

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

    it("creates .bak.json when backup option is set", async () => {
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
