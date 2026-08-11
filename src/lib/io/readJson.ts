// src/lib/readJson.ts
import fs from "node:fs/promises"

export interface PartialArrayResult<T> {
    data: T[]
    truncated: boolean
}

/**
 * Attempt to salvage readable elements from a truncated JSON array.
 *
 * Tries a normal JSON.parse first. On failure, walks backward from the end
 * of the file to find the last valid complete array element, truncates the
 * content at that boundary, appends `]`, and parses the result.
 *
 * Returns null if no elements can be recovered.
 */
export async function readPartialJsonArray<T = unknown>(filePath: string): Promise<PartialArrayResult<T> | null> {
    try {
        await fs.access(filePath)
    } catch {
        return null
    }

    const raw = await fs.readFile(filePath, "utf8")
    if (!raw.trim()) return null

    // Fast path: intact JSON
    try {
        const data = JSON.parse(raw) as T[]
        if (Array.isArray(data)) {
            return {data, truncated: false}
        }
        return null // not an array
    } catch {
        // fall through to partial recovery
    }

    // Find the last valid complete element by progressively truncating.
    // Strategy: work backward from the end, find the last `}` that balances
    // brackets within the array context, then try parsing.
    const trimmed = raw.trimEnd()
    if (!trimmed.startsWith("[")) return null

    // Walk backward through the content looking for valid truncation points.
    // We try at each `}` (closing an object) and `"`/`]`/number endings.
    // For efficiency, we only try at `}` positions (object endings) since
    // ACH elements are always objects.
    let best: T[] | null = null

    for (let i = trimmed.length - 1; i > 0; i--) {
        if (trimmed[i] !== "}") continue

        const candidate = trimmed.slice(0, i + 1) + "]"
        try {
            const data = JSON.parse(candidate) as T[]
            if (Array.isArray(data) && data.length > 0) {
                best = data
                break // first valid from the end = most complete
            }
        } catch {
            // continue searching backward
        }
    }

    if (best && best.length > 0) {
        return {data: best, truncated: true}
    }

    return null
}

