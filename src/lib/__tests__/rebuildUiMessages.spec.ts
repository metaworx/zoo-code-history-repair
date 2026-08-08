import { rebuildUiMessages, snakeToCamel } from "../rebuildUiMessages.js"
import type { UiMessageEvent } from "../rebuildUiMessages.js"

describe("snakeToCamel", () => {
    it("converts simple underscore_case", () => {
        expect(snakeToCamel("read_file")).toBe("readFile")
    })

    it("converts multi-segment names", () => {
        expect(snakeToCamel("execute_command")).toBe("executeCommand")
    })

    it("preserves mcp-- prefix and converts after last --", () => {
        expect(snakeToCamel("mcp--jetbrains--get_file_problems")).toBe(
            "mcp--jetbrains--getFileProblems",
        )
    })

    it("handles single word (no underscore)", () => {
        expect(snakeToCamel("hello")).toBe("hello")
    })

    it("handles empty string", () => {
        expect(snakeToCamel("")).toBe("")
    })
})

describe("rebuildUiMessages", () => {
    it("returns empty array for empty input", () => {
        expect(rebuildUiMessages([])).toEqual([])
    })

    it("returns empty array for turns with empty content", () => {
        expect(
            rebuildUiMessages([{ role: "user", content: [] }]),
        ).toEqual([])
    })

    it("maps user text block to say:text event", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [{ type: "text", text: "Hello world" }],
                ts: 1000,
            },
        ])
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
            say: "text",
            text: "Hello world",
            partial: false,
        })
    })

    it("skips whitespace-only user text", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [{ type: "text", text: "   " }],
                ts: 1000,
            },
        ])
        expect(events).toHaveLength(0)
    })

    it("maps assistant text block to say:text event", () => {
        const events = rebuildUiMessages([
            {
                role: "assistant",
                content: [{ type: "text", text: "Sure!" }],
                ts: 1000,
            },
        ])
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ say: "text", text: "Sure!" })
    })

    it("maps assistant reasoning block to say:reasoning event", () => {
        const events = rebuildUiMessages([
            {
                role: "assistant",
                content: [{ type: "reasoning", text: "Let me think..." }],
                ts: 1000,
            },
        ])
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ say: "reasoning", text: "Let me think..." })
    })

    it("skips empty reasoning text", () => {
        const events = rebuildUiMessages([
            {
                role: "assistant",
                content: [{ type: "reasoning", text: "" }],
                ts: 1000,
            },
        ])
        expect(events).toHaveLength(0)
    })

    it("maps tool_use block to say:tool event with descriptor JSON", () => {
        const events = rebuildUiMessages([
            {
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        name: "read_file",
                        id: "toolu_01",
                        input: { path: "/foo/bar.ts", isOutsideWorkspace: false },
                    },
                ],
                ts: 2000,
            },
        ])
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ say: "tool" })
        const descriptor = JSON.parse(events[0].text)
        expect(descriptor).toMatchObject({
            tool: "readFile",
            path: "/foo/bar.ts",
            isOutsideWorkspace: false,
        })
    })

    it("includes MCP fields in tool_use descriptor", () => {
        const events = rebuildUiMessages([
            {
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        name: "mcp--jetbrains--get_file_problems",
                        id: "toolu_02",
                        input: {
                            serverName: "jetbrains",
                            toolName: "getFileProblems",
                            arguments: '{"filePath":"foo.ts"}',
                        },
                    },
                ],
                ts: 3000,
            },
        ])
        const descriptor = JSON.parse(events[0].text)
        expect(descriptor).toMatchObject({
            tool: "mcp--jetbrains--getFileProblems",
            serverName: "jetbrains",
            toolName: "getFileProblems",
            arguments: '{"filePath":"foo.ts"}',
        })
    })

    it("maps tool_result block to say:tool event with concatenated content", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "toolu_01",
                        content: [
                            { type: "text", text: "Line 1" },
                            { type: "text", text: "Line 2" },
                        ],
                    },
                ],
                ts: 4000,
            },
        ])
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ say: "tool" })
        expect(events[0].text).toBe("Line 1\nLine 2")
    })

    it("handles string content items in tool_result", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "toolu_01",
                        content: ["plain string", { type: "text", text: "structured" }],
                    },
                ],
                ts: 5000,
            },
        ])
        expect(events[0].text).toBe("plain string\nstructured")
    })

    it("serializes resource-type content as JSON in tool_result", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "toolu_01",
                        content: [{ type: "resource", uri: "file:///x" }],
                    },
                ],
                ts: 6000,
            },
        ])
        const parsed = JSON.parse(events[0].text)
        expect(parsed).toMatchObject({ type: "resource", uri: "file:///x" })
    })

    it("maps image block (user) to say:text with placeholder", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [
                    {
                        type: "image",
                        source: { type: "base64", media_type: "image/png", data: "abc" },
                    },
                ],
                ts: 7000,
            },
        ])
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
            say: "text",
            text: "[Image: image/png]",
            partial: false,
        })
    })

    it("maps image block (assistant) to say:text with placeholder", () => {
        const events = rebuildUiMessages([
            {
                role: "assistant",
                content: [
                    {
                        type: "image",
                        source: { media_type: "image/jpeg" },
                    },
                ],
                ts: 8000,
            },
        ])
        expect(events[0].text).toBe("[Image: image/jpeg]")
    })

    it("uses 'unknown' media type when source is missing", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [{ type: "image" }],
                ts: 9000,
            },
        ])
        expect(events[0].text).toBe("[Image: unknown]")
    })

    it("increments ts monotonically within a turn", () => {
        const events = rebuildUiMessages([
            {
                role: "assistant",
                content: [
                    { type: "reasoning", text: "A" },
                    { type: "text", text: "B" },
                    { type: "tool_use", name: "read_file", id: "t1", input: {} },
                ],
                ts: 100,
            },
        ])
        expect(events[0].ts).toBe(100)
        expect(events[1].ts).toBe(101)
        expect(events[2].ts).toBe(102)
    })

    it("handles multiple turns with shared ts counter", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [{ type: "text", text: "Q1" }],
                ts: 10,
            },
            {
                role: "assistant",
                content: [{ type: "text", text: "A1" }],
                ts: 20,
            },
        ])
        expect(events[0].ts).toBe(10)
        // counter is global; second event = baseTs(20) + counter(1) = 21
        expect(events[1].ts).toBe(21)
        expect(events[0].text).toBe("Q1")
        expect(events[1].text).toBe("A1")
    })

    it("defaults ts to 0 when not provided", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [{ type: "text", text: "No ts" }],
            },
        ])
        expect(events[0].ts).toBe(0)
    })

    it("handles unknown block types gracefully (skipped)", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [{ type: "unknown_block", text: "ignored" }],
                ts: 1000,
            },
        ])
        expect(events).toHaveLength(0)
    })

    it("produces correct full multi-turn reconstruction", () => {
        const events = rebuildUiMessages([
            {
                role: "user",
                content: [{ type: "text", text: "Fix the bug" }],
                ts: 100,
            },
            {
                role: "assistant",
                content: [
                    { type: "reasoning", text: "I should check the code" },
                    {
                        type: "tool_use",
                        name: "read_file",
                        id: "tu1",
                        input: { path: "/src/bug.ts" },
                    },
                ],
                ts: 200,
            },
            {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "tu1",
                        content: [{ type: "text", text: "line1\nline2" }],
                    },
                ],
                ts: 300,
            },
        ])

        expect(events).toHaveLength(4)
        expect(events[0]).toMatchObject({ say: "text", text: "Fix the bug", ts: 100 })
        // counter is global across all turns:
        // events[0] ts=100+0=100, events[1] ts=200+1=201,
        // events[2] ts=200+2=202, events[3] ts=300+3=303
        expect(events[1]).toMatchObject({ say: "reasoning", ts: 201 })
        expect(events[2]).toMatchObject({ say: "tool", ts: 202 })
        expect(events[3]).toMatchObject({ say: "tool", ts: 303 })
    })
})
