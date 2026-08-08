import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    backupFile,
    readJsonFile,
    readPartialJsonArray,
    writeJsonCompact,
} from "../readJson.js"

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

describe("readPartialJsonArray", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-partial-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    function write(name: string, content: string) {
        const f = path.join(tmp, name)
        fs.writeFileSync(f, content, "utf8")
        return f
    }

    it("returns null for missing file", () => {
        expect(readPartialJsonArray(path.join(tmp, "nope.json"))).toBeNull()
    })

    it("returns null for empty file", () => {
        const f = write("empty.json", "")
        expect(readPartialJsonArray(f)).toBeNull()
    })

    it("returns null for non-array JSON", () => {
        const f = write("obj.json", '{"a":1}')
        expect(readPartialJsonArray(f)).toBeNull()
    })

    it("reads intact array (fast path, truncated=false)", () => {
        const f = write("good.json", '[{"id":1},{"id":2}]')
        const result = readPartialJsonArray(f)
        expect(result).not.toBeNull()
        expect(result!.truncated).toBe(false)
        expect(result!.data).toEqual([{id: 1}, {id: 2}])
    })

    it("recovers single truncated element", () => {
        // Object is complete but array bracket is missing
        const f = write("trunc.json", '[{"id":1,"val":"ok"}')
        const result = readPartialJsonArray(f)
        expect(result).not.toBeNull()
        expect(result!.truncated).toBe(true)
        expect(result!.data).toEqual([{id: 1, val: "ok"}])
    })

    it("recovers multiple elements from truncated array", () => {
        const f = write("trunc2.json", '[{"a":1},{"b":2},{"c":3')
        const result = readPartialJsonArray(f)
        expect(result).not.toBeNull()
        expect(result!.truncated).toBe(true)
        expect(result!.data).toEqual([{a: 1}, {b: 2}])
    })

    it("returns null for completely garbled content", () => {
        const f = write("garbled.json", "not even close to json[{")
        expect(readPartialJsonArray(f)).toBeNull()
    })

    it("returns null for content not starting with [", () => {
        const f = write("noarr.json", '{"x":1}')
        expect(readPartialJsonArray(f)).toBeNull()
    })

    it("handles a single complete element without trailing comma", () => {
        const f = write("single.json", '[{"only":"one"}]')
        const result = readPartialJsonArray(f)
        expect(result).not.toBeNull()
        expect(result!.truncated).toBe(false)
        expect(result!.data).toEqual([{only: "one"}])
    })
})
