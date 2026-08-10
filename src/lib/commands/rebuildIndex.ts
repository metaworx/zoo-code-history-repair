import {IndexTransaction} from "../IndexTransaction.js"
import {resolveTasksDir} from "../paths.js"
import {getVersionBanner, resolveRoot} from "../cliContext.js"
import {c, colorize} from "../format.js"

export const name = "rebuild-index"
export const summary = "Rebuild _index.json from each task's history_item.json"

export const description = `${summary}.

Reads every task directory on disk, extracts history_item.json, and writes a fresh
_index.json with correct entries. Handles both flat array and {entries: […]} formats.
By default runs in dry-run mode. Use --force to actually write.`

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", "Skip creating a timestamped backup of the existing _index.json"],
    ["--from-disk", "Rebuild entirely from disk (default: repair existing entries)", false],
] as const

const dryRunMsg = colorize("\n!! Dry-run — nothing written. Use --force to apply changes. !!", c.red)

export function action(cmdOpts: { force?: boolean; backup?: boolean; fromDisk?: boolean }): void {
    const root = resolveRoot()
    const idx = new IndexTransaction(false)
    const {items, written} = idx.repair(!!cmdOpts.fromDisk, undefined, {
        dryRun: !cmdOpts.force,
        backup: cmdOpts.backup !== false,
    })

    console.log(getVersionBanner())
    console.log(`Rebuilt index with ${items.length} items`)
    if (!written) {
        console.log(dryRunMsg)
    } else {
        const backupPath = idx.save(false, true)
        console.log(`Written: ${resolveTasksDir(root)}/_index.json`)
        if (backupPath) console.log(`Backup:  ${backupPath}`)
    }
}
