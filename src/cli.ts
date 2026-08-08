#!/usr/bin/env node
import {existsSync, readFileSync, rmSync} from "node:fs"
import path from "node:path"
import {Command} from "commander"
import {API_HISTORY_NAME, guessStorageRoots, resolveIndexPath, resolveTasksDir, UI_MESSAGES_NAME} from "./lib/paths.js"
import {backupFile, readJsonFile, writeJsonCompact} from "./lib/readJson.js"
import {scanStorage} from "./lib/scan.js"
import {rebuildIndexFromDisk} from "./lib/rebuildIndex.js"
import {repairTaskDir} from "./lib/repairTask.js"
import {repairAllCorrupted} from "./lib/repairAll.js"
import {taskMatch, truncate} from "./lib/format.js"
import {align, countEntries, recoverabilityScore} from "./lib/scanOutput.js"

const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string }

const program = new Command()

program
    .name("zoo-code-history-repair")
    .description("Scan / repair Zoo Code task history index and corrupted task metadata")
    .version(`Zoo Code History Repair, v${pkg.version}`, "-v, --version", "Print version information")
    .addHelpText("before", `Zoo Code History Repair, v${pkg.version}\n`)
    .option("--version-only", "Print version number only")
    .option(
        "-r, --root <path>",
        "Storage root (directory that contains tasks/). If omitted, tries common locations.",
    )

function resolveRoot(): string {
    const opts = program.opts<{ root?: string }>()
    const root = opts.root ?? guessStorageRoots()[0]
    if (!root) {
        console.error("No storage root found. Pass --root")
        process.exit(1)
    }
    return root
}

