import path from "node:path"
import { getVersionBanner, resolveRoot } from "../cliContext.js"
import { resolveTasksDir } from "../paths.js"
import { validatePath, ValidateResult } from "../validation.js"
import { UUID_FULL_PATTERN } from "../constants.js"

export const name = "validate"
export const summary = "Validate task storage files against schema rules"
export const description = `Validate Zoo Code task storage files against comprehensive schema rules.
By default validates the entire storage root. Pass a file argument to validate a specific file,
or a task UUID to validate that task's directory.
Errors and warnings are shown by default; use --no-warnings to hide warnings.`

export const options = [
	["--json", "Output machine-parseable JSON", false],
	["--no-warnings", "Suppress warning-level issues", true],
] as const

export async function action(
	target: string | undefined,
	cmdOpts: {
		json?: boolean
		warnings?: boolean
	},
): Promise<void> {
	let results: ValidateResult[] = []

	// Resolve UUID targets to task directories
	let resolvedTarget = target
	if (target && UUID_FULL_PATTERN.test(target)) {
		const root = path.resolve(resolveRoot())
		resolvedTarget = path.join(resolveTasksDir(root), target)
	}

	try {
		results = await validatePath(resolvedTarget)
	} catch (e) {
		console.error((e as Error).message)
		process.exit(1)
	}

	if (cmdOpts.json) {
		const out: Record<string, unknown> = {}
		for (const r of results) {
			const issues =
				cmdOpts.warnings === false ? r.result.issues.filter((i) => i.severity === "error") : r.result.issues
			out[r.file] = {
				valid: r.result.valid,
				errorCount: r.result.errorCount,
				warningCount: cmdOpts.warnings === false ? 0 : r.result.warningCount,
				issues,
			}
		}
		console.log(JSON.stringify(out))
	} else {
		console.log(getVersionBanner())
		let totalErrors = 0
		let totalWarnings = 0

		for (const r of results) {
			const errors = r.result.issues.filter((i) => i.severity === "error")
			const warnings = r.result.issues.filter((i) => i.severity === "warning")
			totalErrors += errors.length
			if (cmdOpts.warnings !== false) totalWarnings += warnings.length

			if (errors.length === 0 && warnings.length === 0) continue

			console.log(`\n${r.file}:`)
			for (const issue of errors) {
				console.log(`  ERROR: ${issue.field ? issue.field + ": " : ""}${issue.message}`)
			}
			if (cmdOpts.warnings !== false) {
				for (const issue of warnings) {
					console.log(`  WARNING: ${issue.field ? issue.field + ": " : ""}${issue.message}`)
				}
			}
		}

		const validCount = results.filter((r) => r.result.valid).length
		console.log(
			`\n${results.length} files checked, ${validCount} valid, ${totalErrors} errors, ${totalWarnings} warnings`,
		)
	}

	const hasErrors = results.some((r) => !r.result.valid)
	if (hasErrors) process.exit(1)
}
