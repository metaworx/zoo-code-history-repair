import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    backupFile,
    FileTransaction,
    JsonFileTransaction,
    readJsonFile,
    writeJsonCompact,
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

    it("returns null for a missing file", () => {
        expect(readJsonFile(path.join(tmp, "nope.json"))).toBeNull()
    })

    it("returns null for an empty file", () => {
        const f = path.join(tmp, "empty.json")
        fs.writeFileSync(f, "", "utf8")
        expect(readJsonFile(f)).toBeNull()
    })

    it("returns null for whitespace-only file", () => {
        const f = path.join(tmp, "ws.json")
        fs.writeFileSync(f, "   \n  ", "utf8")
        expect(readJsonFile(f)).toBeNull()
    })

    it("parses valid JSON", () => {
        const f = path.join(tmp, "ok.json")
        fs.writeFileSync(f, JSON.stringify({a: 1, b: [2, 3]}), "utf8")
        expect(readJsonFile(f)).toEqual({a: 1, b: [2, 3]})
    })

    it("returns null for invalid JSON", () => {
        const f = path.join(tmp, "bad.json")
        fs.writeFileSync(f, "{not json", "utf8")
        expect(readJsonFile(f)).toBeNull()
    })

    it("parses a primitive value", () => {
        const f = path.join(tmp, "prim.json")
        fs.writeFileSync(f, "42", "utf8")
        expect(readJsonFile(f)).toBe(42)
    })
})

describe("writeJsonCompact", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-writejson-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    it("writes compact JSON (no whitespace)", () => {
        const f = path.join(tmp, "out.json")
        writeJsonCompact(f, {a: 1, b: "x"})
        const raw = fs.readFileSync(f, "utf8")
        expect(raw).toBe('{"a":1,"b":"x"}')
    })

    it("round-trips through readJsonFile", () => {
        const f = path.join(tmp, "rt.json")
        const data = {id: "abc", items: [1, 2, 3], nested: {x: true}}
        writeJsonCompact(f, data)
        expect(readJsonFile(f)).toEqual(data)
    })
})