program
    .command("scan")
    .summary("Scan _index.json + task directories for corruption")
    .description(`Scan _index.json + task directories for corruption.
 
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
 13. zero_tokens            — tokensIn/tokensOut/totalCost all 0 but ACH has entries`)
    .addHelpText("before", `Zoo Code History Repair, v${pkg.version}\n`)
    .option("--verify-ui-sync", "Compare ui_messages.json against ACH-derived reconstruction", false)
    .action((cmdOpts: { verifyUiSync?: boolean }) => {
        const result = scanStorage(resolveRoot(), {verifyUiSync: !!cmdOpts.verifyUiSync})
        console.log(align("Storage:", result.storageRoot))
        console.log(align("Tasks:", result.tasksDir))
        console.log(align("Index:", result.indexPath))
        console.log(align("Index entries:", String(result.indexItems.length)))
        console.log(align("Task dirs:", String(result.taskDirs.length)))
        console.log(align("Corruptions:", String(result.corruptions.length)))
        console.log("")

        for (const c of result.corruptions) {
            const achCount = countEntries(c.dir, API_HISTORY_NAME)
            const uimCount = countEntries(c.dir, UI_MESSAGES_NAME)
            const score = recoverabilityScore(c)

            console.log(`- ${c.taskId}`)
            console.log(align("reasons:", c.reasons.join(", ")))
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
    })

program
    .command("list-corrupt")
    .summary("List only corrupted task ids")
    .description(`List only corrupted task ids.
 
Output format: <taskId><TAB><recoverability%><TAB><reason1,reason2,…>
One line per corrupted task. Same corruption reasons as the scan command.`)
    .addHelpText("before", `Zoo Code History Repair, v${pkg.version}\n`)
    .option("--verify-ui-sync", "Compare ui_messages.json against ACH-derived reconstruction", false)
    .action((cmdOpts: { verifyUiSync?: boolean }) => {
        const result = scanStorage(resolveRoot(), {verifyUiSync: !!cmdOpts.verifyUiSync})
        for (const c of result.corruptions) {
            const score = recoverabilityScore(c)
            console.log(`${c.taskId.padEnd(38)} ${score.padEnd(5)} ${c.reasons.join(",")}`)
        }
    })

program
    .command("rebuild-index")
    .summary("Rebuild _index.json from each task's history_item.json")
    .description(`Rebuild _index.json from each task's history_item.json.
 
Reads every task directory on disk, extracts history_item.json, and writes a fresh
_index.json with correct entries. Handles both flat array and {entries: […]} formats.
By default runs in dry-run mode. Use --force to actually write.`)
    .addHelpText("before", `Zoo Code History Repair, v${pkg.version}\n`)
    .option("--force", "Actually write changes (default: dry-run)", false)
    .option("--no-backup", "Skip creating a .bak backup of the existing _index.json")
    .action((cmdOpts: { force?: boolean; backup?: boolean }) => {
        const root = resolveRoot()
        const {items, backupPath} = rebuildIndexFromDisk(root, {
            dryRun: !cmdOpts.force,
            backup: cmdOpts.backup !== false,
        })

        console.log(`Rebuilt index with ${items.length} items`)
        if (!cmdOpts.force) {
            console.log("Dry-run — nothing written. Use --force to apply changes.")
        } else {
            console.log(`Written: ${resolveTasksDir(root)}/_index.json`)
            if (backupPath) console.log(`Backup:  ${backupPath}`)
        }
    })

program
    .command("repair-task <taskId>")
    .summary("Repair a single task (default: dry-run, use --force to write)")
    .description(`Repair a single task: rebuild ui_messages.json, fix task field, recompute size, estimate tokens.
 
Repairs four aspects of a task directory:
  1. ui_messages.json — rebuild from api_conversation_history.json (ACH→UIM).
  2. task field        — extract original user prompt from the first user turn in ACH.
  3. size field        — recompute as the compact UTF-8 byte size of all task JSON files.
  4. token fields      — recover from _index.json or estimate from ACH content.
 
Token repair priority: index recovery → estimation (default) → user override.
Use --fixed-input-token 0 to disable estimation.
Falls back to partial ACH recovery if api_conversation_history.json is truncated.
By default runs in dry-run mode. Use --force to actually write.`)
    .addHelpText("before", `Zoo Code History Repair, v${pkg.version}\n`)
    .option("--force", "Actually write changes (default: dry-run)", false)
    .option("--no-backup", "Do not create .bak files")
    .option("--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt)
    .action((taskId: string, cmdOpts: { force?: boolean; backup?: boolean; fixedInputToken?: number }) => {
        const root = resolveRoot()
        const tasksDir = resolveTasksDir(root)
        const taskDir = `${tasksDir}/${taskId}`

        // Load index for token recovery
        const indexPath = resolveIndexPath(tasksDir)
        const indexData = readJsonFile<Array<{ id: string }> | { entries: Array<{ id: string }> }>(indexPath)
        const indexItems: Array<{ id: string; tokensIn?: number; tokensOut?: number; totalCost?: number }> =
            Array.isArray(indexData) ? indexData : (indexData as { entries: Array<{ id: string }> })?.entries ?? []

        const r = repairTaskDir(taskDir, {
            dryRun: !cmdOpts.force,
            backup: cmdOpts.backup !== false,
            fixedInputToken: cmdOpts.fixedInputToken,
            indexItems,
        })

        console.log(`Task: ${r.taskId}`)
        console.log(`  ui_messages.json repaired: ${r.uiRepaired}`)
        console.log(`  task field repaired:      ${r.taskRepaired}`)
        console.log(`  size field repaired:      ${r.sizeRepaired}`)
        console.log(`  token fields repaired:    ${r.tokensRepaired}`)
        if (r.tokensRecoverySource) console.log(`  token source:             ${r.tokensRecoverySource}`)
        if (r.errors.length) {
            console.log(`  errors:`)
            for (const e of r.errors) console.log(`    - ${e}`)
        }
        if (!cmdOpts.force) console.log("Dry-run — nothing written. Use --force to apply changes.")
    })

program
    .command("repair-all")
    .summary("Repair all corrupted tasks (default: dry-run, use --force to write)")
    .description(`Repair all corrupted tasks found by scan.
 
Runs scan internally, then calls repair-task on every corrupted task.
Token repair: recovers from _index.json or estimates from ACH.
Use --fixed-input-token 0 to disable estimation.
Reports per-task results (repaired counts or failure reasons) and a summary line.
By default runs in dry-run mode. Use --force to actually write.`)
    .addHelpText("before", `Zoo Code History Repair, v${pkg.version}\n`)
    .option("--force", "Actually write changes (default: dry-run)", false)
    .option("--no-backup", "Skip creating .bak backups of modified files")
    .option("--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt)
    .action((cmdOpts: { force?: boolean; backup?: boolean; fixedInputToken?: number }) => {
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
    })

program
    .command("delete <taskId>")
    .summary("Delete a task directory and its _index entry (default: dry-run, use --force)")
    .description(`Delete a task directory and its _index entry.
 
Removes the task directory from disk and strips the entry from _index.json.
By default runs in dry-run mode. Use --force to actually delete.`)
    .addHelpText("before", `Zoo Code History Repair, v${pkg.version}\n`)
    .option("--force", "Actually delete (default: dry-run)", false)
    .option("--no-backup", "Skip creating a .bak backup of _index.json")
    .action((taskId: string, cmdOpts: { force?: boolean; backup?: boolean }) => {
        const root = resolveRoot()
        const tasksDir = resolveTasksDir(root)
        const taskDir = path.join(tasksDir, taskId)

        if (!cmdOpts.force) {
            console.log(`Would delete: ${taskDir}`)
            console.log(`Would remove _index entry for: ${taskId}`)
            console.log("Dry-run — nothing deleted. Use --force to actually delete.")
            return
        }

        // Remove directory
        if (existsSync(taskDir)) {
            rmSync(taskDir, {recursive: true, force: true})
            console.log(`Deleted: ${taskDir}`)
        } else {
            console.log(`Directory not found: ${taskDir}`)
        }

        // Remove from index
        const indexPath = resolveIndexPath(tasksDir)
        const indexData = readJsonFile<Array<{ id: string }> | { entries: Array<{ id: string }> }>(indexPath)
        if (!indexData) {
            console.log("Index not found — nothing to strip")
            return
        }

        if (Array.isArray(indexData)) {
            const filtered = indexData.filter(e => e.id !== taskId)
            if (cmdOpts.backup !== false) backupFile(indexPath)
            writeJsonCompact(indexPath, filtered)
            console.log(`Stripped ${taskId} from _index.json (${indexData.length} → ${filtered.length} entries)`)
        } else if (indexData.entries) {
            const filtered = indexData.entries.filter((e: { id: string }) => e.id !== taskId)
            if (cmdOpts.backup !== false) backupFile(indexPath)
            writeJsonCompact(indexPath, {...indexData, entries: filtered})
            console.log(`Stripped ${taskId} from _index.json (${indexData.entries.length} → ${filtered.length} entries)`)
        }
    })

if (process.argv.includes("--version-only")) {
    console.log(pkg.version)
    process.exit(0)
}

program.parse()
