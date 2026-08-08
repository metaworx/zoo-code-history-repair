import {scanStorage} from "../scan.js"
import {recoverabilityScore} from "../scanOutput.js"
import {resolveRoot} from "../cliContext.js"

export const name = "list-corrupt"
export const summary = "List only corrupted task ids"

export const description = `${summary}.

Output format: <taskId><PAD><recoverability%><PAD><reason1,reason2,…>
One line per corrupted task. Same corruption reasons as the scan command.`

export const options: Array<[string, string, unknown]> = [
    ["--verify-ui-sync", "Compare ui_messages.json against ACH-derived reconstruction", false],
]

export function action(cmdOpts: { verifyUiSync?: boolean }): void {
    const root = resolveRoot()
    const result = scanStorage(root, {verifyUiSync: !!cmdOpts.verifyUiSync})
    for (const c of result.corruptions) {
        const score = recoverabilityScore(c)
        console.log(`${c.taskId.padEnd(38)} ${score.padEnd(5)} ${c.reasons.join(",")}`)
    }
}
