import {IndexTransaction} from "../IndexTransaction.js"
import {DEFAULT_INDEX_BASENAME, DEFAULT_INDEX_NAME, HISTORY_ITEM_NAME, resolveTasksDir} from "../paths.js"
import {getVersionBanner, resolveRoot} from "../cliContext.js"
import {c, colorize} from "../format.js"

export const name = "rebuild-index"
export const summary = `Rebuild _index.json from each task's ${HISTORY_ITEM_NAME}`

export const description = `${summary}.

Reads every task directory on disk, extracts history_item.json, and writes a fresh
_index.json with correct entries. Handles both flat array and {entries: […]} formats.
By default runs in dry-run mode. Use --force to actually write.`

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", `Skip creating a timestamped backup of the existing _index.json`],
] as const

const dryRunMsg = colorize("\n!! Dry-run — nothing written. Use --force to apply changes. !!", c.red)

export async function action(cmdOpts: { force?: boolean; backup?: boolean }): Promise<void> {
    const root = resolveRoot()
    const idx = new IndexTransaction(false)
    const {items, written} = await idx.repair(undefined, {
        dryRun: !cmdOpts.force,
        backup: cmdOpts.backup !== false,
    })

    console.log(getVersionBanner())
    console.log(`Rebuilt index with ${items.length} items`)
    if (!written) {
        console.log(dryRunMsg)
    } else {
        console.log(`Written: ${resolveTasksDir(root)}/${DEFAULT_INDEX_NAME}`)
        if (cmdOpts.backup !== false) console.log(`Backup:  ${resolveTasksDir(root)}/${DEFAULT_INDEX_NAME}.${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}.bak.json`)
    }
}
