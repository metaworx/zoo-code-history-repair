import {existsSync, rmSync} from "node:fs"
import path from "node:path"
import {resolveIndexPath, resolveTasksDir} from "../paths.js"
import {backupFile, JsonFileTransaction, writeJsonCompact} from "../file.js";
import {getVersionBanner, resolveRoot} from "../cliContext.js"
import {c, colorize} from "../format.js"

export const name = "delete"
export const summary = "Delete a task directory and its _index entry (default: dry-run, use --force)"

export const description = `${summary}.

Removes the task directory from disk and strips the entry from _index.json.
By default runs in dry-run mode. Use --force to actually delete.`

export const options = [
    ["--force", "Actually delete (default: dry-run)", false],
    ["--no-backup", "Skip creating a timestamped backup of _index.json"],
] as const

const dryRunMsg = colorize("\n!! Dry-run — nothing deleted. Use --force to actually delete. !!", c.red)

export function action(taskId: string, cmdOpts: { force?: boolean; backup?: boolean }): void {
    const root = resolveRoot()
    const tasksDir = resolveTasksDir(root)
    const taskDir = path.join(tasksDir, taskId)

    console.log(getVersionBanner())

    if (!cmdOpts.force) {
        console.log(`Would delete: ${taskDir}`)
        console.log(`Would remove _index entry for: ${taskId}`)
        console.log(dryRunMsg)
        return
    }

    if (existsSync(taskDir)) {
        rmSync(taskDir, {recursive: true, force: true})
        console.log(`Deleted: ${taskDir}`)
    } else {
        console.log(`Directory not found: ${taskDir}`)
    }

    const indexPath = resolveIndexPath(tasksDir)
    const indexTx = new JsonFileTransaction(indexPath, true, [])
    const indexData = indexTx.read() as Array<{ id: string }> | { entries: Array<{ id: string }> } | null
    if (!indexData) {
        console.log("Index not found — nothing to strip")
        return
    }

    if (Array.isArray(indexData)) {
        const filtered = indexData.filter(e => e.id !== taskId)
        if (cmdOpts.backup !== false) backupFile(indexPath)
        writeJsonCompact(indexPath, filtered)
        console.log(`Stripped ${taskId} from _index.json (${indexData.length} → ${filtered.length} entries)`)
    } else if (indexData.entries) {
        const filtered = indexData.entries.filter((e: { id: string }) => e.id !== taskId)
        if (cmdOpts.backup !== false) backupFile(indexPath)
        writeJsonCompact(indexPath, {...indexData, entries: filtered})
        console.log(`Stripped ${taskId} from _index.json (${indexData.entries.length} → ${filtered.length} entries)`)
    }
}
