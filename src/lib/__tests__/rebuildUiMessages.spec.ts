/**
 * @file src/lib/__tests__/rebuildUiMessages.spec.ts
 */

import { rebuildUiMessages, snakeToCamel } from "../rebuildUiMessages.js"

describe("snakeToCamel", () => {
	it("converts simple underscore_case", () => {
		expect(snakeToCamel("read_file")).toBe("readFile")
	})

	it("converts multi-segment names", () => {
		expect(snakeToCamel("execute_command")).toBe("executeCommand")
	})

	it("preserves mcp-- prefix and converts after last --", () => {
		expect(snakeToCamel("mcp--jetbrains--get_file_problems")).toBe("mcp--jetbrains--getFileProblems")
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
		expect(rebuildUiMessages([{ role: "user", content: [] }])).toEqual([])
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

	it("skips successful tool_result", () => {
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
		expect(events).toHaveLength(0)
	})

	it("maps failed tool_result (is_error) to say:error event", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01",
						is_error: true,
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
		expect(events[0]).toMatchObject({ say: "error" })
		expect(events[0].text).toBe("Line 1\nLine 2")
	})

	it("maps failed tool_result with string content to say:error", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01",
						is_error: true,
						content: "Task was interrupted before completion.",
					},
				],
				ts: 4000,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({ say: "error" })
		expect(events[0].text).toBe("Task was interrupted before completion.")
	})

	it("handles string content items in failed tool_result", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01",
						is_error: true,
						content: ["plain string", { type: "text", text: "structured" }],
					},
				],
				ts: 5000,
			},
		])
		expect(events[0].say).toBe("error")
		expect(events[0].text).toBe("plain string\nstructured")
	})

	it("serializes resource-type content as JSON in failed tool_result", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_01",
						is_error: true,
						content: [{ type: "resource", uri: "file:///x" }],
					},
				],
				ts: 6000,
			},
		])
		expect(events[0].say).toBe("error")
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
						is_error: true,
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
		expect(events[3]).toMatchObject({ say: "error", ts: 303, text: "line1\nline2" })
	})

	it("strips <environment_details> from user text", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Fix the bug\n<environment_details>some details</environment_details>",
					},
				],
				ts: 100,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0].text).toBe("Fix the bug")
	})

	it("strips <environment_details> from assistant text", () => {
		const events = rebuildUiMessages([
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "Done\n<environment_details>details</environment_details>",
					},
				],
				ts: 100,
			},
		])
		expect(events[0].text).toBe("Done")
	})

	it("maps new_task tool_use to newTask descriptor with taskId from childIds", () => {
		const events = rebuildUiMessages(
			[
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							name: "new_task",
							id: "toolu_nt1",
							input: { mode: "code", message: "Implement X" },
						},
					],
					ts: 100,
				},
			],
			{ childIds: ["child-uuid-1"] },
		)
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({ say: "tool" })
		const descriptor = JSON.parse(events[0].text)
		expect(descriptor).toEqual({
			tool: "newTask",
			mode: "code",
			content: "Implement X",
			taskId: "child-uuid-1",
		})
	})

	it("resolves newTask taskIds by order-matching multiple childIds", () => {
		const events = rebuildUiMessages(
			[
				{
					role: "assistant",
					content: [
						{ type: "tool_use", name: "new_task", id: "n1", input: { mode: "code", message: "A" } },
						{ type: "tool_use", name: "newTask", id: "n2", input: { mode: "architect", message: "B" } },
					],
					ts: 100,
				},
			],
			{ childIds: ["child-1", "child-2"] },
		)
		expect(events).toHaveLength(2)
		expect(JSON.parse(events[0].text)).toMatchObject({ tool: "newTask", content: "A", taskId: "child-1" })
		expect(JSON.parse(events[1].text)).toMatchObject({ tool: "newTask", content: "B", taskId: "child-2" })
	})

	it("uses delegatedToId for the last newTask when childIds are exhausted", () => {
		const events = rebuildUiMessages(
			[
				{
					role: "assistant",
					content: [
						{ type: "tool_use", name: "new_task", id: "n1", input: { mode: "code", message: "A" } },
						{ type: "tool_use", name: "new_task", id: "n2", input: { mode: "code", message: "B" } },
					],
					ts: 100,
				},
			],
			{ childIds: ["child-1"], delegatedToId: "awaiting-child" },
		)
		expect(events).toHaveLength(2)
		expect(JSON.parse(events[0].text)).toMatchObject({ tool: "newTask", taskId: "child-1" })
		expect(JSON.parse(events[1].text)).toMatchObject({ tool: "newTask", taskId: "awaiting-child" })
	})

	it("omits the [ERROR] you-did-not-use-a-tool reminder user message", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "[ERROR] You did not use a tool in your previous response! Please retry with a tool use.\n\n# Reminder: Instructions for Tool Use\n\nUse a tool.",
					},
				],
				ts: 100,
			},
		])
		expect(events).toHaveLength(0)
	})

	it("omits the JSON-enveloped [ERROR] reminder user message", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: '{"role":"user","content":[{"type":"text","text":"[ERROR] You did not use a tool in your previous response! Please retry with a tool use.\n\n# Reminder: Instructions for Tool Use\n\nUse a tool.',
					},
				],
				ts: 100,
			},
		])
		expect(events).toHaveLength(0)
	})

	it("Does not omit a <user_message>-wrapped [ERROR] reminder message", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "<user_message>\n[ERROR] You did not use a tool in your previous response! Please retry with a tool use.\n</user_message>",
					},
				],
				ts: 100,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0].text).toContain("[ERROR] You did not use a tool")
	})

	it("does not omit text that merely contains the [ERROR] marker mid-string", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Note: [ERROR] You did not use a tool in your previous response! is a reminder.",
					},
				],
				ts: 100,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0].text).toContain("[ERROR] You did not use a tool")
	})

	it("strips <user_message> wrapping from emitted user text", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [{ type: "text", text: "<user_message>\nFix the bug\n</user_message>" }],
				ts: 100,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0].text).toBe("Fix the bug")
	})

	it("strips <user_message> wrapping with surrounding whitespace", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [{ type: "text", text: "  <user_message>\nHello\n</user_message>  " }],
				ts: 100,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0].text).toBe("Hello")
	})

	it("strips <user_message> wrapping from assistant text", () => {
		const events = rebuildUiMessages([
			{
				role: "assistant",
				content: [{ type: "text", text: "<user_message>\nDone\n</user_message>" }],
				ts: 100,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0].text).toBe("Done")
	})

	it("strips <user_message> wrapping from reasoning text", () => {
		const events = rebuildUiMessages([
			{
				role: "assistant",
				content: [{ type: "reasoning", text: "<user_message>\nThink\n</user_message>" }],
				ts: 100,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0].text).toBe("Think")
	})

	it("strips <user_message> wrapping from error text", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tu1",
						is_error: true,
						content: [{ type: "text", text: "<user_message>\nboom\n</user_message>" }],
					},
				],
				ts: 100,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0].text).toBe("boom")
	})

	it("appends a resume_task ask after events when status is active", () => {
		const events = rebuildUiMessages(
			[
				{
					role: "user",
					content: [{ type: "text", text: "<user_message>\nHello\n</user_message>" }],
					ts: 100,
				},
			],
			{ status: "active", resumeAsk: true },
		)
		expect(events).toHaveLength(2)
		expect(events[1]).toMatchObject({ type: "ask", ask: "resume_task" })
		expect(events[1].ts).toBe(events[0].ts + 1)
	})

	it("appends a resume_completed_task ask when status is completed", () => {
		const events = rebuildUiMessages(
			[
				{
					role: "assistant",
					content: [{ type: "text", text: "Done" }],
					ts: 500,
				},
			],
			{ status: "completed", resumeAsk: true },
		)
		expect(events).toHaveLength(2)
		expect(events[1]).toMatchObject({ type: "ask", ask: "resume_completed_task" })
		expect(events[1].ts).toBe(events[0].ts + 1)
	})

	it("treats interrupted status as resume_task", () => {
		const events = rebuildUiMessages([{ role: "user", content: [{ type: "text", text: "Hi" }], ts: 10 }], {
			status: "interrupted",
			resumeAsk: true,
		})
		expect(events).toHaveLength(2)
		expect(events[1]).toMatchObject({ type: "ask", ask: "resume_task" })
	})

	it("defaults to resume_task when resumeAsk is true and status is missing", () => {
		const events = rebuildUiMessages([{ role: "user", content: [{ type: "text", text: "Hi" }], ts: 10 }], {
			resumeAsk: true,
		})
		expect(events).toHaveLength(2)
		expect(events[1]).toMatchObject({ type: "ask", ask: "resume_task" })
	})

	it("does not append a resume ask when resumeAsk is not set", () => {
		const events = rebuildUiMessages([{ role: "user", content: [{ type: "text", text: "Hi" }], ts: 10 }])
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({ type: "say", say: "text" })
	})

	it("does not append a resume ask when no events were produced", () => {
		const events = rebuildUiMessages([{ role: "user", content: [{ type: "text", text: "   " }] }], {
			resumeAsk: true,
		})
		expect(events).toHaveLength(0)
	})
})
