import {inspectTaskDir, isPlaceholderTaskName,} from "../detectCorruption.js"
import type {HistoryItem} from "../../types.js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

describe("isPlaceholderTaskName", () => {
    it("treats empty / whitespace as placeholder", () => {
        expect(isPlaceholderTaskName(undefined)).toBe(true)
        expect(isPlaceholderTaskName("")).toBe(true)
        expect(isPlaceholderTaskName("   ")).toBe(true)
    })

    it("detects Task #N patterns", () => {
        expect(isPlaceholderTaskName("Task #1")).toBe(true)
        expect(isPlaceholderTaskName("Task #12")).toBe(true)
        expect(isPlaceholderTaskName("Task #3 (Incomplete)")).toBe(true)
        expect(isPlaceholderTaskName("Task #3 (No messages)")).toBe(true)
    })

    it("accepts real task text", () => {
        expect(isPlaceholderTaskName("Fix login bug")).toBe(false)
        expect(isPlaceholderTaskName("Refactor auth module")).toBe(false)
    })
})

describe("inspectTaskDir", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-repair-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, {recursive: true, force: true})
    })

    function writeJson(file: string, data: unknown) {
        fs.writeFileSync(path.join(tmp, file), JSON.stringify(data), "utf8")
    }

    it("flags missing history_item", () => {
        const result = inspectTaskDir("abc", tmp, null)
        expect(result.reasons).toContain("missing_history_item")
    })

    it("flags placeholder task + zero size from disk item", () => {
        writeJson("history_item.json", {
            id: "abc",
            task: "Task #1",
            size: 0,
            ts: 1,
        } satisfies HistoryItem)

        const result = inspectTaskDir("abc", tmp, null)
        expect(result.reasons).toEqual(
            expect.arrayContaining(["placeholder_task_name", "zero_size"]),
        )
        expect(result.diskItem?.task).toBe("Task #1")
    })

    it("flags empty ui/api arrays", () => {
        writeJson("history_item.json", {
            id: "abc",
            task: "Real task",
            size: 100,
        })
        writeJson("ui_messages.json", [])
        writeJson("api_conversation_history.json", [])

        const result = inspectTaskDir("abc", tmp, null)
        expect(result.reasons).toEqual(
            expect.arrayContaining(["empty_ui_messages", "empty_api_history"]),
        )
    })

    it("returns no reasons for a healthy task", () => {
        writeJson("history_item.json", {
            id: "abc",
            task: "Implement feature X",
            size: 12345,
            tokensIn: 10,
            tokensOut: 20,
            totalCost: 0.01,
        })
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("api_conversation_history.json", [{role: "user", content: "hi"}])

        const result = inspectTaskDir("abc", tmp, null)
        expect(result.reasons).toEqual([])
    })
})
