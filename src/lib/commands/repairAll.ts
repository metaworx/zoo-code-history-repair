import {repairAllCorrupted} from "../repairAll.js"
import {resolveRoot} from "../cliContext.js"

export const name = "repair-all"
export const summary = "Repair all corrupted tasks (default: dry-run, use --force to write)"

export const description = `${summary}.

Runs scan internally, then calls repair-task on every corrupted task.
Token repair: recovers from _index.json or estimates from ACH.
Use --fixed-input-token 0 to disable estimation.
Reports per-task results (repaired counts or failure reasons) and a summary line.
By default runs in dry-run mode. Use --force to actually write.`

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", "Skip creating timestamped backup files"],
    ["--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt],
] as const

export function action(cmdOpts: { force?: boolean; backup?: boolean; fixedInputToken?: number }): void {
    const root = resolveRoot()
    const ra = repairAllCorrupted(root, {
        dryRun: !cmdOpts.force,
        backup: cmdOpts.backup !== false,
        fixedInputToken: cmdOpts.fixedInputToken,
    })

    console.log(`Found ${ra.total} corrupted tasks`)
    for (const r of ra.results) {
        const fixed = [r.uiRepaired, r.taskRepaired, r.sizeRepaired, r.tokensRepaired].filter(Boolean).length
        if (fixed > 0) {
            const parts: string[] = []
            if (r.uiRepaired) parts.push("ui")
            if (r.taskRepaired) parts.push("task")
            if (r.sizeRepaired) parts.push("size")
            if (r.tokensRepaired) parts.push(`tokens(${r.tokensRecoverySource ?? "?"})`)
            console.log(`  ${r.taskId}: repaired ${parts.join(", ")}`)
        } else if (r.errors.length) {
            console.log(`  ${r.taskId}: FAILED — ${r.errors.join("; ")}`)
        } else {
            console.log(`  ${r.taskId}: nothing to repair`)
        }
    }
    console.log(`\nRepaired: ${ra.repaired}, Failed: ${ra.failed}`)
    if (!cmdOpts.force) console.log("Dry-run — nothing written. Use --force to apply changes.")
}
