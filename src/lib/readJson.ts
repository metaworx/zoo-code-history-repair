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

export function writeJsonCompact(filePath: string, data: unknown): void {
    const text = JSON.stringify(data) // compact, matches plugin style
    fs.writeFileSync(filePath, text, "utf8")
}

export function backupFile(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null
    const bak = `${filePath}.bak.${Date.now()}`
    fs.copyFileSync(filePath, bak)
    return bak
}