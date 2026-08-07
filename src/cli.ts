#!/usr/bin/env node
import {Command} from "commander"
import path from "node:path"
import {guessStorageRoots, resolveTasksDir} from "./lib/paths.js"
import {scanStorage} from "./lib/scan.js"
import {rebuildIndexFromDisk} from "./lib/rebuildIndex.js"
import {repairTaskDir} from "./lib/repairTask.js"

const program = new Command()

program
    .name("zoo-code-history-repair")
    .description("Scan / repair Zoo Code task history index and corrupted task metadata")
    .option(
        "-r, --root <path>",
        "Storage root (directory that contains tasks/). If omitted, tries common locations.",
    )

program
    .command("scan")
    .description("Scan _index.json + task directories for corruption")
    .action(() => {
        const opts = program.opts<{ root?: string }>()
        const root = opts.root ?? guessStorageRoots()[0]
        if (!root) {
            console.error("No storage root found. Pass --root")
            process.exit(1)
        }

        const result = scanStorage(root)
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
            if (c.indexItem?.task) console.log(`  index.task: ${JSON.stringify(c.indexItem.task)}`)
            if (c.diskItem?.task) console.log(`  disk.task:  ${JSON.stringify(c.diskItem.task)}`)
            if (c.indexItem?.size != null) console.log(`  index.size: ${c.indexItem.size}`)
            if (c.diskItem?.size != null) console.log(`  disk.size:  ${c.diskItem.size}`)
        }
    })

program
    .command("list-corrupt")
    .description("List only corrupted task ids")
    .action(() => {
        const opts = program.opts<{ root?: string }>()
        const root = opts.root ?? guessStorageRoots()[0]
        if (!root) {
            console.error("No storage root found. Pass --root")
            process.exit(1)
        }
        const result = scanStorage(root)
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
        const opts = program.opts<{ root?: string }>()
        const root = opts.root ?? guessStorageRoots()[0]
        if (!root) {
            console.error("No storage root found. Pass --root")
            process.exit(1)
        }

        const {items, written, backupPath} = rebuildIndexFromDisk(root, {
            dryRun: !!cmdOpts.dryRun,
            backup: cmdOpts.backup !== false,
        })

        console.log(`Rebuilt index with ${items.length} items`)
        if (cmdOpts.dryRun) {
            console.log("Dry-run only — nothing written")
        } else {
            const tasksDir = resolveTasksDir(root)
            console.log(`Written: ${path.join(tasksDir, "_index.json")}`)
            if (backupPath) console.log(`Backup:  ${backupPath}`)
        }
    })

program
    .command("repair-task <taskId>")
    .description("Repair a single task: rebuild ui_messages.json, fix task field, recompute size")
    .option("--dry-run", "Do not write files", false)
    .option("--no-backup", "Do not create .bak files")
    .action((taskId: string, cmdOpts: { dryRun?: boolean; backup?: boolean }) => {
        const opts = program.opts<{ root?: string }>()
        const root = opts.root ?? guessStorageRoots()[0]
        if (!root) {
            console.error("No storage root found. Pass --root")
            process.exit(1)
        }

        const tasksDir = resolveTasksDir(root)
        const taskDir = path.join(tasksDir, taskId)

        const result = repairTaskDir(taskDir, {
            dryRun: !!cmdOpts.dryRun,
            backup: cmdOpts.backup !== false,
        })

        console.log(`Task: ${result.taskId}`)
        console.log(`  ui_messages.json repaired: ${result.uiRepaired}`)
        console.log(`  task field repaired:      ${result.taskRepaired}`)
        console.log(`  size field repaired:      ${result.sizeRepaired}`)
        if (result.errors.length) {
            console.log(`  errors:`)
            for (const e of result.errors) {
                console.log(`    - ${e}`)
            }
        }
        if (cmdOpts.dryRun) {
            console.log("Dry-run only — nothing written")
        }
    })

program
    .command("repair-all")
    .description("Repair all corrupted tasks found by scan")
    .option("--dry-run", "Do not write files", false)
    .option("--no-backup", "Do not create .bak files")
    .action((cmdOpts: { dryRun?: boolean; backup?: boolean }) => {
        const opts = program.opts<{ root?: string }>()
        const root = opts.root ?? guessStorageRoots()[0]
        if (!root) {
            console.error("No storage root found. Pass --root")
            process.exit(1)
        }

        const result = scanStorage(root)
        const corruptIds = result.corruptions.map(c => c.taskId)
        console.log(`Found ${corruptIds.length} corrupted tasks`)

        let repaired = 0
        let failed = 0

        for (const taskId of corruptIds) {
            const taskDir = path.join(result.tasksDir, taskId)
            const r = repairTaskDir(taskDir, {
                dryRun: !!cmdOpts.dryRun,
                backup: cmdOpts.backup !== false,
            })

            const fixed = [r.uiRepaired, r.taskRepaired, r.sizeRepaired].filter(Boolean).length
            if (fixed > 0) {
                repaired++
                console.log(`  ${taskId}: repaired ${fixed} fields`)
            } else {
                failed++
                if (r.errors.length) {
                    console.log(`  ${taskId}: FAILED — ${r.errors.join("; ")}`)
                } else {
                    console.log(`  ${taskId}: nothing to repair`)
                }
            }
        }

        console.log(`\nRepaired: ${repaired}, Failed: ${failed}`)
        if (cmdOpts.dryRun) {
            console.log("Dry-run only — nothing written")
        }
    })

program.parse()
