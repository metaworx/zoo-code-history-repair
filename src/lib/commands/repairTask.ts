import path from "node:path"
import {resolveIndexPath, resolveTasksDir} from "../paths.js"
import {backupFile, readJsonFile, writeJsonCompact} from "../file.js";
import {repairTaskDir} from "../repairTask.js"
import {ABBREV_HELP, getVersionBanner, resolveRoot} from "../cliContext.js"
import {c, colorize} from "../format.js"
import type {HistoryItem} from "../../types.js"

export const name = "repair-task"
export const summary = "Repair a single task (default: dry-run, use --force to write)"

export const description = `${summary}.

Repairs four aspects of a task directory:
  1. ui_messages.json — rebuild from api_conversation_history.json (ach→uim).
  2. task field        — extract original user prompt from the first user turn in ACH (ach→hi).
  3. size field        — recompute as the compact UTF-8 byte size of all task JSON files (calc→hi).
  4. token fields      — recover from _index.json or estimate from ACH content (source→hi).

Token repair priority: index recovery → estimation (default) → user override.
Use --fixed-input-token 0 to disable estimation.
Falls back to partial ACH recovery if api_conversation_history.json is truncated.
By default runs in dry-run mode. Use --force to actually write.`

export const additionalHelp = ABBREV_HELP

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", "Do not create timestamped backup files"],
    ["--force-uim", "Force ui_messages.json rebuild even when not corrupt", false],
    ["--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt],
] as const

const dryRunMsg = colorize("\n!! Dry-run — nothing written. Use --force to apply changes. !!", c.red)

export function action(taskId: string, cmdOpts: { force?: boolean; backup?: boolean; forceUim?: boolean; fixedInputToken?: number }): void {
    const root = resolveRoot()
    const tasksDir = resolveTasksDir(root)
    const taskDir = `${tasksDir}/${taskId}`

    const indexPath = resolveIndexPath(tasksDir)
    const indexData = readJsonFile<Array<{ id: string }> | { entries: Array<{ id: string }> }>(indexPath)
    const indexItems: Array<{ id: string; tokensIn?: number; tokensOut?: number; totalCost?: number }> =
        Array.isArray(indexData) ? indexData : (indexData as { entries: Array<{ id: string }> })?.entries ?? []

    const r = repairTaskDir(taskDir, {
        dryRun: !cmdOpts.force,
        backup: cmdOpts.backup !== false,
        forceUim: cmdOpts.forceUim,
        fixedInputToken: cmdOpts.fixedInputToken,
        indexItems,
    })

    console.log(getVersionBanner())

    if (r.errors.length) {
        console.log(`Task: ${r.taskId}`)
        console.log(`  errors:`)
        for (const e of r.errors) console.log(`    - ${e}`)
        if (r.backups.length > 0) {
            console.log(`  Backups:`)
            for (const b of r.backups) console.log(`    ${path.basename(b)}`)
        }
        if (!cmdOpts.force) console.log(dryRunMsg)
        return
    }

    const parts: string[] = []
    if (r.uiRepaired) parts.push("ui(ach→uim)")
    if (r.taskRepaired) parts.push("task(ach→hi)")
    if (r.sizeRepaired) parts.push("size(calc→hi)")
    if (r.tokensRepaired) {
        const src = r.tokensRecoverySource ?? "?"
        parts.push(`tokens(${src}→hi)`)
    }

    if (parts.length > 0) {
        console.log(`${r.taskId}: repaired ${parts.join(", ")}`)
    }

    // Sync _index.json entry with repaired history_item.json
    if (parts.length > 0 && cmdOpts.force) {
        const repairedHi = readJsonFile<HistoryItem>(path.join(taskDir, "history_item.json"))
        if (repairedHi && indexData) {
            if (Array.isArray(indexData)) {
                const idx = indexData.findIndex(e => e.id === taskId)
                if (idx >= 0) {
                    if (cmdOpts.backup !== false) backupFile(indexPath)
                    indexData[idx] = {...indexData[idx], ...repairedHi}
                    writeJsonCompact(indexPath, indexData)
                    console.log(`  _index.json: synced`)
                }
            } else if (indexData.entries) {
                const idx = indexData.entries.findIndex((e: {id: string}) => e.id === taskId)
                if (idx >= 0) {
                    if (cmdOpts.backup !== false) backupFile(indexPath)
                    indexData.entries[idx] = {...indexData.entries[idx], ...repairedHi}
                    writeJsonCompact(indexPath, indexData)
                    console.log(`  _index.json: synced`)
                }
            }
        }
    }

    if (r.backups.length > 0) {
        console.log(`  Backups:`)
        for (const b of r.backups) console.log(`    ${path.basename(b)}`)
    }
    if (!cmdOpts.force) console.log(dryRunMsg)
}
