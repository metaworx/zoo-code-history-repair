#!/usr/bin/env node
/**
 * @file src/cli.ts
 *
 * CLI entry point: commander program setup and command dispatch.
 */

import { readFileSync } from "node:fs"
import { Command } from "commander"
import "./lib/registerCommandOptions.js"
import { setColorEnabled, setRoot, setVersion } from "./lib/cliContext.js"
import { guessStorageRoots } from "./lib/paths.js"
import * as scanCmd from "./lib/commands/scan.js"
import * as repairCmd from "./lib/commands/repair.js"
import * as deleteCmd from "./lib/commands/delete.js"
import * as restoreCmd from "./lib/commands/restore.js"
import * as validateCmd from "./lib/commands/validate.js"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version: string }

const program = new Command()
const version = `Zoo Code History Repair, v${pkg.version}\n`

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
	.option("-r, --root <path>", "Storage root (directory that contains tasks/). If omitted, tries common locations.")
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
	.usage(scanCmd.usage)
	.addHelpText("before", version)
	.addHelpText("after", scanCmd.additionalHelp)
	.registerOptions(scanCmd.options)
	.action(runAction(scanCmd.action as (...a: unknown[]) => Promise<void>))

program
	.command(`${repairCmd.name} [taskId]`)
	.summary(repairCmd.summary)
	.description(repairCmd.description)
	.usage(repairCmd.usage)
	.addHelpText("before", version)
	.addHelpText("after", repairCmd.additionalHelp)
	.registerOptions(repairCmd.options)
	.action(runAction(repairCmd.action as (...a: unknown[]) => Promise<void>))

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
	.usage(restoreCmd.usage)
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
