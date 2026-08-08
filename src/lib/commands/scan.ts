import {scanStorage} from "../scan.js"
import {taskMatch, truncate} from "../format.js"
import {align, alignSummary, countEntries, recoverabilityScore} from "../scanOutput.js"
import {API_HISTORY_NAME, UI_MESSAGES_NAME} from "../paths.js"
import {ABBREV_HELP, getVersionBanner, resolveRoot} from "../cliContext.js"

export const name = "scan"
export const summary = "Scan _index.json + task directories for corruption"
export const description = `${summary}.

Reads the _index.json and all task directories, cross-references entries,
and reports any corruption found. Shows recoverability estimates and
entry counts (ACH/UIM) for each corrupted task. Use --verify-ui-sync
for deep ui_messages.json comparison against ACH-derived reconstruction.
With --json, outputs machine-parseable JSON instead of formatted text.`

export const additionalHelp = `
Corruption reasons detected by scan:
  1. placeholder_task_name — task field matches "Task #N" / "Task #N (Incomplete)" pattern
  2. zero_size              — size field is 0 or null/missing (on disk or in index)
  3. missing_task_text      — disk task field is empty or whitespace-only
  4. missing_history_item   — history_item.json is missing or unreadable
  5. invalid_json           — (not yet produced) a JSON file is syntactically invalid or truncated
  6. missing_task_dir       — (not yet produced) an index entry has no corresponding task directory
  7. empty_ui_messages      — ui_messages.json exists but contains an empty array
  8. empty_api_history      — api_conversation_history.json exists but contains an empty array
  9. index_orphan           — entry in _index.json has no task directory on disk
 10. folder_orphan          — task directory on disk is absent from _index.json
 11. ui_sync_mismatch       — (opt-in) ui_messages.json differs from ACH-derived reconstruction
 12. interrupted_task       — task appears interrupted (last turn ends with tool_use + other corruption)
 13. zero_tokens            — tokensIn/tokensOut/totalCost all 0 but ACH has entries
${ABBREV_HELP}`

export const options: Array<[string, string, unknown]> = [
    ["--verify-ui-sync", "Compare ui_messages.json against ACH-derived reconstruction", false],
    ["--json", "Output machine-parseable JSON", false],
    ["--quiet", "Suppress per-task detail lines (summary only)", false],
]

export function action(cmdOpts: { verifyUiSync?: boolean; json?: boolean; quiet?: boolean }): void {
    const root = resolveRoot()
    const result = scanStorage(root, {verifyUiSync: !!cmdOpts.verifyUiSync})

    if (cmdOpts.json) {
        const out: Record<string, unknown> = {
            version: getVersionBanner().trim().replace("Zoo Code History Repair, v", ""),
            storageRoot: result.storageRoot,
            tasksDir: result.tasksDir,
            indexPath: result.indexPath,
            indexItemCount: result.indexItems.length,
            taskDirCount: result.taskDirs.length,
            corruptions: result.corruptions.map(c => ({
                taskId: c.taskId,
                dir: c.dir,
                reasons: c.reasons.map(r => ({reason: r.reason, source: r.source})),
                recoverability: recoverabilityScore(c),
                achEntries: countEntries(c.dir, API_HISTORY_NAME),
                uimEntries: countEntries(c.dir, UI_MESSAGES_NAME),
                indexTask: truncate(c.indexItem?.task, 200) || undefined,
                diskTask: truncate(c.diskItem?.task, 200) || undefined,
                taskMatch: taskMatch(c.indexItem?.task, c.diskItem?.task) ?? undefined,
                sizeIndex: c.indexItem?.size,
                sizeDisk: c.diskItem?.size,
            })),
        }
        console.log(JSON.stringify(out))
        const exitCode = Math.min(result.corruptions.length, 255)
        if (exitCode > 0) process.exit(exitCode)
        return
    }

    console.log(getVersionBanner())
    console.log(alignSummary("Storage:", result.storageRoot))
    console.log(alignSummary("Tasks:", result.tasksDir))
    console.log(alignSummary("Index:", result.indexPath))
    console.log(alignSummary("Index entries:", String(result.indexItems.length)))
    console.log(alignSummary("Task dirs:", String(result.taskDirs.length)))
    console.log(alignSummary("Corruptions:", String(result.corruptions.length)))
    console.log("")

    if (!cmdOpts.quiet) {
        for (const c of result.corruptions) {
            const achCount = countEntries(c.dir, API_HISTORY_NAME)
            const uimCount = countEntries(c.dir, UI_MESSAGES_NAME)
            const score = recoverabilityScore(c)

            console.log(`- ${c.taskId}`)
            console.log(align("reasons:", c.reasons.map(r => `${r.reason}(${r.source})`).join(", ")))
            console.log(align("recoverability:", score))
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
