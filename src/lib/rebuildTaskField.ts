/**
 * @file src/lib/rebuildTaskField.ts
 *
 * Task-field extraction from api_conversation_history.
 */

/**
 * Extract the `task` field (original user prompt) from the first user turn
 * in an api_conversation_history.json array.
 *
 * The task text is the content inside <user_message>...</user_message> tags
 * in the text blocks of the first user turn. If the tag spans multiple text
 * blocks (partial streaming), all text blocks in the turn are concatenated
 * before matching.
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

		// Concatenate all text blocks in the first user turn, then match.
		// This handles cases where <user_message> spans multiple blocks.
		const allText = content
			.filter(
				(block): block is Record<string, unknown> =>
					block != null && typeof block === "object" && (block as Record<string, unknown>).type === "text",
			)
			.map((b) => (typeof b.text === "string" ? b.text : ""))
			.join("")

		const m = USER_MESSAGE_RE.exec(allText)
		if (m) return m[1].trim()

		// Only check the first user turn
		break
	}

	return null
}
