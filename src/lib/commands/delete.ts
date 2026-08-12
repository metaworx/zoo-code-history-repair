import {existsSync, rmSync} from "node:fs"
import path from "node:path"
import {DEFAULT_INDEX_NAME, resolveTasksDir} from "../paths.js"
import {IndexTransaction} from "../IndexTransaction.js"
import {getVersionBanner, resolveRoot} from "../cliContext.js"
import {c, colorize} from "../format.js"

export const name = "delete"
export const summary = "Delete a task directory and its _index entry (default: dry-run, use --force)"

export const description = `${summary}.

Removes the task directory from disk and strips the entry from _index.json.
By default runs in dry-run mode. Use --force to actually delete.`

export const options = [
    ["--force", "Actually delete (default: dry-run)", false],
    ["--no-backup", `Skip creating a timestamped backup of ${DEFAULT_INDEX_NAME}`],
] as const

const dryRunMsg = colorize("\n!! Dry-run — nothing deleted. Use --force to actually delete. !!", c.red)

export async function action(taskId: string, cmdOpts: { force?: boolean; backup?: boolean }): Promise<void> {
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

    const idx = new IndexTransaction(false)
    const entries = await idx.getEntries()
    const before = entries.length
    const removed = await idx.removeById(taskId, false)
    if (removed) {
        idx.setData(entries, false)
        await idx.save(false, cmdOpts.backup !== false)
    }
    console.log(`Stripped ${taskId} from ${DEFAULT_INDEX_NAME} (${before} → ${entries.length} entries)`)
}
