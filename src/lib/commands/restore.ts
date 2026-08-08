import path from "node:path"
import {resolveTasksDir} from "../paths.js"
import {resolveRoot} from "../cliContext.js"
import {deleteBackups, listBackups, restoreFromBackups} from "../restore.js"
import type {BackupEntry} from "../restore.js"

export const name = "restore"
export const summary = "List, restore, or delete task backup files"

export const description = `${summary}.

Without arguments, lists all task directories that have .bak.json backup files.
With a task ID, restores the newest backup for that task.
With a task ID and timestamp, restores that specific backup.
With only a timestamp, restores all tasks matching that timestamp.
Use --delete to remove backups instead of restoring.
Restore creates a safety backup of the current file before overwriting.
By default runs in dry-run mode. Use --force to actually write.`

export const options = [
    ["--delete", "Delete backup files instead of restoring", false],
    ["--force", "Actually write changes (default: dry-run)", false],
] as const

export function action(
    taskId: string | undefined,
    timestamp: string | undefined,
    cmdOpts: {delete?: boolean; force?: boolean},
): void {
    const root = resolveRoot()
    const tasksDir = resolveTasksDir(root)

    if (cmdOpts.delete) {
        if (!taskId && !timestamp) {
            console.error("--delete requires a taskId or timestamp argument")
            process.exit(1)
        }

        const result = deleteBackups(tasksDir, {
            taskId,
            timestamp,
            dryRun: !cmdOpts.force,
        })

        if (result.deleted.length === 0) {
            console.log("No matching backups found.")
            return
        }

        console.log(cmdOpts.force ? "Deleted:" : "Would delete:")
        for (const p of result.deleted) {
            console.log(`  ${path.basename(p)}`)
        }
        if (!cmdOpts.force) console.log("Dry-run — nothing deleted. Use --force to actually delete.")
        return
    }

    // Restore mode — or list mode when no args
    if (!taskId && !timestamp) {
        // List mode
        const entries = listBackups(tasksDir)
        if (entries.length === 0) {
            console.log("No backup files found.")
            return
        }

        // Group by taskId
        const byTask = new Map<string, BackupEntry[]>()
        for (const e of entries) {
            const group = byTask.get(e.taskId) ?? []
            group.push(e)
            byTask.set(e.taskId, group)
        }

        console.log("Backups found:")
        for (const [tid, group] of byTask) {
            console.log(`  ${tid}:`)
            // Group by timestamp within task
            const byTs = new Map<string, BackupEntry[]>()
            for (const e of group) {
                const tsg = byTs.get(e.timestamp) ?? []
                tsg.push(e)
                byTs.set(e.timestamp, tsg)
            }
            for (const [ts, ents] of byTs) {
                const names = ents.map(e => e.baseName).join(", ")
                console.log(`    ${ts}: ${names}`)
            }
        }
        return
    }

    // Restore mode
    const result = restoreFromBackups(tasksDir, {
        taskId,
        timestamp,
        dryRun: !cmdOpts.force,
    })

    if (result.restored.length === 0 && result.skipped.length === 0) {
        console.log("No matching backups found.")
        return
    }

    if (result.restored.length > 0) {
        console.log(cmdOpts.force ? "Restored:" : "Would restore:")
        for (const e of result.restored) {
            console.log(`  ${e.taskId}: ${e.baseName} ← ${path.basename(e.bakPath)}`)
        }
    }
    if (result.skipped.length > 0) {
        console.log("Skipped:")
        for (const s of result.skipped) {
            console.log(`  ${s}`)
        }
    }
    if (!cmdOpts.force) console.log("Dry-run — nothing written. Use --force to apply changes.")
}
