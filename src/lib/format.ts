/**
 * Formatting helpers for CLI output.
 */

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
