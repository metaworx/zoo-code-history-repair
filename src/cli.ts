#!/usr/bin/env node
import {Command} from "commander"
import path from "node:path"
import {guessStorageRoots} from "./lib/paths.js"
import {scanStorage} from "./lib/scan.js"
import {rebuildIndexFromDisk} from "./lib/rebuildIndex.js"

const program = new Command()

program
    .name("zoo-task-repair")
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
            console.log(`Written: ${path.join(resolveTasksDirSafe(root), "_index.json")}`)
            if (backupPath) console.log(`Backup:  ${backupPath}`)
        }
    })

function resolveTasksDirSafe(root: string) {
    // local helper to avoid circular import noise in the snippet
    const {resolveTasksDir} = require("./lib/paths.js") as typeof import("./lib/paths.js")
    return resolveTasksDir(root)
}

program.parse()