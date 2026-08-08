/**
 * Tests for v0.2.0 features: verifyUiSync, interrupted_task, missing_task_text.
 *
 * These extend detectCorruption.spec.ts coverage for inspectTaskDir options
 * that were added in v0.2.0.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { inspectTaskDir } from "../detectCorruption.js"
import type { HistoryItem } from "../../types.js"

describe("inspectTaskDir — v0.2.0 features", () => {
    let tmp: string

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-detectv2-"))
    })

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    function writeJson(file: string, data: unknown) {
        fs.writeFileSync(path.join(tmp, file), JSON.stringify(data), "utf8")
    }

    describe("missing_task_text", () => {
        it("flags empty task string", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "",
                size: 100,
                ts: 1,
            } satisfies HistoryItem)

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContain("missing_task_text")
        })

        it("flags undefined task", () => {
            writeJson("history_item.json", {
                id: "abc",
                size: 100,
                ts: 1,
            } satisfies Partial<HistoryItem> as HistoryItem)

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContain("missing_task_text")
        })

        it("does not flag non-empty task", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("missing_task_text")
        })
    })

    describe("interrupted_task", () => {
        it("does NOT flag unanswered attempt_completion (Trigger A removed — normal child-task behavior)", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
            writeJson("api_conversation_history.json", [
                {
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            name: "attempt_completion",
                            id: "toolu_01",
                            input: {},
                        },
                    ],
                },
            ])

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("interrupted_task")
        })

        it("does NOT flag unanswered attemptCompletion (camelCase) (Trigger A removed)", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
            writeJson("api_conversation_history.json", [
                {
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            name: "attemptCompletion",
                            id: "toolu_02",
                            input: {},
                        },
                    ],
                },
            ])

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("interrupted_task")
        })

        it("gates interrupted_task when solo (co-occurrence required)", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
            writeJson("api_conversation_history.json", [
                {
                    role: "user",
                    content: [{ type: "text", text: "Do X" }],
                },
                {
                    role: "assistant",
                    content: [
                        { type: "text", text: "Okay" },
                        { type: "tool_use", name: "write_file", id: "tu1", input: {} },
                    ],
                },
            ])

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("interrupted_task")
        })

        it("keeps interrupted_task when co-occurring with other corruption", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 0,
                ts: 1,
            })
            writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
            writeJson("api_conversation_history.json", [
                {
                    role: "user",
                    content: [{ type: "text", text: "Do X" }],
                },
                {
                    role: "assistant",
                    content: [
                        { type: "text", text: "Okay" },
                        { type: "tool_use", name: "write_file", id: "tu1", input: {} },
                    ],
                },
            ])

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).toContain("interrupted_task")
            expect(result.reasons).toContain("zero_size")
        })

        it("does not flag completed task with matching tool_results", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
            writeJson("api_conversation_history.json", [
                {
                    role: "assistant",
                    content: [
                        {
                            type: "tool_use",
                            name: "read_file",
                            id: "toolu_01",
                            input: { path: "/foo" },
                        },
                    ],
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            tool_use_id: "toolu_01",
                            content: [{ type: "text", text: "content" }],
                        },
                    ],
                },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Done!" }],
                },
            ])

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("interrupted_task")
        })

        it("does not flag task with no tool_use blocks", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
            writeJson("api_conversation_history.json", [
                {
                    role: "user",
                    content: [{ type: "text", text: "Hello" }],
                },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hi there" }],
                },
            ])

            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("interrupted_task")
        })
    })

    describe("verifyUiSync", () => {
        it("detects ui_sync_mismatch when lengths differ", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            // ui has 2 events, but ACH only produces 1
            writeJson("ui_messages.json", [
                { ts: 100, type: "say", say: "text", text: "A", partial: false },
                { ts: 101, type: "say", say: "text", text: "B", partial: false },
            ])
            writeJson("api_conversation_history.json", [
                {
                    role: "user",
                    content: [{ type: "text", text: "Hello" }],
                    ts: 100,
                },
            ])

            const result = inspectTaskDir("abc", tmp, null, { verifyUiSync: true })
            expect(result.reasons).toContain("ui_sync_mismatch")
        })

        it("detects ui_sync_mismatch when say/text content differs", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            // ui says "Old text" but ACH would produce "Hello"
            writeJson("ui_messages.json", [
                { ts: 100, type: "say", say: "text", text: "Old text", partial: false },
            ])
            writeJson("api_conversation_history.json", [
                {
                    role: "user",
                    content: [{ type: "text", text: "Hello" }],
                    ts: 100,
                },
            ])

            const result = inspectTaskDir("abc", tmp, null, { verifyUiSync: true })
            expect(result.reasons).toContain("ui_sync_mismatch")
        })

        it("does not flag matching ui/ACH (no false positive)", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            writeJson("ui_messages.json", [
                { ts: 0, type: "say", say: "text", text: "Hello", partial: false },
            ])
            writeJson("api_conversation_history.json", [
                {
                    role: "user",
                    content: [{ type: "text", text: "Hello" }],
                    ts: 0,
                },
            ])

            const result = inspectTaskDir("abc", tmp, null, { verifyUiSync: true })
            expect(result.reasons).not.toContain("ui_sync_mismatch")
        })

        it("does not flag when verifyUiSync is disabled (default)", () => {
            writeJson("history_item.json", {
                id: "abc",
                task: "Real task",
                size: 100,
                ts: 1,
            })
            writeJson("ui_messages.json", [
                { ts: 100, type: "say", say: "text", text: "Mismatched", partial: false },
            ])
            writeJson("api_conversation_history.json", [
                {
                    role: "user",
                    content: [{ type: "text", text: "Hello" }],
                    ts: 100,
                },
            ])

            // verifyUiSync defaults to false — mismatch should NOT be detected
            const result = inspectTaskDir("abc", tmp, null)
            expect(result.reasons).not.toContain("ui_sync_mismatch")
        })
    })
})
