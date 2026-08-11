import {scanStorage} from "../scan.js"
import {recoverabilityScore} from "../scanOutput.js"
import {ABBREV_HELP, getVersionBanner, resolveRoot} from "../cliContext.js"

export const name = "list-corrupt"
export const summary = "List only corrupted task ids"

export const description = `${summary}.

Output format: <taskId><PAD><recoverability%><PAD><reason1(source),reason2(source),…>
One line per corrupted task. Same corruption reasons as the scan command.
With --json, outputs a JSON array of corruption entries.`

export const additionalHelp = ABBREV_HELP

export const options: Array<[string, string, unknown]> = [
    ["--verify-ui-sync", "Compare ui_messages.json against ACH-derived reconstruction", false],
    ["--json", "Output machine-parseable JSON", false],
    ["--no-summary", "Suppress summary line", true],
    ["--no-warnings", "Suppress warning-level corruption reasons", true],
]

export async function action(cmdOpts: {
    verifyUiSync?: boolean;
    json?: boolean;
    summary?: boolean;
    warnings?: boolean;
}): Promise<void> {
    const root = resolveRoot()
    const result = await scanStorage(root, {
        verifyUiSync: !!cmdOpts.verifyUiSync,
        showWarnings: cmdOpts.warnings !== false,
    })

    if (cmdOpts.json) {
        const out = {
            version: getVersionBanner().trim().replace("Zoo Code History Repair, v", ""),
            corruptions: result.corruptions.map(c => ({
                taskId: c.taskId,
                recoverability: recoverabilityScore(c),
                reasons: c.reasons.map(r => ({reason: r.reason, source: r.source})),
            })),
        }
        console.log(JSON.stringify(out))
        const exitCode = Math.min(result.corruptions.length, 255)
        if (exitCode > 0) process.exit(exitCode)
        return
    }

    console.log(getVersionBanner())
    for (const c of result.corruptions) {
        const score = recoverabilityScore(c)
        console.log(`${c.taskId.padEnd(38)} ${score.padEnd(5)} ${c.reasons.map(r => `${r.reason}(${r.source})`).join(",")}`)
    }

    if (cmdOpts.summary !== false) {
        const corruptCount = result.corruptions.length
        console.log(`\n${result.filesChecked} files checked, ${corruptCount} corrupted, ${result.totalErrorCount} errors, ${result.totalWarningCount} warnings`)
    }

    const exitCode = Math.min(result.corruptions.length, 255)
    if (exitCode > 0) process.exit(exitCode)
}
