/**
 * @file src/lib/__tests__/validation.spec.ts
 *
 * Unit tests for inspectTaskDir corruption detection.
 */

import {inspectTaskDir, isPlaceholderTaskName,} from "../validation.js"
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

    it("flags missing history_item", async () => {
        const result = await inspectTaskDir("abc", tmp, null)
        expect(result.reasons).toContainEqual({reason: "missing_history_item", source: "hi"})
    })

    it("flags placeholder task + zero size from disk item", async () => {
        writeJson("history_item.json", {
            id: "abc",
            task: "Task #1",
            size: 0,
            ts: 1,
            number: 1,
            tokensIn: 10,
            tokensOut: 10,
            totalCost: 0.01,
            workspace: "/ws",
            mode: "code",
            apiConfigName: "default",
        } satisfies HistoryItem)

        const result = await inspectTaskDir("abc", tmp, null)
        expect(result.reasons).toEqual(
            expect.arrayContaining([{reason: "placeholder_task_name", source: "hi"}, {
                reason: "zero_size",
                source: "hi"
            }]),
        )
        expect(result.diskItem?.task).toBe("Task #1")
    })

    it("flags empty ui/api arrays", async () => {
        writeJson("history_item.json", {
            id: "abc",
            task: "Real task",
            size: 100,
            number: 1,
            ts: 1,
            tokensIn: 10,
            tokensOut: 10,
            totalCost: 0.01,
            workspace: "/ws",
            mode: "code",
            apiConfigName: "default",
        })
        writeJson("ui_messages.json", [])
        writeJson("api_conversation_history.json", [])

        const result = await inspectTaskDir("abc", tmp, null)
        expect(result.reasons).toEqual(
            expect.arrayContaining([{reason: "empty_ui_messages", source: "uim"}, {
                reason: "empty_api_history",
                source: "ach"
            }]),
        )
    })

    it("returns no reasons for a healthy task", async () => {
        writeJson("history_item.json", {
            id: "abc",
            task: "Implement feature X",
            size: 12345,
            tokensIn: 10,
            tokensOut: 20,
            totalCost: 0.01,
            number: 1,
            ts: 1,
            workspace: "/ws",
            mode: "code",
            apiConfigName: "default",
        })
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("api_conversation_history.json", [{role: "user", content: "hi"}])

        const result = await inspectTaskDir("abc", tmp, null)
        expect(result.reasons).toEqual([])
    })

    describe("invalid_json", () => {
        const healthy = {
            id: "abc",
            task: "Real task",
            size: 100,
            ts: 1,
            number: 1,
            tokensIn: 10,
            tokensOut: 10,
            totalCost: 0.01,
            workspace: "/ws",
            mode: "code",
            apiConfigName: "default",
        }

        it("flags history_item.json that fails to parse", async () => {
            fs.writeFileSync(path.join(tmp, "history_item.json"), "{ not valid json", "utf8")
            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContainEqual({reason: "invalid_json", source: "hi"})
            expect(result.reasons).not.toContainEqual({reason: "missing_history_item", source: "hi"})
        })

        it("flags ui_messages.json that fails to parse", async () => {
            writeJson("history_item.json", healthy)
            fs.writeFileSync(path.join(tmp, "ui_messages.json"), "[1, 2,", "utf8")
            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContainEqual({reason: "invalid_json", source: "uim"})
        })

        it("flags api_conversation_history.json that fails to parse", async () => {
            writeJson("history_item.json", healthy)
            fs.writeFileSync(path.join(tmp, "api_conversation_history.json"), "[{", "utf8")
            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContainEqual({reason: "invalid_json", source: "ach"})
        })

        it("flags task_metadata.json that fails to parse", async () => {
            writeJson("history_item.json", healthy)
            fs.writeFileSync(path.join(tmp, "task_metadata.json"), "{ broken", "utf8")
            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContainEqual({reason: "invalid_json", source: "tmd"})
        })
    })

    describe("missing_task_text", () => {
        const base = {
            id: "abc",
            size: 100,
            ts: 1,
            number: 1,
            tokensIn: 10,
            tokensOut: 10,
            totalCost: 0.01,
            workspace: "/ws",
            mode: "code",
            apiConfigName: "default"
        }

        it("flags empty task string", async () => {
            writeJson("history_item.json", {...base, task: ""} satisfies HistoryItem)
            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContainEqual({reason: "missing_task_text", source: "hi"})
        })

        it("flags undefined task", async () => {
            writeJson("history_item.json", {...base} satisfies Partial<HistoryItem> as HistoryItem)
            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContainEqual({reason: "missing_task_text", source: "hi"})
        })

        it("does not flag non-empty task", async () => {
            writeJson("history_item.json", {...base, task: "Real task"})
            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContainEqual({reason: "missing_task_text", source: "hi"})
        })
    })

    describe("interrupted_task", () => {
        it("does NOT flag unanswered attempt_completion (Trigger A removed — normal child-task behavior)", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
            writeJson("api_conversation_history.json", [{
                role: "assistant",
                content: [{type: "tool_use", name: "attempt_completion", id: "toolu_01", input: {}}],
            }])

            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContainEqual({reason: "interrupted_task", source: "ach"})
        })

        it("does NOT flag unanswered attemptCompletion (camelCase) (Trigger A removed)", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
            writeJson("api_conversation_history.json", [{
                role: "assistant",
                content: [{type: "tool_use", name: "attemptCompletion", id: "toolu_02", input: {}}],
            }])

            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContainEqual({reason: "interrupted_task", source: "ach"})
        })

        it("gates interrupted_task when solo (co-occurrence required)", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
            writeJson("api_conversation_history.json", [
                {role: "user", content: [{type: "text", text: "Do X"}]},
                {
                    role: "assistant",
                    content: [{type: "text", text: "Okay"}, {
                        type: "tool_use",
                        name: "write_file",
                        id: "tu1",
                        input: {}
                    }]
                },
            ])

            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContainEqual({reason: "interrupted_task", source: "ach"})
        })

        it("keeps interrupted_task when co-occurring with other corruption", async () => {
            writeJson("history_item.json", {
                id: "abc", task: "Real task", size: 0, ts: 1, number: 1,
                tokensIn: 10, tokensOut: 10, totalCost: 0.01,
                workspace: "/ws", mode: "code", apiConfigName: "default",
            })
            writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
            writeJson("api_conversation_history.json", [
                {role: "user", content: [{type: "text", text: "Do X"}]},
                {
                    role: "assistant",
                    content: [{type: "text", text: "Okay"}, {
                        type: "tool_use",
                        name: "write_file",
                        id: "tu1",
                        input: {}
                    }]
                },
            ])

            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContainEqual({reason: "interrupted_task", source: "ach"})
            expect(result.reasons).toContainEqual({reason: "zero_size", source: "hi"})
        })

        it("does not flag completed task with matching tool_results", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
            writeJson("api_conversation_history.json", [
                {
                    role: "assistant",
                    content: [{type: "tool_use", name: "read_file", id: "toolu_01", input: {path: "/foo"}}]
                },
                {
                    role: "user",
                    content: [{
                        type: "tool_result",
                        tool_use_id: "toolu_01",
                        content: [{type: "text", text: "content"}]
                    }]
                },
                {role: "assistant", content: [{type: "text", text: "Done!"}]},
            ])

            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("interrupted_task")
        })

        it("does not flag task with no tool_use blocks", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
            writeJson("api_conversation_history.json", [
                {role: "user", content: [{type: "text", text: "Hello"}]},
                {role: "assistant", content: [{type: "text", text: "Hi there"}]},
            ])

            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("interrupted_task")
        })
    })

    describe("verifyUiSync", () => {
        it("detects ui_sync_mismatch when lengths differ", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [
                {ts: 100, type: "say", say: "text", text: "A", partial: false},
                {ts: 101, type: "say", say: "text", text: "B", partial: false},
            ])
            writeJson("api_conversation_history.json", [
                {role: "user", content: [{type: "text", text: "Hello"}], ts: 100},
            ])

            const result = await inspectTaskDir("abc", tmp, null, {verifyUiSync: true})
            expect(result.reasons).toContainEqual({reason: "ui_sync_mismatch", source: "uim,ach"})
        })

        it("detects ui_sync_mismatch when say/text content differs", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [
                {ts: 100, type: "say", say: "text", text: "Old text", partial: false},
            ])
            writeJson("api_conversation_history.json", [
                {role: "user", content: [{type: "text", text: "Hello"}], ts: 100},
            ])

            const result = await inspectTaskDir("abc", tmp, null, {verifyUiSync: true})
            expect(result.reasons).toContainEqual({reason: "ui_sync_mismatch", source: "uim,ach"})
        })

        it("does not flag matching ui/ACH (no false positive)", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [
                {ts: 0, type: "say", say: "text", text: "Hello", partial: false},
            ])
            writeJson("api_conversation_history.json", [
                {role: "user", content: [{type: "text", text: "Hello"}], ts: 0},
            ])

            const result = await inspectTaskDir("abc", tmp, null, {verifyUiSync: true})
            expect(result.reasons).not.toContain("ui_sync_mismatch")
        })

        it("does not flag when verifyUiSync is disabled (default)", async () => {
            writeJson("history_item.json", {id: "abc", task: "Real task", size: 100, ts: 1})
            writeJson("ui_messages.json", [
                {ts: 100, type: "say", say: "text", text: "Mismatched", partial: false},
            ])
            writeJson("api_conversation_history.json", [
                {role: "user", content: [{type: "text", text: "Hello"}], ts: 100},
            ])

            const result = await inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("ui_sync_mismatch")
        })
    })
})
