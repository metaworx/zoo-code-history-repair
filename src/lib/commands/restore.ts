import path from "node:path"
import {resolveTasksDir} from "../paths.js"
import {
    getVersionBanner,
    resolveRoot
} from "../cliContext.js"
import {
    c,
    colorize
} from "../format.js"
import type {DiffResult} from "../restore.js"
import type {BackupEntry} from "../file.js"
import {
    deleteBackups,
    diffBackup,
    listBackupsForType,
    restoreFromBackups
} from "../restore.js"
import {BackupType} from "../file.js";

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
    ["--type <t>", "Backup type: history_item (restore/delete default), ui_messages, _index.task, all (list default)"],
    ["--diff", "Show field-by-field diff instead of restoring", false],
] as const

const dryRunDeleteMsg = colorize("\n!! Dry-run — nothing deleted. Use --force to actually delete. !!", c.red)
const dryRunRestoreMsg = colorize("\n!!Dry-run — nothing written. Use --force to apply changes. !!", c.red)

function formatDiffValue(value: unknown): string {
    if (value === undefined) return "undefined"
    return JSON.stringify(value)
}

function printDiff(diff: DiffResult, timestamp: string): void {
    console.log(`Diff for ${diff.taskId}/${diff.baseName} (${timestamp}):`)
    if (diff.currentMissing) {
        console.log("  (current file does not exist — full restore)")
        return
    }
    if (diff.backupMissing) {
        console.log("  (backup file missing)")
        return
    }
    for (const d of diff.diffs) {
        console.log(`  ${d.field}: ${formatDiffValue(d.backup)} → ${formatDiffValue(d.current)}`)
    }
    console.log(`  ${diff.diffs.length} fields changed, ${diff.unchanged} fields unchanged`)
}

function typeFromBaseName(baseName: string): BackupType {
    switch (baseName) {
        case "ui_messages.json":
            return "ui_messages"
        case "api_conversation_history.json":
            return "api_conversation_history"
        case "task_metadata.json":
            return "task_metadata"
        case "_index.json":
            return "_index"
        case "_index.task":
            return "_index.task"
        default:
            return "history_item"
    }
}

export async function action(
    taskId: string | undefined,
    timestamp: string | undefined,
    cmdOpts: { delete?: boolean; force?: boolean; type?: BackupType; diff?: boolean },
): Promise<void> {
    const root = resolveRoot()
    const tasksDir = resolveTasksDir(root)

    console.log(getVersionBanner())

    if (cmdOpts.diff) {
        if (!taskId || !timestamp) {
            console.error("--diff requires a taskId and timestamp argument")
            process.exit(1)
        }

        const diff = await diffBackup(tasksDir, taskId, timestamp, {type: cmdOpts.type})
        printDiff(diff, timestamp)
        if (diff.backupMissing) process.exit(1)
        return
    }

    if (cmdOpts.delete) {
        if (!taskId && !timestamp) {
            console.error("--delete requires a taskId or timestamp argument")
            process.exit(1)
        }

        const result = await deleteBackups(tasksDir, {
            taskId,
            timestamp,
            dryRun: !cmdOpts.force,
            type: cmdOpts.type,
        })

        if (result.deleted.length === 0) {
            console.log("No matching backups found.")
            return
        }

        console.log(cmdOpts.force ? "Deleted:" : "Would delete:")
        for (const p of result.deleted) {
            console.log(`  ${path.basename(p)}`)
        }
        if (!cmdOpts.force) console.log(dryRunDeleteMsg)
        return
    }

    // Restore mode — or list mode when no args
    if (!taskId && !timestamp) {
        // List mode
        const entries = await listBackupsForType(tasksDir, cmdOpts.type ?? "all")
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
    const result = await restoreFromBackups(tasksDir, {
        taskId,
        timestamp,
        dryRun: !cmdOpts.force,
        type: cmdOpts.type,
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

        for (const e of result.restored) {
            const diff = await diffBackup(tasksDir, e.taskId, e.timestamp, {
                type: typeFromBaseName(e.baseName),
            })
            printDiff(diff, e.timestamp)
        }
    }
    if (result.skipped.length > 0) {
        console.log("Skipped:")
        for (const s of result.skipped) {
            console.log(`  ${s}`)
        }
    }
    if (!cmdOpts.force) console.log(dryRunRestoreMsg)
}
