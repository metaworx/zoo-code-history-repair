#!/usr/bin/env node
import {readFileSync} from "node:fs"
import {Command} from "commander"
import "./lib/registerCommandOptions.js"
import {setColorEnabled, setRoot, setVersion} from "./lib/cliContext.js"
import {guessStorageRoots} from "./lib/paths.js"
import * as scanCmd from "./lib/commands/scan.js"
import * as listCorruptCmd from "./lib/commands/listCorrupt.js"
import * as rebuildIndexCmd from "./lib/commands/rebuildIndex.js"
import * as repairTaskCmd from "./lib/commands/repairTask.js"
import * as repairAllCmd from "./lib/commands/repairAll.js"
import * as deleteCmd from "./lib/commands/delete.js"
import * as restoreCmd from "./lib/commands/restore.js"

const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string }

const program = new Command()
const version = `Zoo Code History Repair, v${pkg.version}\n`;

program
    .name("zoo-code-history-repair")
    .description("Scan / repair Zoo Code task history index and corrupted task metadata")
    .version(`Zoo Code History Repair, v${pkg.version}`, "-v, --version", "Print version information")
    .addHelpText("before", version)
    .option("--version-only", "Print version number only")
    .option("--no-color", "Disable ANSI color output")
    .option(
        "-r, --root <path>",
        "Storage root (directory that contains tasks/). If omitted, tries common locations.",
    )
    .hook("preAction", () => {
        const opts = program.opts<{ root?: string; color?: boolean }>()
        setRoot(opts.root ?? guessStorageRoots()[0] ?? "")
        if (opts.color === false) setColorEnabled(false)
        setVersion(pkg.version)
        if (!opts.root && !guessStorageRoots()[0]) {
            console.error("No storage root found. Pass --root")
            process.exit(1)
        }
    })

program
    .command(scanCmd.name)
    .summary(scanCmd.summary)
    .description(scanCmd.description)
    .addHelpText("before", version)
    .addHelpText("after", scanCmd.additionalHelp)
    .registerOptions(scanCmd.options)
    .action(scanCmd.action)

program
    .command(listCorruptCmd.name)
    .summary(listCorruptCmd.summary)
    .description(listCorruptCmd.description)
    .addHelpText("before", version)
    .addHelpText("after", listCorruptCmd.additionalHelp)
    .registerOptions(listCorruptCmd.options)
    .action(listCorruptCmd.action)

program
    .command(rebuildIndexCmd.name)
    .summary(rebuildIndexCmd.summary)
    .description(rebuildIndexCmd.description)
    .addHelpText("before", version)
    .registerOptions(rebuildIndexCmd.options)
    .action(rebuildIndexCmd.action)

program
    .command(`${repairTaskCmd.name} <taskId>`)
    .summary(repairTaskCmd.summary)
    .description(repairTaskCmd.description)
    .addHelpText("before", version)
    .addHelpText("after", repairTaskCmd.additionalHelp)
    .registerOptions(repairTaskCmd.options)
    .action(repairTaskCmd.action)

program
    .command(repairAllCmd.name)
    .summary(repairAllCmd.summary)
    .description(repairAllCmd.description)
    .addHelpText("before", version)
    .addHelpText("after", repairAllCmd.additionalHelp)
    .registerOptions(repairAllCmd.options)
    .action(repairAllCmd.action)

program
    .command(`${deleteCmd.name} <taskId>`)
    .summary(deleteCmd.summary)
    .description(deleteCmd.description)
    .addHelpText("before", version)
    .registerOptions(deleteCmd.options)
    .action(deleteCmd.action)

program
    .command(`${restoreCmd.name} [taskId] [timestamp]`)
    .summary(restoreCmd.summary)
    .description(restoreCmd.description)
    .addHelpText("before", version)
    .registerOptions(restoreCmd.options)
    .action(restoreCmd.action)

if (process.argv.includes("--version-only")) {
    console.log(pkg.version)
    process.exit(0)
}

program.parse()