describe("backupFile", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-backup-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    it("returns null for a missing source", () => {
        expect(backupFile(path.join(tmp, "nope.txt"))).toBeNull()
    })

    it("creates a timestamped .bak copy", () => {
        const src = path.join(tmp, "data.json")
        fs.writeFileSync(src, "hello world", "utf8")

        const bak = backupFile(src)
        expect(bak).toBeTruthy()
        expect(bak!).toMatch(/\.\d{8}-\d{6}\.bak\.json$/)
        expect(fs.existsSync(bak!)).toBe(true)
        expect(fs.readFileSync(bak!, "utf8")).toBe("hello world")
    })

    it("preserves original file", () => {
        const src = path.join(tmp, "keep.json")
        fs.writeFileSync(src, "original", "utf8")
        backupFile(src)
        expect(fs.readFileSync(src, "utf8")).toBe("original")
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

        it("auto-registers validator via getValidatorByFile for _index.json", () => {
            const fp = path.join(tmp, "_index.json")
            // _index.json is recognized by getValidatorByFile → validateIndex is auto-registered
            // Must use JsonFileTransaction (not FileTransaction) because validators expect
            // parsed JSON objects, not raw strings
            fs.writeFileSync(fp, '{"version":1,"updatedAt":1,"entries":[]}', "utf8")
            const jft = new JsonFileTransaction(fp)
            const result = jft.validate()
            // validateIndex registered, validation passes for valid index JSON
            expect(result.valid).toBe(true)
            expect(result.errorCount).toBe(0)
        })

        it("accepts explicit validators via third argument", () => {
            const fp = path.join(tmp, "custom.file")
            fs.writeFileSync(fp, "hello", "utf8")
            const myValidator = (data: unknown) => ({
                valid: true,
                issues: [],
                errorCount: 0,
                warningCount: 0,
            })
            const ft = new FileTransaction(fp, false, [myValidator])
            const result = ft.validate()
            expect(result.valid).toBe(true)
            expect(result.issues).toHaveLength(0)
        })
    })

    describe("read()", () => {
        it("returns cached data on second call", () => {
            const fp = path.join(tmp, "data.txt")
            fs.writeFileSync(fp, "first", "utf8")
            const ft = new FileTransaction(fp)

            const result1 = ft.read()
            expect(result1).toBe("first")

            // Change file on disk
            fs.writeFileSync(fp, "second", "utf8")

            // Second read returns cached data
            const result2 = ft.read()
            expect(result2).toBe("first")
        })

        it("captures snapshot on read", () => {
            const fp = path.join(tmp, "snap.txt")
            fs.writeFileSync(fp, "content", "utf8")
            const ft = new FileTransaction(fp)
            ft.read()
            // Snapshot is private, test indirectly via save behavior
        })

        it("read(validate=true, force=true) re-reads from disk", () => {
            const fp = path.join(tmp, "force.txt")
            fs.writeFileSync(fp, "original", "utf8")
            const ft = new FileTransaction(fp)

            ft.read() // first read
            fs.writeFileSync(fp, "modified", "utf8")
            const result = ft.read(true, true) // force re-read
            expect(result).toBe("modified")
        })

        it("read(validate=false) skips validation", () => {
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
            const data = ft.read(false)
            expect(data).toBe('{"broken":')
        })
    })

    describe("save()", () => {
        it("throws if readOnly", () => {
            const fp = path.join(tmp, "ro.txt")
            fs.writeFileSync(fp, "data", "utf8")
            const ft = new FileTransaction(fp, true)
            ft.read()
            expect(() => ft.save()).toThrow("Cannot save read-only FileTransaction")
        })

        it("validates before write and throws on error", () => {
            const fp = path.join(tmp, "bad.txt")
            fs.writeFileSync(fp, "data", "utf8")
            const failingValidator = () => ({
                valid: false,
                issues: [{code: "FAIL", severity: "error" as const, field: "", message: "fail"}],
                errorCount: 1,
                warningCount: 0,
            })
            const ft = new FileTransaction(fp, false, [failingValidator])
            ft.read(false) // skip validation on read — save() will validate
            expect(() => ft.save()).toThrow("Validation failed")
        })

        it("save(data) replaces internal data and saves", () => {
            const fp = path.join(tmp, "save.txt")
            fs.writeFileSync(fp, "old", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const ft = new FileTransaction(fp, false, [passValidator])
            ft.read()
            ft.save("new data")
            const content = fs.readFileSync(fp, "utf8")
            expect(content).toBe("new data")
        })

        it("writes via saveFileWithSnapshot (atomic rename)", () => {
            const fp = path.join(tmp, "atomic.txt")
            fs.writeFileSync(fp, "before", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const ft = new FileTransaction(fp, false, [passValidator])
            ft.read()
            ft.save("after")
            const content = fs.readFileSync(fp, "utf8")
            expect(content).toBe("after")
        })

        it("reverts data on validation failure", () => {
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
            ft.read()
            expect(ft.read()).toBe("original")
            expect(() => ft.save("bad")).toThrow("Validation failed")
            // Data should be reverted
            expect(ft.read()).toBe("original")
        })
    })

    describe("validate()", () => {
        it("aggregates results from multiple validators", () => {
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
            const result = ft.validate()
            expect(result.valid).toBe(false)
            expect(result.errorCount).toBe(1)
            expect(result.warningCount).toBe(1)
            expect(result.issues).toHaveLength(2)
        })

        it("returns NOT_FOUND for missing file", () => {
            const fp = path.join(tmp, "missing.txt")
            const ft = new FileTransaction(fp)
            const result = ft.validate()
            expect(result.valid).toBe(false)
            expect(result.issues.some(i => i.code === "NOT_FOUND")).toBe(true)
        })

        it("throws on error with validate($throw=true)", () => {
            const fp = path.join(tmp, "throw.txt")
            fs.writeFileSync(fp, "data", "utf8")
            const failingValidator = () => ({
                valid: false,
                issues: [{code: "E1", severity: "error" as const, field: "x", message: "bad"}],
                errorCount: 1,
                warningCount: 0,
            })
            const ft = new FileTransaction(fp, false, [failingValidator])
            expect(() => ft.validate(true)).toThrow("Validation failed")
        })

        it("returns NO_VALIDATOR warning when no validators registered", () => {
            const fp = path.join(tmp, "no-val.txt")
            fs.writeFileSync(fp, "content", "utf8")
            const ft = new FileTransaction(fp, false, []) // empty validators
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
        it("parses valid JSON", () => {
            const fp = path.join(tmp, "ok.json")
            fs.writeFileSync(fp, '{"a":1,"b":[2]}', "utf8")
            const jft = new JsonFileTransaction(fp)
            const data = jft.read()
            expect(data).toEqual({a: 1, b: [2]})
        })

        it("returns null for empty file", () => {
            const fp = path.join(tmp, "empty.json")
            fs.writeFileSync(fp, "", "utf8")
            const jft = new JsonFileTransaction(fp)
            const data = jft.read()
            expect(data).toBeNull()
        })
    })

    describe("_write()", () => {
        it("stringifies JSON with writeJsonCompact-style output", () => {
            const fp = path.join(tmp, "out.json")
            fs.writeFileSync(fp, "{}", "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const jft = new JsonFileTransaction(fp, false, [passValidator])
            jft.read()
            jft.save({x: 1, y: "z"})
            const raw = fs.readFileSync(fp, "utf8")
            expect(raw).toBe('{"x":1,"y":"z"}')
        })
    })

    describe("integration", () => {
        it("read JSON → modify → save → read back", () => {
            const fp = path.join(tmp, "integ.json")
            fs.writeFileSync(fp, '{"count":0}', "utf8")
            const passValidator = () => ({valid: true, issues: [], errorCount: 0, warningCount: 0})
            const jft = new JsonFileTransaction(fp, false, [passValidator])

            const data = jft.read() as Record<string, unknown>
            expect(data.count).toBe(0)

            ;(data as any).count = 42
            jft.save(data)

            const jft2 = new JsonFileTransaction(fp)
            const reloaded = jft2.read() as Record<string, unknown>
            expect(reloaded.count).toBe(42)
        })
    })
})
