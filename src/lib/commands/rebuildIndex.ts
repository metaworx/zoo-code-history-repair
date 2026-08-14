import {IndexTransaction} from "../IndexTransaction.js"
import {
    DEFAULT_INDEX_NAME,
    HISTORY_ITEM_NAME,
    resolveTasksDir,
    UI_MESSAGES_NAME
} from "../paths.js"
import {getVersionBanner, resolveRoot} from "../cliContext.js"
import {c, colorize} from "../format.js"

export const name = "rebuild-index"
export const summary = `Rebuild _index.json from each task's ${HISTORY_ITEM_NAME}`

export const description = `${summary}.

Reads every task directory on disk, extracts history_item.json, and writes a fresh
_index.json with correct entries. Handles both flat array and {entries: […]} formats.
By default runs in dry-run mode. Use --force to actually write.
Use --verify-ui-sync to cross-check ui_messages.json against the ACH reconstruction.`

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", `Skip creating a timestamped backup of the existing _index.json`],
    ["--verify-ui-sync", `Verify ${UI_MESSAGES_NAME} sync with ACH reconstruction`, false],
] as const

const dryRunMsg = colorize("\n!! Dry-run — nothing written. Use --force to apply changes. !!", c.red)

export async function action(cmdOpts: { force?: boolean; backup?: boolean; verifyUiSync?: boolean }): Promise<void> {
    const root = resolveRoot()
    const idx = new IndexTransaction(false)
    const {items, written, uiSyncMismatches = []} = await idx.repair(undefined, {
        dryRun: !cmdOpts.force,
        backup: cmdOpts.backup !== false,
        verifyUiSync: !!cmdOpts.verifyUiSync,
    })

    console.log(getVersionBanner())
    console.log(`Rebuilt index with ${items.length} items`)
    if (!written) {
        console.log(dryRunMsg)
    } else {
        console.log(`Written: ${resolveTasksDir(root)}/${DEFAULT_INDEX_NAME}`)
        if (cmdOpts.backup !== false) console.log(`Backup:  ${resolveTasksDir(root)}/${DEFAULT_INDEX_NAME}.${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}.bak.json`)
    }

    if (uiSyncMismatches.length > 0) {
        console.log(`UI-sync mismatch: ${uiSyncMismatches.length} task(s) differ from ACH reconstruction`)
        for (const id of uiSyncMismatches) console.log(`  ${id}: ui_sync_mismatch`)
    } else if (cmdOpts.verifyUiSync) {
        console.log("UI-sync verified: no mismatches")
    }
}
