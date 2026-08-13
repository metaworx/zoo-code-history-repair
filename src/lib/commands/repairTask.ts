import path from "node:path"
import {
    HISTORY_ITEM_NAME,
    resolveTasksDir,
    UI_MESSAGES_NAME
} from "../paths.js"
import {JsonFileTransaction} from "../file.js";
import {IndexTransaction} from "../IndexTransaction.js"
import {
    formatRepairParts,
    repairTaskDir
} from "../repairTask.js"
import {
    ABBREV_HELP,
    getVersionBanner,
    resolveRoot
} from "../cliContext.js"
import {
    c,
    colorize
} from "../format.js"

export const name = "repair-task"
export const summary = "Repair a single task (default: dry-run, use --force to write)"

export const description = `${summary}.

Repairs four aspects of a task directory:
  1. ui_messages.json — rebuild from api_conversation_history.json (ach→uim).
  2. task field        — extract original user prompt from the first user turn in ACH (ach→hi).
  3. size field        — recompute as the compact UTF-8 byte size of all task JSON files (calc→hi).
  4. token fields      — recover from _index.json or estimate from ACH content (source→hi).

Token repair priority: index recovery → user override → estimation (default).
Use --fixed-input-token 0 to disable estimation.
Falls back to partial ACH recovery if api_conversation_history.json is truncated.
By default runs in dry-run mode. Use --force to actually write.`

export const additionalHelp = ABBREV_HELP

export const options = [
    ["--force", "Actually write changes (default: dry-run)", false],
    ["--no-backup", "Do not create timestamped backup files"],
    ["--force-uim", `Force ${UI_MESSAGES_NAME} rebuild even when not corrupt`, false],
    ["--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt],
    ["--force-rebuild-hi", `Rebuild a missing ${HISTORY_ITEM_NAME} from ACH + backups`, false],
] as const

const dryRunMsg = colorize("\n!! Dry-run — nothing written. Use --force to apply changes. !!", c.red)

export async function action(taskId: string, cmdOpts: {
    force?: boolean;
    backup?: boolean;
    forceUim?: boolean;
    fixedInputToken?: number;
    forceRebuildHi?: boolean;
}): Promise<void> {
    const root = resolveRoot()
    const tasksDir = resolveTasksDir(root)
    const taskDir = `${tasksDir}/${taskId}`

    const idx = new IndexTransaction()
    const indexItems = await idx.getEntries() as Array<{
        id: string;
        tokensIn?: number;
        tokensOut?: number;
        totalCost?: number
    }>
    const fullIndex = await idx.getFullIndex()
    const taskIds = await idx.getKnownTaskIds()

    const r = await repairTaskDir(taskDir, {
        dryRun: !cmdOpts.force,
        backup: cmdOpts.backup !== false,
        forceUim: cmdOpts.forceUim,
        fixedInputToken: cmdOpts.fixedInputToken,
        forceRebuildHi: cmdOpts.forceRebuildHi,
        indexItems,
        fullIndex,
        taskIds,
    })

    console.log(getVersionBanner())

    if (r.errors.length) {
        console.log(`Task: ${r.taskId}`)
        console.log(`  errors:`)
        for (const e of r.errors) console.log(`    - ${e}`)
        if (r.hint) console.log(`  hint: ${r.hint}`)
        if (r.backups.length > 0) {
            console.log(`  Backups:`)
            for (const b of r.backups) console.log(`    ${path.basename(b)}`)
        }
        if (!cmdOpts.force) console.log(dryRunMsg)
        return
    }

    const parts = formatRepairParts(r)

    if (parts.length > 0) {
        console.log(`${cmdOpts.force ? "" : "[DRY-RUN] "}${r.taskId}: ${cmdOpts.force ? "repaired" : "would repair"} ${parts.join(", ")}`)
    }

    // Targeted index update: replace only this task's entry, never touch others
    let idxBak: string | null = null
    if (cmdOpts.force && parts.length > 0) {
        const hiTx = new JsonFileTransaction(path.join(taskDir, HISTORY_ITEM_NAME), true)
        await hiTx.load(false)
        const diskEntry = hiTx.getData() as Record<string, unknown> | null
        if (diskEntry) {
            const writeIdx = new IndexTransaction(false)
            idxBak = await writeIdx.replaceId(taskId, diskEntry, true, false)
        }
    }

    const allBackups = [...r.backups]
    if (idxBak) allBackups.push(idxBak)
    if (allBackups.length > 0) {
        console.log(`  Backups:`)
        for (const b of allBackups) console.log(`    ${path.basename(b)}`)
    }

    if (!cmdOpts.force) console.log(dryRunMsg)
}
