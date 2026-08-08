import path from "node:path"
import {resolveIndexPath, resolveTasksDir} from "../paths.js"
import {readJsonFile} from "../readJson.js"
import {repairTaskDir} from "../repairTask.js"
import {resolveRoot} from "../cliContext.js"

export const name = "repair-task"
export const summary = "Repair a single task (default: dry-run, use --force to write)"

export const description = `${summary}.

Repairs four aspects of a task directory:
  1. ui_messages.json — rebuild from api_conversation_history.json (ACH→UIM).
  2. task field        — extract original user prompt from the first user turn in ACH.
  3. size field        — recompute as the compact UTF-8 byte size of all task JSON files.
  4. token fields      — recover from _index.json or estimate from ACH content.

Token repair priority: index recovery → estimation (default) → user override.
Use --fixed-input-token 0 to disable estimation.
Falls back to partial ACH recovery if api_conversation_history.json is truncated.
By default runs in dry-run mode. Use --force to actually write.`

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", "Do not create timestamped backup files"],
    ["--force-uim", "Force ui_messages.json rebuild even when not corrupt", false],
    ["--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt],
] as const

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

    const fileLabel = (aspect: boolean, files: string[]): string => {
        if (!aspect) return ""
        const relevant = files.filter(f => r.touchedFiles.includes(f))
        if (relevant.length === 0) return ""
        return ` (${relevant.join(", ")})`
    }

    console.log(`Task: ${r.taskId}`)
    console.log(`  ui_messages.json repaired: ${r.uiRepaired}${fileLabel(r.uiRepaired, ["ui_messages.json"])}`)
    console.log(`  task field repaired:      ${r.taskRepaired}${fileLabel(r.taskRepaired, ["history_item.json"])}`)
    console.log(`  size field repaired:      ${r.sizeRepaired}${fileLabel(r.sizeRepaired, ["history_item.json"])}`)
    console.log(`  token fields repaired:    ${r.tokensRepaired}${fileLabel(r.tokensRepaired, ["history_item.json"])}`)
    if (r.tokensRecoverySource) console.log(`  token source:             ${r.tokensRecoverySource}`)
    if (r.errors.length) {
        console.log(`  errors:`)
        for (const e of r.errors) console.log(`    - ${e}`)
    }
    if (r.backups.length > 0) {
        console.log(`  Backups:`)
        for (const b of r.backups) console.log(`    ${path.basename(b)}`)
    }
    if (!cmdOpts.force) console.log("Dry-run — nothing written. Use --force to apply changes.")
}
