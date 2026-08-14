#!/usr/bin/env node
/**
 * @file tests/npm-test-tail.mjs
 * @version 1.5.0
 */

import { spawn } from "node:child_process"
import process from "node:process"

import which from "which"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"

const VERSION = "1.5.0"

const DEFAULT_PATTERNS = [
	/FAIL|PASS|Error|×|✓|failed|passed/i,
	/^(\s*at\s+)/, // stack trace lines
	/^>\s/, // file path marker (Jest / Vitest)
	/────|⎯{10,}|===|---{5,}/, // test suite / failure separators
	/^\s+\d+\|\s/, // source code line context (with line numbers)
	/Expected:|Received:/, // Jest/Vitest assertion diff lines
]

let argv = yargs(hideBin(process.argv))
	.usage("Usage: $0 [options] [command] [extra..]")
	.version(VERSION)
	.alias("version", "v")
	.command(
		"* [command] [extra..]", // ← key part: [extra..] = variadic / rest args
		'Run an npm script (defaults to "test")',
		(y) => {
			y.positional("command", {
				type: "string",
				default: "test",
				describe: "npm script to run (e.g. test, test:watch, build, lint)",
			}).positional("extra", {
				// ← collects everything after command
				type: "string",
				array: true,
				describe: "Extra arguments passed directly to the npm script",
			})
		},
	)
	.option("lines", {
		alias: "n",
		type: "number",
		default: 60,
		describe: "Number of lines to show (positive = last N, negative = first N)",
	})
	.option("bytes", {
		alias: "b",
		type: "number",
		describe: "Approximate max total output size in bytes (soft limit)",
	})
	.option("workspace", {
		type: "string",
		describe: "Workspace to pass to npm (--workspace=VALUE)",
	})
	.option("no-dots", {
		type: "boolean",
		default: false,
		describe: "Disable printing . progress indicators",
	})
	.option("show-patterns", {
		alias: "p",
		type: "boolean",
		default: false,
		describe: "Show the list of patterns used to filter important lines",
	})
	.option("all", {
		type: "boolean",
		default: false,
		describe: "Show all output (no filtering)",
	})
	.option("pattern-clear", {
		alias: "c",
		type: "boolean",
		default: false,
		describe: "Clear all default patterns before adding custom ones",
	})
	.option("pattern", {
		alias: "P",
		type: "string",
		array: true,
		describe: "Add custom regex pattern(s) to match interesting lines (can be repeated)",
	})
	.nargs("pattern", 1)
	.example("$0", "Run npm test → show last 60 relevant lines")
	.example('$0 --pattern-clear -P "FAIL|ERROR" -P "^    at"', "Only show failures + stack traces")
	.example("$0 test -P TIMEOUT -P flaky", "Add extra patterns on top of defaults")
	.example('$0 -p -c -P "FAIL" -P "PASS"', "Show effective patterns after customization")
	.help()
	.alias("help", "h").argv

// ───────────────────────────────────────────────
// Prepare final list of patterns
// ───────────────────────────────────────────────

let patterns = argv.all || argv.patternClear ? [] : [...DEFAULT_PATTERNS]

if (argv.pattern && argv.pattern.length > 0) {
	if (argv.all) {
		console.warn("All patterns are ignored due to the --all parameter!")
	} else {
		argv.pattern.forEach((p) => {
			try {
				// Allow user to write /pattern/flags or just pattern
				let regex

				if (p.startsWith("/") && p.lastIndexOf("/") > 0) {
					const lastSlash = p.lastIndexOf("/")

					const source = p.slice(1, lastSlash)

					const flags = p.slice(lastSlash + 1)

					regex = new RegExp(source, flags)
				} else {
					regex = new RegExp(p, "i") // default case-insensitive
				}
				patterns.push(regex)
			} catch (err) {
				console.warn(`Warning: invalid regex pattern skipped: ${p} (${err.message})`)
			}
		})
	}
}

const RELEVANT_KEYWORDS_REGEX = new RegExp(patterns.map((r) => `(?:${r.source})`).join("|"), "i")

