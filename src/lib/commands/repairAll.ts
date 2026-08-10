import {formatRepairParts} from "../repairTask.js"
import {repairAllCorrupted} from "../repairAll.js"
import {resolveTasksDir} from "../paths.js"
import {ABBREV_HELP, getVersionBanner, resolveRoot} from "../cliContext.js"
import {c, colorize} from "../format.js"
import {alignSummary} from "../scanOutput.js"

export const name = "repair-all"
export const summary = "Repair all corrupted tasks (default: dry-run, use --force to write)"

export const description = `${summary}.

Runs scan internally, then calls repair-task on every corrupted task.
Token repair: recovers from _index.json or estimates from ACH.
Use --fixed-input-token 0 to disable estimation.
Reports per-task results with source→target notation and a summary line.
Rebuilds _index.json from repaired disk state.
By default runs in dry-run mode. Use --force to actually write.`

export const additionalHelp = ABBREV_HELP

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", "Skip creating timestamped backup files"],
    ["--verbose", "Show all processed tasks including skipped", false],
    ["--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt],
    ["--verify-ui-sync", "Verify ui_messages.json sync with ACH reconstruction", false],
] as const

const dryRunMsg = colorize("\nDry-run — nothing written. Use --force to apply changes.", c.red)

export function action(cmdOpts: {
    force?: boolean;
    backup?: boolean;
    verbose?: boolean;
    fixedInputToken?: number;
    verifyUiSync?: boolean;
}): void {
    const root = resolveRoot()
    const ra = repairAllCorrupted(root, {
        dryRun: !cmdOpts.force,
        backup: cmdOpts.backup !== false,
        fixedInputToken: cmdOpts.fixedInputToken,
        verifyUiSync: cmdOpts.verifyUiSync,
    })

    console.log(getVersionBanner())
    console.log(alignSummary("Storage:", root))
    console.log(alignSummary("Tasks:", resolveTasksDir(root)))
    console.log("")

    console.log(`Found ${ra.total} corrupted tasks`)
    let shown = 0
    for (const r of ra.results) {
        const parts = formatRepairParts(r)

        if (r.unrepairable) {
            console.log(`  ${r.taskId}: UNREPAIRABLE — ${r.errors.join("; ")}`)
            shown++
        } else if (parts.length > 0) {
            const prefix = cmdOpts.force ? "" : "[DRY-RUN] "
            const verb = cmdOpts.force ? "repaired" : "would repair"
            console.log(`  ${prefix}${r.taskId}: ${verb} ${parts.join(", ")}`)
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

    const prefix = cmdOpts.force ? "" : "[DRY-RUN] "
    console.log(`\n${prefix}Repaired: ${ra.repaired}, Unrepairable: ${ra.unrepairable}, Failed: ${ra.failed}`)
    if (!cmdOpts.force) console.log(dryRunMsg)
}
