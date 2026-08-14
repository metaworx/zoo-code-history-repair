/**
 * @file src/lib/__tests__/rebuildUiMessages.spec.ts
 */

import {
	absolutePath,
	apiReqStartedText,
	buildImagePlaceholder,
	buildMcpDescriptor,
	buildNewTaskDescriptor,
	buildReason,
	buildToolResultText,
	buildToolUseDescriptor,
	commandOutputText,
	estimateCumulativeTokensIn,
	estimateTurnTokensOut,
	extractSlashCommand,
	indexTurns,
	isErrorToolReminder,
	isMcpBlock,
	isNewTaskBlock,
	isOutsideWorkspace,
	modeDisplay,
	normalizePath,
	parseInitialTodos,
	rebuildUiMessages,
	simpleId,
	snakeToCamel,
	splitCommandResult,
	stripEnvironmentDetails,
	stripUserMessageWrapper,
	toolNameForDisplay,
} from "../rebuildUiMessages.js"

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

	it("maps tool_use block to ask:tool event with descriptor JSON", () => {
		const events = rebuildUiMessages([
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						name: "read_file",
						id: "toolu_01",
						input: { path: "src/lib/rebuildUiMessages.ts", mode: "slice", offset: 1, limit: 2000 },
					},
				],
				ts: 2000,
			},
		])
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({ type: "ask", ask: "tool", isAnswered: true, autoApprovalDecision: "approve" })
		const descriptor = JSON.parse(events[0].text)
		expect(descriptor).toMatchObject({
			tool: "readFile",
			path: "src/lib/rebuildUiMessages.ts",
			isOutsideWorkspace: false,
			reason: "(up to 2000 lines)",
		})
	})

	it("maps mcp--* tool_use to ask:use_mcp_server envelope", () => {
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
		expect(events[0]).toMatchObject({
			type: "ask",
			ask: "use_mcp_server",
			isAnswered: true,
			autoApprovalDecision: "approve",
		})
		const descriptor = JSON.parse(events[0].text)
		expect(descriptor).toMatchObject({
			type: "use_mcp_tool",
			serverName: "jetbrains",
			toolName: "get_file_problems",
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
		expect(events[2]).toMatchObject({ type: "ask", ask: "tool", ts: 202 })
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

	it("maps new_task tool_use to newTask descriptor", () => {
		const events = rebuildUiMessages(
			[
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							name: "new_task",
							id: "toolu_nt1",
							input: { mode: "code", message: "Implement X", todos: "[ ] Implement X" },
						},
					],
					ts: 100,
				},
			],
			{ childIds: ["child-uuid-1"] },
		)
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({ type: "ask", ask: "tool", isAnswered: true })
		const descriptor = JSON.parse(events[0].text)
		expect(descriptor.tool).toBe("newTask")
		expect(descriptor.mode).toBe("💻 Code")
		expect(descriptor.content).toBe("Implement X")
		expect(descriptor.taskId).toBeUndefined()
		expect(descriptor.todos).toHaveLength(1)
		expect(descriptor.todos[0]).toMatchObject({ content: "Implement X", status: "pending" })
	})

	it("maps multiple new_task tool_uses to newTask descriptors", () => {
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
		expect(JSON.parse(events[0].text)).toMatchObject({ tool: "newTask", content: "A", mode: "💻 Code" })
		expect(JSON.parse(events[1].text)).toMatchObject({ tool: "newTask", content: "B", mode: "🏗️ Architect" })
	})

	it("maps multiple new_task tool_uses regardless of childIds", () => {
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
		expect(JSON.parse(events[0].text)).toMatchObject({ tool: "newTask", content: "A" })
		expect(JSON.parse(events[1].text)).toMatchObject({ tool: "newTask", content: "B" })
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

	it("prepends the extracted slash command to the user message", () => {
		const events = rebuildUiMessages([
			{
				role: "user",
				content: [
					{ type: "text", text: "Command 'EXEC' (see below for command content)\n\nFirst read the spec" },
				],
				ts: 1000,
			},
		])
		expect(events[0]).toMatchObject({ type: "say", say: "text" })
		expect((events[0] as { text?: string }).text).toBe("/EXEC\n\nFirst read the spec")
	})
})

describe("modeDisplay", () => {
	it("maps known slugs to webview labels", () => {
		expect(modeDisplay("ask")).toBe("❓ Ask")
		expect(modeDisplay("code")).toBe("💻 Code")
		expect(modeDisplay("architect")).toBe("🏗️ Architect")
		expect(modeDisplay("debug")).toBe("🪲 Debug")
		expect(modeDisplay("orchestrator")).toBe("🪃 Orchestrator")
	})

	it("falls back to the raw slug for unknown values", () => {
		expect(modeDisplay("unknown")).toBe("unknown")
	})

	it("returns empty string for non-string input", () => {
		expect(modeDisplay(undefined)).toBe("")
		expect(modeDisplay(123)).toBe("")
	})
})

describe("toolNameForDisplay", () => {
	it("maps apply_diff to appliedDiff", () => {
		expect(toolNameForDisplay("apply_diff", {})).toBe("appliedDiff")
	})

	it("distinguishes recursive list_files", () => {
		expect(toolNameForDisplay("list_files", { recursive: true })).toBe("listFiles")
		expect(toolNameForDisplay("list_files", { recursive: false })).toBe("listFilesTopLevel")
		expect(toolNameForDisplay("list_files", {})).toBe("listFilesTopLevel")
	})

	it("maps attempt_completion and new_task", () => {
		expect(toolNameForDisplay("attempt_completion", {})).toBe("finishTask")
		expect(toolNameForDisplay("new_task", {})).toBe("newTask")
	})

	it("falls back to snakeToCamel", () => {
		expect(toolNameForDisplay("read_file", {})).toBe("readFile")
		expect(toolNameForDisplay("execute_command", {})).toBe("executeCommand")
	})
})

describe("buildReason", () => {
	it("reports indentation mode with startLine", () => {
		expect(buildReason({ mode: "indentation", startLine: 42 })).toBe("(indentation mode at line 42)")
	})

	it("reports indentation mode with anchor_line fallback", () => {
		expect(buildReason({ mode: "indentation", anchor_line: 7 })).toBe("(indentation mode at line 7)")
	})

	it("returns undefined for indentation mode without a line", () => {
		expect(buildReason({ mode: "indentation" })).toBeUndefined()
	})

	it("reports slice offset 1 as (up to N lines)", () => {
		expect(buildReason({ offset: 1, limit: 2000 })).toBe("(up to 2000 lines)")
	})

	it("reports slice offset > 1 as a line range", () => {
		expect(buildReason({ offset: 2001, limit: 2000 })).toBe("(lines 2001-4000)")
	})

	it("reports limit-only as (up to N lines)", () => {
		expect(buildReason({ limit: 100 })).toBe("(up to 100 lines)")
	})

	it("returns undefined without offset/limit", () => {
		expect(buildReason({})).toBeUndefined()
	})
})

describe("normalizePath", () => {
	it("converts backslashes to slashes and lowercases", () => {
		expect(normalizePath("C:\\Users\\Mdr\\Foo.Ts")).toBe("c:/users/mdr/foo.ts")
	})

	it("leaves forward-slash paths normalized", () => {
		expect(normalizePath("/Home/User/Proj")).toBe("/home/user/proj")
	})
})

describe("isOutsideWorkspace", () => {
	it("returns false for empty path", () => {
		expect(isOutsideWorkspace("", "C:/proj")).toBe(false)
	})

	it("returns false for relative paths", () => {
		expect(isOutsideWorkspace("src/a.ts", "C:/proj")).toBe(false)
	})

	it("returns true for a windows absolute path without a workspace root", () => {
		expect(isOutsideWorkspace("C:\\proj\\src\\a.ts")).toBe(true)
	})

	it("detects windows paths inside the workspace root", () => {
		expect(isOutsideWorkspace("C:\\proj\\src\\a.ts", "C:\\proj")).toBe(false)
	})

	it("detects windows paths outside the workspace root", () => {
		expect(isOutsideWorkspace("C:\\other\\a.ts", "C:\\proj")).toBe(true)
	})

	it("compares case-insensitively on windows", () => {
		expect(isOutsideWorkspace("C:\\PROJ\\a.ts", "c:\\proj")).toBe(false)
	})

	it("detects linux paths inside the workspace root", () => {
		expect(isOutsideWorkspace("/home/user/proj/src/a.ts", "/home/user/proj")).toBe(false)
	})

	it("detects linux paths outside the workspace root", () => {
		expect(isOutsideWorkspace("/home/user/other/a.ts", "/home/user/proj")).toBe(true)
	})
})

describe("absolutePath", () => {
	it("returns empty string for empty path", () => {
		expect(absolutePath("")).toBe("")
	})

	it("normalizes a windows absolute path to backslashes", () => {
		expect(absolutePath("C:/Users/x/a.ts")).toBe("C:\\Users\\x\\a.ts")
	})

	it("keeps a linux absolute path as-is", () => {
		expect(absolutePath("/home/user/a.ts")).toBe("/home/user/a.ts")
	})

	it("joins a relative path onto the workspace root", () => {
		expect(absolutePath("src/a.ts", "C:/Users/proj")).toBe("C:\\Users\\proj\\src\\a.ts")
	})

	it("returns a relative path as-is without a workspace root", () => {
		expect(absolutePath("src/a.ts")).toBe("src/a.ts")
	})
})

describe("extractSlashCommand", () => {
	it("returns plain text unchanged without a command", () => {
		expect(extractSlashCommand("just text")).toEqual({ text: "just text", prefix: "" })
	})

	it("extracts Command '…' and prepends the slash form", () => {
		const split = extractSlashCommand("Command 'EXEC' (see below for command content)\n\nrest of message")
		expect(split.command).toBe("/EXEC")
		expect(split.prefix).toBe("/EXEC\n\n")
		expect(split.text).toBe("rest of message")
	})

	it("drops an injected <command> spec block", () => {
		expect(extractSlashCommand('<command name="build">content</command>')).toEqual({ prefix: "", text: "" })
	})
})

describe("stripEnvironmentDetails", () => {
	it("removes the environment_details block", () => {
		expect(stripEnvironmentDetails("<environment_details>secret</environment_details>")).toBe("")
		expect(stripEnvironmentDetails("hello<environment_details>x</environment_details>world")).toBe("helloworld")
	})

	it("returns undefined for undefined input", () => {
		expect(stripEnvironmentDetails(undefined)).toBeUndefined()
	})

	it("trims surrounding whitespace", () => {
		expect(stripEnvironmentDetails("  hi  ")).toBe("hi")
	})
})

describe("isErrorToolReminder", () => {
	it("detects the plain reminder", () => {
		expect(isErrorToolReminder("[ERROR] You did not use a tool in your previous response!")).toBe(true)
	})

	it("detects the JSON-enveloped reminder", () => {
		expect(
			isErrorToolReminder(
				'{"role":"user","content":[{"type":"text","text":"[ERROR] You did not use a tool in your previous response!"}]}',
			),
		).toBe(true)
	})

	it("returns false for undefined", () => {
		expect(isErrorToolReminder(undefined)).toBe(false)
	})

	it("returns false for ordinary text", () => {
		expect(isErrorToolReminder("hello")).toBe(false)
	})
})

describe("stripUserMessageWrapper", () => {
	it("removes the wrapper", () => {
		expect(stripUserMessageWrapper("<user_message>Hello</user_message>")).toBe("Hello")
	})

	it("removes surrounding whitespace around the wrapper", () => {
		expect(stripUserMessageWrapper("  <user_message>Hello</user_message>  ")).toBe("Hello")
	})

	it("returns undefined for undefined", () => {
		expect(stripUserMessageWrapper(undefined)).toBeUndefined()
	})

	it("returns unwrapped text unchanged", () => {
		expect(stripUserMessageWrapper("plain")).toBe("plain")
	})
})

describe("isNewTaskBlock", () => {
	it("detects snake_case and camelCase names", () => {
		expect(isNewTaskBlock({ type: "tool_use", name: "new_task" })).toBe(true)
		expect(isNewTaskBlock({ type: "tool_use", name: "newTask" })).toBe(true)
	})

	it("rejects other tools and missing names", () => {
		expect(isNewTaskBlock({ type: "tool_use", name: "read_file" })).toBe(false)
		expect(isNewTaskBlock({ type: "tool_use" })).toBe(false)
	})
})

describe("isMcpBlock", () => {
	it("detects mcp-- prefixed names", () => {
		expect(isMcpBlock({ type: "tool_use", name: "mcp--jetbrains--get_file_problems" })).toBe(true)
	})

	it("rejects non-mcp tools and missing names", () => {
		expect(isMcpBlock({ type: "tool_use", name: "read_file" })).toBe(false)
		expect(isMcpBlock({ type: "tool_use" })).toBe(false)
	})
})

describe("simpleId", () => {
	it("produces a deterministic 40-char id", () => {
		expect(simpleId("a")).toHaveLength(40)
		expect(simpleId("a")).toBe(simpleId("a"))
	})

	it("differs for different content", () => {
		expect(simpleId("a")).not.toBe(simpleId("b"))
	})
})

describe("parseInitialTodos", () => {
	it("parses checkbox lines into pending todos", () => {
		const todos = parseInitialTodos("[ ] First task\n[ ] Second task")
		expect(todos).toEqual([
			{ id: simpleId("First task"), content: "First task", status: "pending" },
			{ id: simpleId("Second task"), content: "Second task", status: "pending" },
		])
	})

	it("parses checked [x] lines as pending content", () => {
		const todos = parseInitialTodos("[x] Done")
		expect(todos).toEqual([{ id: simpleId("Done"), content: "Done", status: "pending" }])
	})

	it("skips empty lines", () => {
		expect(parseInitialTodos("[ ] A\n\n[ ] B")).toHaveLength(2)
	})

	it("returns empty for non-string or blank input", () => {
		expect(parseInitialTodos(undefined)).toEqual([])
		expect(parseInitialTodos(123)).toEqual([])
		expect(parseInitialTodos("   ")).toEqual([])
	})
})

describe("buildNewTaskDescriptor", () => {
	it("builds the newTask descriptor with mode and content", () => {
		const desc = JSON.parse(
			buildNewTaskDescriptor({ type: "tool_use", name: "new_task", input: { mode: "ask", message: "Say hi" } }),
		)
		expect(desc).toMatchObject({ tool: "newTask", mode: "❓ Ask", content: "Say hi" })
		expect(desc.todos).toBeUndefined()
	})

	it("includes parsed todos when present", () => {
		const desc = JSON.parse(
			buildNewTaskDescriptor({
				type: "tool_use",
				name: "new_task",
				input: { mode: "code", message: "m", todos: "[ ] greet" },
			}),
		)
		expect(desc.todos).toEqual([{ id: simpleId("greet"), content: "greet", status: "pending" }])
	})
})

describe("buildMcpDescriptor", () => {
	it("builds the use_mcp_tool envelope", () => {
		const desc = JSON.parse(
			buildMcpDescriptor({
				type: "tool_use",
				name: "mcp--jetbrains--get_file_problems",
				input: { filePath: "x" },
			}),
		)
		expect(desc).toEqual({
			type: "use_mcp_tool",
			serverName: "jetbrains",
			toolName: "get_file_problems",
			arguments: JSON.stringify({ filePath: "x" }),
		})
	})
})

describe("buildToolResultText", () => {
	it("returns string content as-is", () => {
		expect(buildToolResultText({ type: "tool_result", content: "plain" })).toBe("plain")
	})

	it("joins text block items with newlines", () => {
		expect(
			buildToolResultText({
				type: "tool_result",
				content: [
					{ type: "text", text: "a" },
					{ type: "text", text: "b" },
				],
			}),
		).toBe("a\nb")
	})

	it("serializes resource items as JSON", () => {
		const res = { type: "resource", data: "x" }
		expect(buildToolResultText({ type: "tool_result", content: [res] })).toBe(JSON.stringify(res))
	})

	it("returns empty for missing content", () => {
		expect(buildToolResultText({ type: "tool_result" })).toBe("")
	})
})

describe("splitCommandResult", () => {
	it("splits a JSON status envelope with feedback", () => {
		expect(splitCommandResult('{"status":"success","feedback":"fb"}output')).toEqual({
			feedback: "fb",
			output: "output",
		})
	})

	it("returns the whole text as output without an envelope", () => {
		expect(splitCommandResult("plain output")).toEqual({ output: "plain output" })
	})
})

describe("commandOutputText", () => {
	it("strips the command header and output label", () => {
		expect(commandOutputText("Command executed successfully with exit code 0\nOutput:\nactual")).toBe("actual")
	})

	it("leaves plain output unchanged", () => {
		expect(commandOutputText("just output")).toBe("just output")
	})
})

describe("buildImagePlaceholder", () => {
	it("uses the media type from source", () => {
		expect(buildImagePlaceholder({ type: "image", source: { type: "base64", media_type: "image/png" } })).toBe(
			"[Image: image/png]",
		)
	})

	it("falls back to unknown without source", () => {
		expect(buildImagePlaceholder({ type: "image" })).toBe("[Image: unknown]")
	})
})

describe("buildToolUseDescriptor", () => {
	it("builds a read_file descriptor", () => {
		const desc = JSON.parse(
			buildToolUseDescriptor(
				{
					type: "tool_use",
					name: "read_file",
					id: "t1",
					input: { path: "src/a.ts", mode: "slice", offset: 1, limit: 2000 },
				},
				"C:/proj",
				new Map(),
				new Map(),
			),
		)
		expect(desc).toEqual({
			tool: "readFile",
			path: "src/a.ts",
			isOutsideWorkspace: false,
			content: "C:\\proj\\src\\a.ts",
			reason: "(up to 2000 lines)",
		})
	})

	it("maps write_to_file created to newFileCreated", () => {
		const desc = JSON.parse(
			buildToolUseDescriptor(
				{ type: "tool_use", name: "write_to_file", id: "t1", input: { path: "x", content: "hello" } },
				undefined,
				new Map(),
				new Map([["t1", "created"]]),
			),
		)
		expect(desc).toMatchObject({ tool: "newFileCreated", path: "x", content: "hello" })
	})

	it("defaults write_to_file to editedExistingFile", () => {
		const desc = JSON.parse(
			buildToolUseDescriptor(
				{ type: "tool_use", name: "write_to_file", id: "t1", input: { path: "x", content: "hello" } },
				undefined,
				new Map(),
				new Map(),
			),
		)
		expect(desc).toMatchObject({ tool: "editedExistingFile" })
	})

	it("uses the tool result text for list_files content", () => {
		const desc = JSON.parse(
			buildToolUseDescriptor(
				{ type: "tool_use", name: "list_files", id: "t1", input: { recursive: true } },
				undefined,
				new Map([["t1", "listing"]]),
				new Map(),
			),
		)
		expect(desc).toMatchObject({ tool: "listFiles", content: "listing" })
	})

	it("uses input content for generic tools", () => {
		const desc = JSON.parse(
			buildToolUseDescriptor(
				{ type: "tool_use", name: "some_tool", id: "t1", input: { content: "foo" } },
				undefined,
				new Map(),
				new Map(),
			),
		)
		expect(desc).toMatchObject({ tool: "someTool", path: "", isOutsideWorkspace: false, content: "foo" })
	})
})

describe("indexTurns", () => {
	it("indexes names, result texts, and operations", () => {
		const idx = indexTurns([
			{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file" }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "result text" }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "t2", name: "write_to_file" }] },
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t2", content: '{"operation":"created","path":"x"}' }],
			},
		])
		expect(idx.nameById.get("t1")).toBe("read_file")
		expect(idx.resultTextById.get("t1")).toBe("result text")
		expect(idx.operationById.get("t2")).toBe("created")
	})
})

describe("estimateTurnTokensOut", () => {
	it("estimates tokens from text and tool inputs", () => {
		const turn = { role: "assistant", content: [{ type: "text", text: "Hello world" }] }
		expect(estimateTurnTokensOut(turn)).toBe(Math.round("Hello world".length / 3.44))
	})

	it("returns zero for empty turns", () => {
		expect(estimateTurnTokensOut({ role: "assistant", content: [] })).toBe(0)
	})
})

describe("estimateCumulativeTokensIn", () => {
	it("sums prior user turns up to the given turn", () => {
		const t1 = { role: "user", content: [{ type: "text", text: "hello" }] }
		const t2 = { role: "assistant", content: [] }
		const t3 = { role: "user", content: [{ type: "text", text: "world" }] }
		expect(estimateCumulativeTokensIn([t1, t2, t3], t3)).toBe(Math.round("hello".length / 4.0))
		expect(estimateCumulativeTokensIn([t1, t2, t3], t2)).toBe(Math.round("hello".length / 4.0))
	})
})

describe("apiReqStartedText", () => {
	it("derives openai protocol from a DeepSeek config", () => {
		const turn = { role: "assistant", content: [] }
		const payload = JSON.parse(apiReqStartedText([], turn, "DeepSeek"))
		expect(payload.apiProtocol).toBe("openai")
		expect(payload).toMatchObject({ tokensIn: 0, tokensOut: 0, cacheWrites: 0, cost: 0 })
	})
})
