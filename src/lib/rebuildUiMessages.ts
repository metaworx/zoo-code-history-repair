/**
 * @file src/lib/rebuildUiMessages.ts
 *
 * Faithful ui_messages.json reconstruction from api_conversation_history.json.
 *
 * Mapping rules (authoritative reference: .aiassistant/messages/
 * 2026-08-15_00-42_AP_UimRebuild_v1.2_appendix_ground_truth_examples.md):
 *
 *   ACH block type          | role      | ui event(s)
 *   ------------------------|-----------|-------------------------------------------
 *   text (user, first turn) | user      | say:"text"  (slash-command re-extracted)
 *   text (command spec)     | user/asst | (dropped)
 *   text (env details)      | user/asst | (dropped)
 *   text ([ERROR] reminder) | user      | (dropped)
 *   text                    | assistant | say:"text"
 *   reasoning               | assistant | say:"reasoning"
 *   tool_use (normal)       | assistant | ask:"tool"   {tool, path, isOutsideWorkspace, content, reason}
 *   tool_use execute_command| assistant | ask:"command"
 *   tool_use mcp--*         | assistant | ask:"use_mcp_server"
 *   tool_use new_task       | assistant | ask:"tool"   {tool:"newTask", mode, content, todos}
 *   tool_use attempt_comp.  | assistant | say:"completion_result" + ask:"tool" {tool:"finishTask"}
 *   tool_result (error)     | user      | say:"error"
 *   tool_result (command)   | user      | say:"command_output" (+ say:"user_feedback")
 *   tool_result (new_task)  | user      | say:"subtask_result"
 *   tool_result (mcp)       | user      | say:"mcp_server_request_started" + say:"mcp_server_response"
 *   tool_result (other ok)  | user      | (dropped)
 *
 * Timestamps: turn-level ts + monotonic +1ms increments (approximation — real
 * ts values are independent Date.now() stamps and are not reconstructible).
 */

import { MIN_PLAUSIBLE_EPOCH_MS } from "./constants.js"

export interface UiSayEvent {
	ts: number
	type: "say"
	say: string
	text?: string
	partial?: boolean
	images?: string[]
}

export interface UiAskEvent {
	ts: number
	type: "ask"
	ask: string
	text?: string
	partial?: boolean
	isProtected?: boolean
	isAnswered?: boolean
	autoApprovalDecision?: string
	images?: string[]
}

export type UiMessageEvent = UiSayEvent | UiAskEvent

export interface AchTurn {
	role: string
	content: AchBlock[]
	ts?: number
}

export interface AchBlock {
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

/** Mode slug → webview display name. */
const MODE_DISPLAY: Record<string, string> = {
	ask: "❓ Ask",
	code: "💻 Code",
	architect: "🏗️ Architect",
	debug: "🪲 Debug",
	orchestrator: "🪃 Orchestrator",
}

export function modeDisplay(slug: unknown): string {
	const key = typeof slug === "string" ? slug : ""
	return MODE_DISPLAY[key] ?? key
}

/** Tool name → webview display name (special cases beyond snakeToCamel). */
export function toolNameForDisplay(name: string, input: Record<string, unknown>): string {
	switch (name) {
		case "apply_diff":
			return "appliedDiff"
		case "list_files":
			return input.recursive === true ? "listFiles" : "listFilesTopLevel"
		case "attempt_completion":
			return "finishTask"
		case "new_task":
			return "newTask"
		default:
			return snakeToCamel(name)
	}
}

/** Build the `reason` string for read-style tools from slice/indentation inputs. */
export function buildReason(input: Record<string, unknown>): string | undefined {
	if (input.mode === "indentation") {
		const startLine = input.startLine ?? input.anchor_line
		if (typeof startLine === "number") return `(indentation mode at line ${startLine})`
		return undefined
	}
	const offset = input.offset
	const limit = input.limit
	if (typeof offset === "number" && typeof limit === "number") {
		if (offset === 1) return `(up to ${limit} lines)`
		return `(lines ${offset}-${offset + limit - 1})`
	}
	if (typeof limit === "number") return `(up to ${limit} lines)`
	return undefined
}

/** Normalize a path for comparison (backslashes → slashes, lowercased). */
export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").toLowerCase()
}

