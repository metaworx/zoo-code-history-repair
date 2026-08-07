/**
 * Extract the `task` field (original user prompt) from the first user turn
 * in an api_conversation_history.json array.
 *
 * The task text is the content inside <user_message>...</user_message> tags
 * in the first text block of the first user turn.
 */

const USER_MESSAGE_RE = /<user_message>(.*?)<\/user_message>/s

/**
 * Extract the task description from an api_conversation_history.json payload.
 * Returns null if the conversation history is missing or malformed.
 */
export function extractTaskFromApiHistory(apiHistory: unknown[]): string | null {
    if (!Array.isArray(apiHistory)) return null

    for (const turn of apiHistory) {
        if (!turn || typeof turn !== "object") continue
        const t = turn as Record<string, unknown>
        if (t.role !== "user") continue

        const content = t.content
        if (!Array.isArray(content)) continue

        for (const block of content) {
            if (!block || typeof block !== "object") continue
            const b = block as Record<string, unknown>
            if (b.type !== "text") continue

            const text = typeof b.text === "string" ? b.text : ""
            const m = USER_MESSAGE_RE.exec(text)
            if (m) return m[1].trim()
        }
    }

    return null
}
