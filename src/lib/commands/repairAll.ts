import {repairAllCorrupted} from "../repairAll.js"
import {resolveTasksDir} from "../paths.js"
import {getVersionBanner, resolveRoot} from "../cliContext.js"
import {c, colorize} from "../format.js"
import {align} from "../scanOutput.js"

export const name = "repair-all"
export const summary = "Repair all corrupted tasks (default: dry-run, use --force to write)"

export const description = `${summary}.

Runs scan internally, then calls repair-task on every corrupted task.
Token repair: recovers from _index.json or estimates from ACH.
Use --fixed-input-token 0 to disable estimation.
Reports per-task results with source→target notation and a summary line.
Rebuilds _index.json from repaired disk state.
By default runs in dry-run mode. Use --force to actually write.`

export const additionalHelp = `
Output abbreviations:
  ach    = api_conversation_history.json
  calc   = computed from task files on disk
  hi     = history_item.json
  uim    = ui_messages.json
  idx    = _index.json`

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", "Skip creating timestamped backup files"],
    ["--verbose", "Show all processed tasks including skipped", false],
    ["--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt],
] as const

const dryRunMsg = colorize("Dry-run — nothing written. Use --force to apply changes.", c.red)

export function action(cmdOpts: { force?: boolean; backup?: boolean; verbose?: boolean; fixedInputToken?: number }): void {
    const root = resolveRoot()
    const ra = repairAllCorrupted(root, {
        dryRun: !cmdOpts.force,
        backup: cmdOpts.backup !== false,
        fixedInputToken: cmdOpts.fixedInputToken,
    })

    console.log(getVersionBanner())
    console.log(align("Storage:", root))
    console.log(align("Tasks:", resolveTasksDir(root)))
    console.log("")

    console.log(`Found ${ra.total} corrupted tasks`)
    let shown = 0
    for (const r of ra.results) {
        const parts: string[] = []
        if (r.uiRepaired) parts.push("ui(ach→uim)")
        if (r.taskRepaired) parts.push("task(ach→hi)")
        if (r.sizeRepaired) parts.push("size(calc→hi)")
        if (r.tokensRepaired) {
            const src = r.tokensRecoverySource ?? "?"
            parts.push(`tokens(${src}→hi)`)
        }

        if (parts.length > 0) {
            console.log(`  ${r.taskId}: repaired ${parts.join(", ")}`)
            shown++
        } else if (r.errors.length) {
            console.log(`  ${r.taskId}: FAILED — ${r.errors.join("; ")}`)
            shown++
        } else if (cmdOpts.verbose) {
            console.log(`  ${r.taskId}: nothing to repair`)
            shown++
        }
        // else: suppress no-op tasks
    }

    // Index rebuild summary
    if (ra.indexEntries > 0) {
        const addendum: string[] = []
        if (ra.indexAdded.length > 0) addendum.push(`+${ra.indexAdded.length} added: ${ra.indexAdded.join(", ")}`)
        if (ra.indexRemoved.length > 0) addendum.push(`−${ra.indexRemoved.length} removed: ${ra.indexRemoved.join(", ")}`)
        const extra = addendum.length > 0 ? ` (${addendum.join(", ")})` : ""
        console.log(`_index.json rebuilt: ${ra.indexEntries} entries${extra}`)
    }

    console.log(`\nRepaired: ${ra.repaired}, Failed: ${ra.failed}`)
    if (!cmdOpts.force) console.log(dryRunMsg)
}