/** True when `pathStr` resolves outside `workspaceRoot`. */
export function isOutsideWorkspace(pathStr: string, workspaceRoot?: string): boolean {
	if (!pathStr) return false
	const isAbsolute = /^[A-Za-z]:[\\/]/.test(pathStr) || pathStr.startsWith("/")
	if (!isAbsolute) return false
	if (!workspaceRoot) return true
	return !normalizePath(pathStr).startsWith(normalizePath(workspaceRoot))
}

/** Resolve a tool path to an absolute path using the workspace root (best effort). */
export function absolutePath(pathStr: string, workspaceRoot?: string): string {
	if (!pathStr) return ""
	if (/^[A-Za-z]:[\\/]/.test(pathStr)) return pathStr.replace(/\//g, "\\")
	if (pathStr.startsWith("/")) return pathStr
	if (!workspaceRoot) return pathStr
	return (workspaceRoot.replace(/\//g, "\\") + "\\" + pathStr).replace(/[\\/]+/g, "\\")
}

/**
 * In a single pass, either strip an injected command-spec block or extract an
 * injected slash command and rewrite it as the literal `/cmd`. `prefix + text`
 * yields the emitted text (empty when a command spec was dropped).
 */
export function extractSlashCommand(raw: string): { command?: string; prefix: string; text: string } {
	const m = /^(?:Command '([^']+)' \(see below for command content\)(\n+)|<command\s[\s\S]*?<\/command>\s*)/.exec(raw)
	if (!m) return { text: raw, prefix: "" }
	if (m[1] !== undefined) {
		const command = "/" + m[1]
		return { command, prefix: command + m[2], text: raw.slice(m[0].length) }
	}
	return { prefix: "", text: "" }
}

const ENV_DETAILS_RE = /<environment_details>[\s\S]*?<\/environment_details>/g

/** Remove the injected <environment_details>…</environment_details> block from text. */
export function stripEnvironmentDetails(text: string | undefined): string | undefined {
	if (text === undefined) return undefined
	return text.replace(ENV_DETAILS_RE, "").trim()
}

const ERROR_TOOL_REMINDER_MARKER = "[ERROR] You did not use a tool in your previous response!"
const ERROR_TOOL_REMINDER_JSON_PREFIX = '{"role":"user","content":[{"type":"text","text":"' + ERROR_TOOL_REMINDER_MARKER

/** True when the raw user text is the injected "[ERROR] You did not use a tool…" reminder. */
export function isErrorToolReminder(text: string | undefined): boolean {
	if (text === undefined) return false
	return text.startsWith(ERROR_TOOL_REMINDER_MARKER) || text.startsWith(ERROR_TOOL_REMINDER_JSON_PREFIX)
}

const USER_MESSAGE_OPEN_RE = /^\s*<user_message>\s*/
const USER_MESSAGE_CLOSE_RE = /\s*<\/user_message>\s*$/

/** Remove the leading `<user_message>` and trailing `</user_message>` wrapper (plus surrounding whitespace). */
export function stripUserMessageWrapper(text: string | undefined): string | undefined {
	if (text === undefined) return undefined
	return text.replace(USER_MESSAGE_OPEN_RE, "").replace(USER_MESSAGE_CLOSE_RE, "")
}

export function isNewTaskBlock(block: AchBlock): boolean {
	const name = block.name ?? ""
	return name === "new_task" || name === "newTask"
}

export function isMcpBlock(block: AchBlock): boolean {
	return (block.name ?? "").includes("mcp--")
}

/** Parse the initial todos string (`[ ] A\n[ ] B`) into the UIM todo objects. */
export function parseInitialTodos(raw: unknown): Array<{ id: string; content: string; status: string }> {
	if (typeof raw !== "string" || !raw.trim()) return []
	const todos: Array<{ id: string; content: string; status: string }> = []
	for (const line of raw.split("\n")) {
		const content = line.replace(/^\s*\[[ x]\]\s*/, "").trim()
		if (!content) continue
		todos.push({ id: simpleId(content), content, status: "pending" })
	}
	return todos
}

/** Deterministic pseudo-id for a todo line (ground-truth ids are generated, not recoverable). */
export function simpleId(content: string): string {
	let h = 0
	for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) >>> 0
	return h.toString(16).padStart(8, "0") + "00000000000000000000000000000000"
}

export function buildNewTaskDescriptor(block: AchBlock): string {
	const input = block.input ?? {}
	const payload: Record<string, unknown> = {
		tool: "newTask",
		mode: modeDisplay(input.mode),
		content: (input.message ?? "") as string,
	}
	const todos = parseInitialTodos(input.todos)
	if (todos.length > 0) payload.todos = todos
	return JSON.stringify(payload)
}

/** Build the `ask:"tool"` descriptor JSON for an ordinary tool_use. */
export function buildToolUseDescriptor(
	block: AchBlock,
	workspaceRoot: string | undefined,
	resultTextById: Map<string, string>,
	operationById: Map<string, string>,
): string {
	const name = block.name ?? ""
	const input = block.input ?? {}
	const pathStr = (input.path ?? input.filePath ?? "") as string

	const payload: Record<string, unknown> = {
		tool: toolNameForDisplay(name, input),
		path: pathStr,
		isOutsideWorkspace: isOutsideWorkspace(pathStr, workspaceRoot),
	}

	if (name === "write_to_file") {
		const operation = operationById.get(block.id ?? "")
		payload.tool = operation === "created" ? "newFileCreated" : "editedExistingFile"
		if (input.content) payload.content = input.content
	} else if (name === "read_file") {
		payload.content = absolutePath(pathStr, workspaceRoot)
		const reason = buildReason(input)
		if (reason) payload.reason = reason
		if (input.startLine != null) payload.startLine = input.startLine
	} else if (name === "list_files" || name === "search_files") {
		const resultText = resultTextById.get(block.id ?? "")
		if (resultText) payload.content = resultText
	} else {
		const resultText = resultTextById.get(block.id ?? "")
		if (input.content) payload.content = input.content
		else if (resultText) payload.content = resultText
		const reason = buildReason(input)
		if (reason) payload.reason = reason
		if (input.startLine != null) payload.startLine = input.startLine
	}

	return JSON.stringify(payload)
}

/** Build the `ask:"use_mcp_server"` descriptor JSON for an mcp--* tool_use. */
export function buildMcpDescriptor(block: AchBlock): string {
	const name = block.name ?? ""
	const input = block.input ?? {}
	const [, serverName = "", toolName = ""] = name.split("--")
	const envelope: Record<string, unknown> = {
		type: "use_mcp_tool",
		serverName,
		toolName,
		arguments: JSON.stringify(input),
	}
	return JSON.stringify(envelope)
}

/** Concatenate a tool_result content into a single string. */
export function buildToolResultText(block: AchBlock): string {
	const parts = block.content ?? []
	if (typeof parts === "string") return parts
	if (!Array.isArray(parts)) return ""
	const texts: string[] = []
	for (const p of parts) {
		if (typeof p === "string") {
			texts.push(p)
		} else if (p && typeof p === "object") {
			if (p.type === "text" && typeof p.text === "string") texts.push(p.text)
			else if (p.type === "resource") texts.push(JSON.stringify(p))
		}
	}
	return texts.join("\n")
}

/** Split a command tool_result into its optional feedback and the command output. */
export function splitCommandResult(text: string): { feedback?: string; output: string } {
	const envelope = /^\s*\{(?:[^{}]|"[^"]*")*\}(?:\s|\n)*/s.exec(text)
	if (envelope) {
		let feedback: string | undefined
		const fm = /"feedback"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(envelope[0])
		if (fm) feedback = fm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
		return { feedback, output: text.slice(envelope[0].length) }
	}
	return { output: text }
}

/** Strip the `Command executed … Exit code: N` header and `Output:` label from a command result. */
export function commandOutputText(text: string): string {
	let out = text
	out = out.replace(/^Command executed[^\n]*\n/, "")
	out = out.replace(/^Output:\s*\n/, "")
	return out
}

export function buildImagePlaceholder(block: AchBlock): string {
	const source = block.source
	const mediaType = source?.media_type ?? "unknown"
	return `[Image: ${mediaType}]`
}

export interface RebuildUiContext {
	/** Parent task's childIds (kept for compatibility). */
	childIds?: string[]
	/** Parent task's delegatedToId — the currently-awaiting (last) child. */
	delegatedToId?: string
	/** Task status from history_item.json — drives the trailing resume ask type. */
	status?: string
	/** When true (repair pipeline), append the trailing resume ask. */
	resumeAsk?: boolean
	/** Workspace root from history_item.json — used to compute isOutsideWorkspace/absolute paths. */
	workspaceRoot?: string
	/** API config name (e.g. "DeepSeek") — used to derive apiProtocol for telemetry. */
	apiConfigName?: string
	/** When true, synthesize gated telemetry (api_req_started) via the token estimator. */
	includeTelemetry?: boolean
}

/** Pre-pass: index tool_use id → name, tool_result id → operation, and tool_result text. */
export function indexTurns(apiHistory: AchTurn[]): {
	nameById: Map<string, string>
	operationById: Map<string, string>
	resultTextById: Map<string, string>
} {
	const nameById = new Map<string, string>()
	const operationById = new Map<string, string>()
	const resultTextById = new Map<string, string>()
	for (const turn of apiHistory) {
		for (const block of turn.content ?? []) {
			if (block.type === "tool_use" && block.id) {
				nameById.set(block.id, block.name ?? "")
			}
			if (block.type === "tool_result" && block.tool_use_id) {
				const text = buildToolResultText(block)
				resultTextById.set(block.tool_use_id, text)
				const op = /"operation"\s*:\s*"(created|modified|updated)"/.exec(text)
				if (op) operationById.set(block.tool_use_id, op[1])
			}
		}
	}
	return { nameById, operationById, resultTextById }
}

/** Estimate telemetry payload for an api_req_started event (gated). */
export function apiReqStartedText(apiHistory: AchTurn[], turn: AchTurn, apiConfigName: string | undefined): string {
	const tokensOut = estimateTurnTokensOut(turn)
	const tokensIn = estimateCumulativeTokensIn(apiHistory, turn)
	const provider = (apiConfigName ?? "").toLowerCase()
	const apiProtocol = provider === "deepseek" || provider === "openai" ? "openai" : provider || "openai"
	const cost =
		tokensIn > 0 || tokensOut > 0 ? Math.round(((tokensIn * 0.14 + tokensOut * 0.28) / 1_000_000) * 1e12) / 1e12 : 0
	const cacheReads = Math.round(tokensIn * 0.97)
	return JSON.stringify({
		apiProtocol,
		tokensIn,
		tokensOut,
		cacheWrites: 0,
		cacheReads,
		cost,
	})
}

export function estimateTurnTokensOut(turn: AchTurn): number {
	let chars = 0
	for (const block of turn.content ?? []) {
		if (block.type === "text" || block.type === "reasoning") chars += block.text?.length ?? 0
		else if (block.type === "tool_use" && block.input) chars += JSON.stringify(block.input).length
	}
	return chars > 0 ? Math.round(chars / 3.44) : 0
}

export function estimateCumulativeTokensIn(apiHistory: AchTurn[], upto: AchTurn): number {
	let chars = 0
	for (const turn of apiHistory) {
		if (turn === upto) break
		if (turn.role !== "user") continue
		for (const block of turn.content ?? []) {
			if (block.type === "text") chars += block.text?.length ?? 0
			else if (block.type === "tool_result") chars += buildToolResultText(block).length
		}
	}
	return chars > 0 ? Math.round(chars / 4.0) : 0
}

/**
 * Reconstruct the full ui_messages.json event array from an
 * api_conversation_history.json turn array.
 */
export function rebuildUiMessages(apiHistory: AchTurn[], context: RebuildUiContext = {}): UiMessageEvent[] {
	const workspaceRoot = context.workspaceRoot
	const { nameById, operationById, resultTextById } = indexTurns(apiHistory)

	const events: UiMessageEvent[] = []
	let counter = 0
	let lastValidTs = 0

	for (const turn of apiHistory) {
		const turnTs = typeof turn.ts === "number" && turn.ts >= MIN_PLAUSIBLE_EPOCH_MS ? turn.ts : 0
		const baseTs = turnTs || lastValidTs || Date.now()
		if (turnTs > 0) lastValidTs = turnTs
		const role = turn.role

		if (context.includeTelemetry === true && role === "assistant") {
			events.push({
				ts: baseTs + counter,
				type: "say",
				say: "api_req_started",
				text: apiReqStartedText(apiHistory, turn, context.apiConfigName),
			})
			counter++
		}

		for (const block of turn.content ?? []) {
			const bt = block.type

			if (role === "user") {
				if (bt === "text") {
					if (isErrorToolReminder(block.text)) continue
					const raw = stripUserMessageWrapper(block.text)
					if (!raw) continue
					const split = extractSlashCommand(raw)
					const tc = stripEnvironmentDetails(split.text)
					if (!tc) continue
					events.push({
						ts: baseTs + counter,
						type: "say",
						say: "text",
						text: split.prefix + tc,
						partial: false,
					})
					counter++
				} else if (bt === "tool_result") {
					if (block.is_error) {
						const rt = stripUserMessageWrapper(buildToolResultText(block))
						if (!rt) continue
						events.push({ ts: baseTs + counter, type: "say", say: "error", text: rt })
						counter++
						continue
					}
					const toolName = nameById.get(block.tool_use_id ?? "")
					if (toolName === "new_task" || toolName === "newTask") {
						const text = buildToolResultText(block)
						const result = text.replace(/^Subtask\s+\S+\s+completed\.\s*\n+\s*Result:\s*\n*/s, "")
						if (result) {
							events.push({ ts: baseTs + counter, type: "say", say: "subtask_result", text: result })
							counter++
						}
					} else if (toolName === "execute_command") {
						const text = buildToolResultText(block)
						const { feedback, output } = splitCommandResult(text)
						if (feedback) {
							events.push({
								ts: baseTs + counter,
								type: "say",
								say: "user_feedback",
								text: feedback,
								images: [],
							})
							counter++
						}
						const out = commandOutputText(output)
						if (out) {
							events.push({
								ts: baseTs + counter,
								type: "say",
								say: "command_output",
								text: out,
								partial: false,
							})
							counter++
						}
					} else if (toolName && toolName.includes("mcp--")) {
						const text = buildToolResultText(block)
						events.push({ ts: baseTs + counter, type: "say", say: "mcp_server_request_started" })
						counter++
						if (text) {
							events.push({ ts: baseTs + counter, type: "say", say: "mcp_server_response", text })
							counter++
						}
					}
					// other successful tool_result → dropped
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
					const tc = stripUserMessageWrapper(block.text)
					if (!tc) continue
					events.push({ ts: baseTs + counter, type: "say", say: "reasoning", text: tc, partial: false })
					counter++
				} else if (bt === "text") {
					const raw = stripUserMessageWrapper(block.text)
					if (!raw) continue
					const split = extractSlashCommand(raw)
					const tc = stripEnvironmentDetails(split.text)
					if (!tc) continue
					events.push({
						ts: baseTs + counter,
						type: "say",
						say: "text",
						text: split.prefix + tc,
						partial: false,
					})
					counter++
				} else if (bt === "tool_use") {
					const name = block.name ?? ""
					if (isNewTaskBlock(block)) {
						events.push({
							ts: baseTs + counter,
							type: "ask",
							ask: "tool",
							text: buildNewTaskDescriptor(block),
							partial: false,
							isProtected: false,
							isAnswered: true,
						})
						counter++
					} else if (name === "execute_command") {
						const input = block.input ?? {}
						events.push({
							ts: baseTs + counter,
							type: "ask",
							ask: "command",
							text: (input.command ?? "") as string,
							partial: false,
							isProtected: false,
						})
						counter++
					} else if (isMcpBlock(block)) {
						events.push({
							ts: baseTs + counter,
							type: "ask",
							ask: "use_mcp_server",
							text: buildMcpDescriptor(block),
							isProtected: false,
							isAnswered: true,
							autoApprovalDecision: "approve",
						})
						counter++
					} else if (name === "attempt_completion") {
						const result = ((block.input ?? {}).result ?? "") as string
						if (result) {
							events.push({ ts: baseTs + counter, type: "say", say: "completion_result", text: result })
							counter++
						}
						events.push({
							ts: baseTs + counter,
							type: "ask",
							ask: "tool",
							text: JSON.stringify({ tool: "finishTask" }),
							isAnswered: true,
							autoApprovalDecision: "approve",
						})
						counter++
					} else {
						events.push({
							ts: baseTs + counter,
							type: "ask",
							ask: "tool",
							text: buildToolUseDescriptor(block, workspaceRoot, resultTextById, operationById),
							partial: false,
							isAnswered: true,
							autoApprovalDecision: "approve",
						})
						counter++
					}
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

	// Resume ask — mirrors Zoo-Code Task#resumeTaskFromHistory.
	if (context.resumeAsk === true && events.length > 0) {
		const ask: string = context.status === "completed" ? "resume_completed_task" : "resume_task"
		events.push({ ts: events[events.length - 1].ts + 1, type: "ask", ask })
	}

	return events
}
