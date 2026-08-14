/**
 * @file src/lib/rebuildUiMessages.ts
 *
 * ui_messages.json reconstruction from api_conversation_history.
 */

/**
 * Reconstruct ui_messages.json from api_conversation_history.json.
 *
 * Mapping rules:
 *
 *   ACH block type       | role      | ui say       | ui text
 *   ---------------------|-----------|--------------|------------------------------------------
 *   text                 | user/asst | "text"       | block.text (env details stripped)
 *   reasoning            | assistant | "reasoning"  | block.text
 *   tool_use             | assistant | "tool"       | JSON descriptor {tool, path, ...}
 *   tool_use (new_task)  | assistant | "tool"       | JSON descriptor {tool:"newTask", mode, content, taskId}
 *   tool_result (error)  | user      | "error"      | concatenated result content
 *   tool_result (ok)     | user      | (skipped)    | —
 *   image                | user/asst | "text"       | "[Image: media/type]" placeholder
 *
 * Timestamps: turn-level ts + monotonic +1ms increments within each turn.
 * Tool names: underscore_case → camelCase.
 * MCP tools (mcp-- prefix) include serverName, toolName, arguments in the descriptor.
 * newTask rows resolve taskId by order-matching parent childIds + delegatedToId.
 */

export interface UiMessageEvent {
	ts: number
	type: "say"
	say: "text" | "reasoning" | "tool" | "error"
	text: string
	partial?: boolean
}

interface AchTurn {
	role: "user" | "assistant"
	content: AchBlock[]
	ts?: number
}

interface AchBlock {
	type: string
	text?: string
	name?: string
	id?: string
	input?: Record<string, unknown>
	tool_use_id?: string
	is_error?: boolean
	content?: string | Array<{ type: string; text?: string } | string>
	source?: { type: string; media_type?: string; data?: string }
}

/**
 * Convert underscore_case to camelCase.
 *   read_file → readFile
 *   execute_command → executeCommand
 *   mcp--jetbrains--get_file_problems → mcp--jetbrains--getFileProblems
 */
export function snakeToCamel(name: string): string {
	const parts = name.split("_")
	return (
		parts[0] +
		parts
			.slice(1)
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join("")
	)
}

function buildToolUseDescriptor(block: AchBlock): string {
	const name = snakeToCamel(block.name ?? "unknown")
	const input = block.input ?? {}
	const isMcp = (block.name ?? "").includes("mcp--")

	const payload: Record<string, unknown> = {
		tool: name,
		path: (input.path ?? input.filePath ?? "") as string,
		isOutsideWorkspace: input.isOutsideWorkspace ?? false,
	}

	if (isMcp) {
		if (input.serverName) payload.serverName = input.serverName
		if (input.toolName) payload.toolName = input.toolName
		if (input.arguments) payload.arguments = input.arguments
		if (input.maxResults != null) payload.maxResults = input.maxResults
		if (input.maxTokens != null) payload.maxTokens = input.maxTokens
	}

	const content = (input.content ?? "") as string
	const reason = (input.reason ?? "") as string
	if (content) payload.content = content
	if (reason) payload.reason = reason

	return JSON.stringify(payload)
}

function buildToolResultText(block: AchBlock): string {
	const parts = block.content ?? []
	if (typeof parts === "string") return parts
	if (!Array.isArray(parts)) return ""
	const texts: string[] = []
	for (const p of parts) {
		if (typeof p === "string") {
			texts.push(p)
		} else if (p && typeof p === "object") {
			if (p.type === "text" && typeof p.text === "string") {
				texts.push(p.text)
			} else if (p.type === "resource") {
				// MCP resource result — serialize as JSON
				texts.push(JSON.stringify(p))
			}
		}
	}
	return texts.join("\n")
}

function buildImagePlaceholder(block: AchBlock): string {
	const source = block.source
	const mediaType = source?.media_type ?? "unknown"
	return `[Image: ${mediaType}]`
}

const ENV_DETAILS_RE = /<environment_details>[\s\S]*?<\/environment_details>/g

/** Remove the injected <environment_details>…</environment_details> block from text. */
function stripEnvironmentDetails(text: string): string {
	return text.replace(ENV_DETAILS_RE, "").trim()
}

