import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {readPartialJsonArray} from "../../io/readJson.js"

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
