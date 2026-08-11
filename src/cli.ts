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
import * as validateCmd from "./lib/commands/validate.js"

const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string }

const program = new Command()
const version = `Zoo Code History Repair, v${pkg.version}\n`;

function runAction(action: (...args: unknown[]) => Promise<void>): (...args: unknown[]) => Promise<void> {
    return async (...args: unknown[]) => {
        try {
            await action(...args)
            process.exit(0)
        } catch (e) {
            console.error((e as Error).message)
            process.exit(1)
        }
    }
}

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
    .action(runAction(scanCmd.action as (...a: unknown[]) => Promise<void>))

program
    .command(listCorruptCmd.name)
    .summary(listCorruptCmd.summary)
    .description(listCorruptCmd.description)
    .addHelpText("before", version)
    .addHelpText("after", listCorruptCmd.additionalHelp)
    .registerOptions(listCorruptCmd.options)
    .action(runAction(listCorruptCmd.action as (...a: unknown[]) => Promise<void>))

program
    .command(rebuildIndexCmd.name)
    .summary(rebuildIndexCmd.summary)
    .description(rebuildIndexCmd.description)
    .addHelpText("before", version)
    .registerOptions(rebuildIndexCmd.options)
    .action(runAction(rebuildIndexCmd.action as (...a: unknown[]) => Promise<void>))

program
    .command(`${repairTaskCmd.name} <taskId>`)
    .summary(repairTaskCmd.summary)
    .description(repairTaskCmd.description)
    .addHelpText("before", version)
    .addHelpText("after", repairTaskCmd.additionalHelp)
    .registerOptions(repairTaskCmd.options)
    .action(runAction(repairTaskCmd.action as (...a: unknown[]) => Promise<void>))

program
    .command(repairAllCmd.name)
    .summary(repairAllCmd.summary)
    .description(repairAllCmd.description)
    .addHelpText("before", version)
    .addHelpText("after", repairAllCmd.additionalHelp)
    .registerOptions(repairAllCmd.options)
    .action(runAction(repairAllCmd.action as (...a: unknown[]) => Promise<void>))

program
    .command(`${deleteCmd.name} <taskId>`)
    .summary(deleteCmd.summary)
    .description(deleteCmd.description)
    .addHelpText("before", version)
    .registerOptions(deleteCmd.options)
    .action(runAction(deleteCmd.action as (...a: unknown[]) => Promise<void>))

program
    .command(`${restoreCmd.name} [taskId] [timestamp]`)
    .summary(restoreCmd.summary)
    .description(restoreCmd.description)
    .addHelpText("before", version)
    .registerOptions(restoreCmd.options)
    .action(runAction(restoreCmd.action as (...a: unknown[]) => Promise<void>))

program
    .command(`${validateCmd.name} [target]`)
    .summary(validateCmd.summary)
    .description(validateCmd.description)
    .addHelpText("before", version)
    .registerOptions(validateCmd.options)
    .action(runAction(validateCmd.action as (...a: unknown[]) => Promise<void>))

if (process.argv.includes("--version-only")) {
    console.log(pkg.version)
    process.exit(0)
}

program.parse()