function isNewTaskBlock(block: AchBlock): boolean {
	const name = block.name ?? ""
	return name === "new_task" || name === "newTask"
}

function buildNewTaskDescriptor(block: AchBlock, taskId: string | undefined): string {
	const input = block.input ?? {}
	const payload: Record<string, unknown> = {
		tool: "newTask",
		mode: (input.mode ?? "") as string,
		content: (input.message ?? "") as string,
	}
	if (taskId) payload.taskId = taskId
	return JSON.stringify(payload)
}

export interface RebuildUiContext {
	/** Parent task's childIds, used to resolve newTask taskIds by position. */
	childIds?: string[]
	/** Parent task's delegatedToId — the currently-awaiting (last) child. */
	delegatedToId?: string
}

function countNewTaskBlocks(apiHistory: AchTurn[]): number {
	let count = 0
	for (const turn of apiHistory) {
		for (const block of turn.content ?? []) {
			if (block.type === "tool_use" && isNewTaskBlock(block)) count++
		}
	}
	return count
}

function resolveNewTaskId(
	index: number,
	total: number,
	childIds: string[],
	delegatedToId: string | undefined,
): string | undefined {
	if (index < childIds.length) return childIds[index]
	if (index === total - 1 && delegatedToId) return delegatedToId
	return undefined
}

/**
 * Reconstruct the full ui_messages.json event array from an
 * api_conversation_history.json turn array.
 */
export function rebuildUiMessages(apiHistory: AchTurn[], context: RebuildUiContext = {}): UiMessageEvent[] {
	const childIds = context.childIds ?? []
	const delegatedToId = context.delegatedToId
	const newTaskCount = countNewTaskBlocks(apiHistory)

	const events: UiMessageEvent[] = []
	let counter = 0
	let newTaskIndex = 0

	for (const turn of apiHistory) {
		const baseTs = turn.ts ?? 0
		const role = turn.role

		for (const block of turn.content ?? []) {
			const bt = block.type

			if (role === "user") {
				if (bt === "text") {
					const tc = stripEnvironmentDetails(block.text ?? "")
					if (!tc) continue
					events.push({
						ts: baseTs + counter,
						type: "say",
						say: "text",
						text: tc,
						partial: false,
					})
					counter++
				} else if (bt === "tool_result") {
					if (block.is_error) {
						const rt = buildToolResultText(block)
						if (!rt) continue
						events.push({
							ts: baseTs + counter,
							type: "say",
							say: "error",
							text: rt,
						})
						counter++
					}
					// successful tool_result → skipped
				} else if (bt === "image") {
					events.push({
						ts: baseTs + counter,
						type: "say",
						say: "text",
						text: buildImagePlaceholder(block),
						partial: false,
					})
					counter++
				}
			} else if (role === "assistant") {
				if (bt === "reasoning") {
					const tc = block.text ?? ""
					if (!tc) continue
					events.push({
						ts: baseTs + counter,
						type: "say",
						say: "reasoning",
						text: tc,
						partial: false,
					})
					counter++
				} else if (bt === "text") {
					const tc = stripEnvironmentDetails(block.text ?? "")
					if (!tc) continue
					events.push({
						ts: baseTs + counter,
						type: "say",
						say: "text",
						text: tc,
						partial: false,
					})
					counter++
				} else if (bt === "tool_use") {
					const isNewTask = isNewTaskBlock(block)
					const toolJson = isNewTask
						? buildNewTaskDescriptor(
								block,
								resolveNewTaskId(newTaskIndex, newTaskCount, childIds, delegatedToId),
							)
						: buildToolUseDescriptor(block)
					if (isNewTask) newTaskIndex++
					events.push({
						ts: baseTs + counter,
						type: "say",
						say: "tool",
						text: toolJson,
						partial: false,
					})
					counter++
				} else if (bt === "image") {
					events.push({
						ts: baseTs + counter,
						type: "say",
						say: "text",
						text: buildImagePlaceholder(block),
						partial: false,
					})
					counter++
				}
			}
		}
	}

	return events
}
