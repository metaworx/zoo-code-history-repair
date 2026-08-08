/**
 * Reconstruct ui_messages.json from api_conversation_history.json.
 *
 * Mapping rules (verified against working reference task 019fd981):
 *
 *   ACH block type       | role      | ui say       | ui text
 *   ---------------------|-----------|--------------|------------------------------------------
 *   text                 | user      | "text"       | block.text
 *   text                 | assistant | "text"       | block.text
 *   reasoning            | assistant | "reasoning"  | block.text
 *   tool_use             | assistant | "tool"       | JSON descriptor {tool, path, ...}
 *   tool_result          | user      | "tool"       | concatenated result content
 *   image                | user/asst | "text"       | "[Image: media/type]" placeholder
 *
 * Timestamps: turn-level ts + monotonic +1ms increments within each turn.
 * Tool names: underscore_case → camelCase.
 * MCP tools (mcp-- prefix) include serverName, toolName, arguments in the descriptor.
 */

export interface UiMessageEvent {
    ts: number
    type: "say"
    say: "text" | "reasoning" | "tool"
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
    content?: Array<{ type: string; text?: string } | string>
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
    return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("")
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

/**
 * Reconstruct the full ui_messages.json event array from an
 * api_conversation_history.json turn array.
 */
export function rebuildUiMessages(apiHistory: AchTurn[]): UiMessageEvent[] {
    const events: UiMessageEvent[] = []
    let counter = 0

    for (const turn of apiHistory) {
        const baseTs = turn.ts ?? 0
        const role = turn.role

        for (const block of turn.content ?? []) {
            const bt = block.type

            if (role === "user") {
                if (bt === "text") {
                    const tc = block.text ?? ""
                    if (!tc.trim()) continue
                    events.push({
                        ts: baseTs + counter,
                        type: "say",
                        say: "text",
                        text: tc,
                        partial: false,
                    })
                    counter++
                } else if (bt === "tool_result") {
                    const rt = buildToolResultText(block)
                    if (!rt) continue
                    events.push({
                        ts: baseTs + counter,
                        type: "say",
                        say: "tool",
                        text: rt,
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
                    const tc = block.text ?? ""
                    if (!tc.trim()) continue
                    events.push({
                        ts: baseTs + counter,
                        type: "say",
                        say: "text",
                        text: tc,
                        partial: false,
                    })
                    counter++
                } else if (bt === "tool_use") {
                    const toolJson = buildToolUseDescriptor(block)
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
