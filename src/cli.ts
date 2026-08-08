#!/usr/bin/env node
import {readFileSync} from "node:fs"
import {Command} from "commander"
import {guessStorageRoots, resolveTasksDir} from "./lib/paths.js"
import {scanStorage} from "./lib/scan.js"
import {rebuildIndexFromDisk} from "./lib/rebuildIndex.js"
import {repairTaskDir} from "./lib/repairTask.js"
import {repairAllCorrupted} from "./lib/repairAll.js"
import {taskMatch, truncate} from "./lib/format.js"

const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string }

const program = new Command()

program
    .name("zoo-code-history-repair")
    .description("Scan / repair Zoo Code task history index and corrupted task metadata")
    .version(`Zoo Code History Repair, v${pkg.version}`, "-v, --version", "Print version information")
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
    .description("Scan _index.json + task directories for corruption")
    .addHelpText("after", `
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
 12. interrupted_task       — task appears interrupted (unanswered attempt_completion / tool_use)`)
    .option("--verify-ui-sync", "Compare ui_messages.json against ACH-derived reconstruction", false)
    .action((cmdOpts: { verifyUiSync?: boolean }) => {
        const result = scanStorage(resolveRoot(), {verifyUiSync: !!cmdOpts.verifyUiSync})
        console.log(`Storage: ${result.storageRoot}`)
        console.log(`Tasks:   ${result.tasksDir}`)
        console.log(`Index:   ${result.indexPath}`)
        console.log(`Index entries: ${result.indexItems.length}`)
        console.log(`Task dirs:     ${result.taskDirs.length}`)
        console.log(`Corruptions:   ${result.corruptions.length}`)
        console.log("")

        for (const c of result.corruptions) {
            console.log(`- ${c.taskId}`)
            console.log(`  reasons: ${c.reasons.join(", ")}`)
            console.log(`  task.index: ${JSON.stringify(truncate(c.indexItem?.task, 200))}`)
            console.log(`  task.file:  ${JSON.stringify(truncate(c.diskItem?.task, 200))}`)
            const tm = taskMatch(c.indexItem?.task, c.diskItem?.task)
            if (tm) console.log(`  task.match: ${tm}`)
            if (c.indexItem?.size != null) console.log(`  size.index: ${c.indexItem.size}`)
            if (c.diskItem?.size != null) console.log(`  size.file:  ${c.diskItem.size}`)
        }
    })

program
    .command("list-corrupt")
    .description("List only corrupted task ids")
    .option("--verify-ui-sync", "Compare ui_messages.json against ACH-derived reconstruction", false)
    .action((cmdOpts: { verifyUiSync?: boolean }) => {
        const result = scanStorage(resolveRoot(), {verifyUiSync: !!cmdOpts.verifyUiSync})
        for (const c of result.corruptions) {
            console.log(`${c.taskId}\t${c.reasons.join(",")}`)
        }
    })

program
    .command("rebuild-index")
    .description("Rebuild _index.json from each task's history_item.json")
    .option("--dry-run", "Do not write files", false)
    .option("--no-backup", "Do not create .bak file")
    .action((cmdOpts: { dryRun?: boolean; backup?: boolean }) => {
        const root = resolveRoot()
        const {items, written, backupPath} = rebuildIndexFromDisk(root, {
            dryRun: !!cmdOpts.dryRun,
            backup: cmdOpts.backup !== false,
        })

        console.log(`Rebuilt index with ${items.length} items`)
        if (cmdOpts.dryRun) {
            console.log("Dry-run only — nothing written")
        } else {
            console.log(`Written: ${resolveTasksDir(root)}/_index.json`)
            if (backupPath) console.log(`Backup:  ${backupPath}`)
        }
    })

program
    .command("repair-task <taskId>")
    .description("Repair a single task: rebuild ui_messages.json, fix task field, recompute size")
    .option("--dry-run", "Do not write files", false)
    .option("--no-backup", "Do not create .bak files")
    .action((taskId: string, cmdOpts: { dryRun?: boolean; backup?: boolean }) => {
        const root = resolveRoot()
        const tasksDir = resolveTasksDir(root)
        const taskDir = `${tasksDir}/${taskId}`

        const r = repairTaskDir(taskDir, {
            dryRun: !!cmdOpts.dryRun,
            backup: cmdOpts.backup !== false,
        })

        console.log(`Task: ${r.taskId}`)
        console.log(`  ui_messages.json repaired: ${r.uiRepaired}`)
        console.log(`  task field repaired:      ${r.taskRepaired}`)
        console.log(`  size field repaired:      ${r.sizeRepaired}`)
        if (r.errors.length) {
            console.log(`  errors:`)
            for (const e of r.errors) console.log(`    - ${e}`)
        }
        if (cmdOpts.dryRun) console.log("Dry-run only — nothing written")
    })

program
    .command("repair-all")
    .description("Repair all corrupted tasks found by scan")
    .option("--dry-run", "Do not write files", false)
    .option("--no-backup", "Do not create .bak files")
    .action((cmdOpts: { dryRun?: boolean; backup?: boolean }) => {
        const root = resolveRoot()
        const ra = repairAllCorrupted(root, {
            dryRun: !!cmdOpts.dryRun,
            backup: cmdOpts.backup !== false,
        })

        console.log(`Found ${ra.total} corrupted tasks`)
        for (const r of ra.results) {
            const fixed = [r.uiRepaired, r.taskRepaired, r.sizeRepaired].filter(Boolean).length
            if (fixed > 0) {
                console.log(`  ${r.taskId}: repaired ${fixed} fields`)
            } else if (r.errors.length) {
                console.log(`  ${r.taskId}: FAILED — ${r.errors.join("; ")}`)
            } else {
                console.log(`  ${r.taskId}: nothing to repair`)
            }
        }
        console.log(`\nRepaired: ${ra.repaired}, Failed: ${ra.failed}`)
        if (cmdOpts.dryRun) console.log("Dry-run only — nothing written")
    })

if (process.argv.includes("--version-only")) {
    console.log(pkg.version)
    process.exit(0)
}

program.parse()