function printPatterns() {
	console.log("Active line matching patterns:")
	console.log("───────────────────────────────────────────────")
	if (patterns.length === 0) {
		console.log("(no patterns — all lines would match if filtering were strict)")
	} else {
		patterns.forEach((pattern, i) => {
			console.log(`${i + 1}. ${pattern}`)
		})
	}
	console.log("")
}

function isInterestingLine(line) {
	return RELEVANT_KEYWORDS_REGEX.test(line)
}

function extractFilePath(line) {
	const match = line.match(/^>\s+(.+?)(?:\s|$)/)

	if (match) {
		return match[1].trim()
	}

	return null
}

async function main() {
	// console.log( `argv: ${ inspect( argv ) }` );

	if (!argv.all && argv.showPatterns) {
		printPatterns()
		// Optional: exit early if only --show-patterns was requested
		// if (process.argv.length <= 3) process.exit(0);
	}

	const script = argv.command || "test"

	const extraArgs = argv.extra || []

	const maxLines = Math.abs(argv.lines)

	const wantLast = argv.lines >= 0

	const maxBytes = argv.bytes ?? Infinity

	const showDots = !argv.noDots

	let npmArgs = ["run", script]

	if (argv.workspace) {
		npmArgs.push(`--workspace=${argv.workspace}`)
	}

	npmArgs = [...npmArgs, "--", ...extraArgs, ...argv._]

	const npmCmd = await which("npm")

	if (npmCmd.endsWith(".CMD")) {
		npmArgs = ["/d", "/c", npmCmd, ...npmArgs]
	}

	const bin = npmCmd.endsWith(".CMD") ? "cmd.exe" : npmCmd

	console.log(`Running: "${bin}" "${npmArgs.join('" "')}"`)

	console.log(`── collecting ${argv.all ? "" : "relevant "}lines ──`)

	const npm = spawn(bin, npmArgs, {
		stdio: ["ignore", "pipe", "pipe"],
		shell: false,
		windowsHide: true,
	})

	const buffer = []

	let currentFile = null

	function handleData(chunk) {
		const text = chunk.toString()

		const lines = text.split(/\r?\n/)

		for (const rawLine of lines) {
			const line = rawLine.trimEnd()

			if (!line) {
				continue
			}

			const file = extractFilePath(line)

			if (file) {
				currentFile = file
			}

			if (argv.all || isInterestingLine(line) || file) {
				buffer.push({
					line,
					file: currentFile,
				})

				if (showDots) {
					process.stdout.write(".")
				}

				if (buffer.length > maxLines * 5) {
					buffer.shift()
				}
			}
		}
	}

	npm.stdout.on("data", handleData)
	npm.stderr.on("data", handleData)

	npm.on("close", (code) => {
		if (showDots) {
			process.stdout.write("\n")
		}

		console.log(`\n───────────────────────────────────────────────`)
		console.log(`npm ${npmArgs.join(" ")} exited with code ${code ?? 0}`)

		if (buffer.length === 0) {
			console.log("(no relevant output captured)")
			process.exit(code ?? 0)
		}

		let linesToShow = wantLast ? buffer.slice(Math.max(0, buffer.length - maxLines)) : buffer.slice(0, maxLines)

		let output = []

		let currentBytes = 0

		const filePrinted = new Set()

		for (const { line, file } of linesToShow) {
			const fileHeader = file && !filePrinted.has(file) ? `\n  File: ${file}\n` : ""

			const toAdd = fileHeader + line + "\n"

			const addedBytes = Buffer.byteLength(toAdd, "utf8")

			if (currentBytes + addedBytes > maxBytes) {
				break
			}

			if (fileHeader) {
				filePrinted.add(file)
			}

			output.push(toAdd)
			currentBytes += addedBytes
		}

		if (output.length === 0) {
			console.log(`(output empty or exceeded --bytes limit)`)
		} else {
			if (output.length < linesToShow.length) {
				console.log(`(showing ${output.length}/${linesToShow.length} lines — truncated by --bytes)`)
			}
			console.log(output.join(""))
		}

		process.exit(code ?? 0)
	})

	process.on("SIGINT", () => {
		npm.kill("SIGINT")
		process.exit(130)
	})
}

await main()
