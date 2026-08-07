// src/lib/paths.ts
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export const DEFAULT_INDEX_NAME = "_index.json"
export const HISTORY_ITEM_NAME = "history_item.json"
export const UI_MESSAGES_NAME = "ui_messages.json"
export const API_HISTORY_NAME = "api_conversation_history.json"
export const TASK_METADATA_NAME = "task_metadata.json"

/** Heuristic discovery of Zoo/Roo storage roots */
export function guessStorageRoots(): string[] {
    const home = os.homedir()
    const candidates = [
        path.join(home, ".zoo-code", "globalStorage", "wecode-ai.zoo-code"),
        path.join(home, ".roo"),
        // VS Code style (adjust publisher ids as needed)
        path.join(home, ".vscode", "extensions"), // not storage, just placeholder
    ]

    // Windows JetBrains / VS Code globalStorage patterns can be added here
    if (process.platform === "win32") {
        const appdata = process.env.APPDATA
        const local = process.env.LOCALAPPDATA
        if (appdata) {
            candidates.push(
                path.join(home, ".zoo-code", "globalStorage", "wecode-ai.zoo-code"),
            )
        }
    }

    return candidates.filter((p) => fs.existsSync(p))
}

export function resolveTasksDir(storageRoot: string): string {
    const direct = path.join(storageRoot, "tasks")
    if (fs.existsSync(direct)) return direct
    return storageRoot
}

export function resolveIndexPath(tasksDir: string): string {
    return path.join(tasksDir, DEFAULT_INDEX_NAME)
}

export function listTaskDirs(tasksDir: string): string[] {
    if (!fs.existsSync(tasksDir)) return []
    return fs
        .readdirSync(tasksDir, {withFileTypes: true})
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => path.join(tasksDir, d.name))
}