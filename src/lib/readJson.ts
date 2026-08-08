// src/lib/readJson.ts
import fs from "node:fs"

export function readJsonFile<T = unknown>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) return null
        const raw = fs.readFileSync(filePath, "utf8")
        if (!raw.trim()) return null
        return JSON.parse(raw) as T
    } catch {
        return null
    }
}

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
export function readPartialJsonArray<T = unknown>(filePath: string): PartialArrayResult<T> | null {
    if (!fs.existsSync(filePath)) return null

    const raw = fs.readFileSync(filePath, "utf8")
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

export function writeJsonCompact(filePath: string, data: unknown): void {
    const text = JSON.stringify(data) // compact, matches plugin style
    fs.writeFileSync(filePath, text, "utf8")
}

function formatTimestamp(): string {
    const d = new Date()
    const Y = String(d.getFullYear())
    const M = String(d.getMonth() + 1).padStart(2, "0")
    const D = String(d.getDate()).padStart(2, "0")
    const h = String(d.getHours()).padStart(2, "0")
    const m = String(d.getMinutes()).padStart(2, "0")
    const s = String(d.getSeconds()).padStart(2, "0")
    return `${Y}${M}${D}-${h}${m}${s}`
}

export function backupFile(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null
    const bak = `${filePath}.${formatTimestamp()}.bak.json`
    fs.copyFileSync(filePath, bak)
    return bak
}