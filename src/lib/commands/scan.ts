/**
 * @file src/lib/commands/scan.ts
 *
 * scan command: cross-reference _index.json against task directories and
 * report corruption with recoverability detail.
 */

import {scanStorage} from "../scan.js"
import {
    taskMatch,
    truncate
} from "../format.js"
import {
    align,
    alignSummary,
    countEntries,
    formatPerFieldSummary,
    perFieldRecoverability,
    recoverabilityScore,
} from "../scanOutput.js"
import {
    API_HISTORY_NAME,
    DEFAULT_INDEX_NAME,
    HISTORY_ITEM_NAME,
    UI_MESSAGES_NAME
} from "../paths.js"
import {
    ABBREV_HELP,
    getVersionBanner,
    resolveRoot
} from "../cliContext.js"

export const name = "scan"
export const summary = `Scan _index.json + task directories for corruption`
export const description = `${summary}.

Reads the _index.json and all task directories, cross-references entries,
and reports any corruption found. Shows recoverability estimates and
entry counts (ACH/UIM) for each corrupted task. Use --verify-ui-sync
for deep ui_messages.json comparison against ACH-derived reconstruction.
With --json, outputs machine-parseable JSON instead of formatted text.
With --short, lists only corrupted task ids (compact one-line format).`

export const usage = `[--short] [--verify-ui-sync] [--json] [--quiet] [--no-summary] [--no-warnings]

Modes: scan          # full report with per-task corruption detail
       scan --short  # compact one-line list of corrupted task ids`

export const additionalHelp = `
Corruption reasons detected by scan:
  1. placeholder_task_name — task field matches "Task #N" / "Task #N (Incomplete)" pattern
  2. zero_size              — size field is 0 or null/missing (on disk or in index)
  3. missing_task_text      — disk task field is empty or whitespace-only
  4. missing_history_item   — ${HISTORY_ITEM_NAME} is missing or unreadable
  5. invalid_json           — a JSON file is syntactically invalid or truncated
  6. missing_task_dir       — an index entry references a task whose directory does not exist
  7. empty_ui_messages      — ${UI_MESSAGES_NAME} exists but contains an empty array
  8. empty_api_history      — ${API_HISTORY_NAME} exists but contains an empty array
  9. index_orphan           — entry in ${DEFAULT_INDEX_NAME} has no task directory on disk
 10. folder_orphan          — task directory on disk is absent from ${DEFAULT_INDEX_NAME}
 11. ui_sync_mismatch       — (opt-in) ${UI_MESSAGES_NAME} differs from ACH-derived reconstruction
 12. interrupted_task       — task appears interrupted (last turn ends with tool_use + other corruption)
 13. zero_tokens            — tokensIn/tokensOut/totalCost all 0 but ACH has entries
${ABBREV_HELP}`

export const options: Array<[string, string, unknown]> = [
    ["--verify-ui-sync", `Compare ${UI_MESSAGES_NAME} against ACH-derived reconstruction`, false],
    ["--json", "Output machine-parseable JSON", false],
    ["--short", "List only corrupted task ids (compact one-line format)", false],
    ["--quiet", "Suppress per-task detail lines (summary only)", false],
    ["--no-summary", "Suppress header summary block", true],
    ["--no-warnings", "Suppress warning-level corruption reasons", true],
]

export async function action(cmdOpts: {
    verifyUiSync?: boolean;
    json?: boolean;
    short?: boolean;
    quiet?: boolean;
    summary?: boolean;
    warnings?: boolean;
}): Promise<void> {
    const root = resolveRoot()
    const result = await scanStorage(root, {
        verifyUiSync: !!cmdOpts.verifyUiSync,
        showWarnings: cmdOpts.warnings !== false,
    })

    if (cmdOpts.short) {
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
        return
    }

    const fullIndex = new Map(result.indexItems.map(i => [i.id, i as Record<string, unknown>]))

    if (cmdOpts.json) {
        const corruptions = await Promise.all(result.corruptions.map(async c => ({
            taskId: c.taskId,
            dir: c.dir,
            reasons: c.reasons.map(r => ({reason: r.reason, source: r.source})),
            recoverability: recoverabilityScore(c),
            fields: await perFieldRecoverability(c, fullIndex),
            achEntries: countEntries(c.dir, API_HISTORY_NAME),
            uimEntries: countEntries(c.dir, UI_MESSAGES_NAME),
            indexTask: truncate(c.indexItem?.task, 200) || undefined,
            diskTask: truncate(c.diskItem?.task, 200) || undefined,
            taskMatch: taskMatch(c.indexItem?.task, c.diskItem?.task) ?? undefined,
            sizeIndex: c.indexItem?.size,
            sizeDisk: c.diskItem?.size,
        })))

        const out: Record<string, unknown> = {
            version: getVersionBanner().trim().replace("Zoo Code History Repair, v", ""),
            storageRoot: result.storageRoot,
            tasksDir: result.tasksDir,
            indexPath: result.indexPath,
            indexItemCount: result.indexItems.length,
            taskDirCount: result.taskDirs.length,
            corruptions,
        }
        console.log(JSON.stringify(out))
        const exitCode = Math.min(result.corruptions.length, 255)
        if (exitCode > 0) process.exit(exitCode)
        return
    }

    console.log(getVersionBanner())
    if (cmdOpts.summary !== false) {
        console.log(alignSummary("Storage:", result.storageRoot))
        console.log(alignSummary("Tasks:", result.tasksDir))
        console.log(alignSummary("Index:", result.indexPath))
        console.log(alignSummary("Files checked:", String(result.filesChecked)))
        console.log(alignSummary("Index entries:", String(result.indexItems.length)))
        console.log(alignSummary("Task dirs:", String(result.taskDirs.length)))
        console.log(alignSummary("Corruptions:", String(result.corruptions.length)))
        console.log(alignSummary("Errors:", String(result.totalErrorCount)))
        console.log(alignSummary("Warnings:", String(result.totalWarningCount)))
        console.log("")
    }

    if (!cmdOpts.quiet) {
        for (const c of result.corruptions) {
            const achCount = countEntries(c.dir, API_HISTORY_NAME)
            const uimCount = countEntries(c.dir, UI_MESSAGES_NAME)
            const score = recoverabilityScore(c)
            const fields = await perFieldRecoverability(c, fullIndex)

            console.log(`- ${c.taskId}`)
            console.log(align("reasons:", c.reasons.map(r => `${r.reason}(${r.source})`).join(", ")))
            console.log(align("recoverability:", score))
            console.log(align("fields:", formatPerFieldSummary(fields)))
            console.log(align("entries.ACH:", String(achCount)))
            console.log(align("entries.UIM:", String(uimCount)))
            console.log(align("task.index:", JSON.stringify(truncate(c.indexItem?.task, 200))))
            console.log(align("task.file:", JSON.stringify(truncate(c.diskItem?.task, 200))))
            const tm = taskMatch(c.indexItem?.task, c.diskItem?.task)
            if (tm) console.log(align("task.match:", tm))
            if (c.indexItem?.size != null) console.log(align("size.index:", String(c.indexItem.size)))
            if (c.diskItem?.size != null) console.log(align("size.file:", String(c.diskItem.size)))
            console.log("")
        }
    }

    const exitCode = Math.min(result.corruptions.length, 255)
    if (exitCode > 0) process.exit(exitCode)
}
