/**
 * @file src/lib/estimateTokens.ts
 *
 * Token estimation from api_conversation_history.json content.
 *
 * Since ACH files do not contain Anthropic `usage` metadata, token counts
 * must be estimated from text content. Output estimation (3.44 chars/token)
 * is reasonably accurate (±6%). Input estimation (4.0 chars/token) is a
 * deliberate under-estimate — the system prompt, tool definitions, and
 * context window content are NOT in ACH but ARE counted in tokensIn.
 */

interface AchBlock {
	type: string
	text?: string
	name?: string
	input?: Record<string, unknown>
	content?: Array<{ type: string; text?: string } | string>
}

interface AchTurn {
	role: "user" | "assistant"
	content: AchBlock[]
}

/** Pricing per 1M tokens. Keys are lowercase. Unknown providers return input=0, output=0. */
const PRICING: Record<string, { input: number; output: number }> = {
	deepseek: { input: 0.14, output: 0.28 },
	default: { input: 0.14, output: 0.28 },
}

const OUTPUT_CHARS_PER_TOKEN = 3.44
const INPUT_CHARS_PER_TOKEN = 4.0
const CACHE_READS_RATIO = 0.97

/**
 * Estimate tokensOut from assistant text + reasoning content in ACH.
 * Uses 3.44 chars/token (empirically measured, ±6% error).
 * Returns 0 if no assistant content.
 */
export function estimateTokensOut(apiHistory: AchTurn[]): number {
	let chars = 0

	for (const turn of apiHistory) {
		if (turn.role !== "assistant") continue
		for (const block of turn.content) {
			if (block.type === "text" || block.type === "reasoning") {
				chars += block.text?.length ?? 0
			} else if (block.type === "tool_use" && block.input) {
				// Tool use input JSON counts as output (assistant generates it)
				chars += JSON.stringify(block.input).length
			}
		}
	}

	return chars > 0 ? Math.round(chars / OUTPUT_CHARS_PER_TOKEN) : 0
}

/**
 * Estimate tokensIn from user text content in ACH.
 * Uses 4.0 chars/token — this is the UNDER-ESTIMATE because system
 * prompt, tool definitions, and context window are NOT in ACH.
 * Returns 0 if no user text content.
 */
export function estimateTokensIn(apiHistory: AchTurn[]): number {
	let chars = 0

	for (const turn of apiHistory) {
		if (turn.role !== "user") continue
		for (const block of turn.content) {
			if (block.type === "text") {
				chars += block.text?.length ?? 0
			} else if (block.type === "tool_result" && block.content) {
				for (const part of block.content) {
					if (typeof part === "string") {
						chars += part.length
					} else if (part && typeof part === "object" && part.type === "text") {
						chars += part.text?.length ?? 0
					}
				}
			}
		}
	}

	return chars > 0 ? Math.round(chars / INPUT_CHARS_PER_TOKEN) : 0
}

/**
 * Estimate totalCost from tokensIn and tokensOut using provider pricing.
 * Returns 0 for unknown providers.
 * Cost = (tokensIn / 1_000_000) * inputPrice + (tokensOut / 1_000_000) * outputPrice
 */
export function estimateTotalCost(tokensIn: number, tokensOut: number, provider?: string): number {
	const key = (provider ?? "").toLowerCase()
	const pricing = PRICING[key]
	if (!pricing) return 0

	const inputCost = (tokensIn / 1_000_000) * pricing.input
	const outputCost = (tokensOut / 1_000_000) * pricing.output
	return Math.round((inputCost + outputCost) * 1e12) / 1e12
}

/**
 * Estimate cacheReads from tokensIn.
 * For DeepSeek/default: ≈ 0.97 × tokensIn.
 * For unknown providers: returns 0 (prompt caching not supported).
 */
export function estimateCacheReads(tokensIn: number, provider?: string): number {
	const key = (provider ?? "").toLowerCase()
	// Unknown providers don't support prompt caching
	if (!PRICING[key]) {
		return 0
	}
	return Math.round(tokensIn * CACHE_READS_RATIO)
}
