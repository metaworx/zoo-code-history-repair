/**
 * @file src/lib/format.ts
 *
 * Formatting helpers for CLI output.
 */

import { getColorEnabled } from "./cliContext.js"

export const c = {
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	dim: "\x1b[2m",
	reset: "\x1b[0m",
} as const

/** Wrap text in ANSI codes. No-op when color is disabled (--no-color, NO_COLOR, or pipe). */
export function colorize(text: string, code: string): string {
	if (!getColorEnabled()) return text
	return code + text + c.reset
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 * Returns empty string for null/undefined input.
 */
export function truncate(str: string | undefined | null, maxLen: number): string {
	if (str == null) return ""
	if (str.length <= maxLen) return str
	return str.slice(0, maxLen) + "..."
}

/**
 * Compare index.task and disk.task for the task.match output field.
 * Returns "YES" if both are non-empty (after trim) and case-sensitively equal.
 * Returns "NO" if both are non-empty but differ.
 * Returns null if either is nullish or empty after trim (skip the output line).
 */
export function taskMatch(
	indexTask: string | undefined | null,
	diskTask: string | undefined | null,
): "YES" | "NO" | null {
	const a = (indexTask ?? "").trim()
	const b = (diskTask ?? "").trim()
	if (!a || !b) return null
	return a === b ? "YES" : "NO"
}
