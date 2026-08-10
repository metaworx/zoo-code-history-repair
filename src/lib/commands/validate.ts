import path from "node:path"
import {getVersionBanner, resolveRoot} from "../cliContext.js"
import {resolveTasksDir} from "../paths.js"
import {validatePath, ValidateResult} from "../validation.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const name = "validate"
export const summary = "Validate task storage files against schema rules"
export const description = `Validate Zoo Code task storage files against comprehensive schema rules.
By default validates the entire storage root. Pass a file argument to validate a specific file,
or a task UUID to validate that task's directory.
Errors are shown by default; use --warnings to also show warnings.`

export const options = [
    ["--json", "Output machine-parseable JSON", false],
    ["--warnings", "Also show warning-level issues", false],
] as const

export function action(target: string | undefined, cmdOpts: { json?: boolean; warnings?: boolean }): void {
    let results: ValidateResult[] = []

    // Resolve UUID targets to task directories
    let resolvedTarget = target
    if (target && UUID_RE.test(target)) {
        const root = path.resolve(resolveRoot())
        resolvedTarget = path.join(resolveTasksDir(root), target)
    }

    try {
        results = validatePath(resolvedTarget);
    } catch (e) {
        console.error((e as Error).message)
        process.exit(1)
    }

    if (cmdOpts.json) {
        const out: Record<string, unknown> = {}
        for (const r of results) {
            out[r.file] = {
                valid: r.result.valid,
                errorCount: r.result.errorCount,
                warningCount: r.result.warningCount,
                issues: r.result.issues,
            }
        }
        console.log(JSON.stringify(out))
    } else {
        console.log(getVersionBanner())
        let totalErrors = 0
        let totalWarnings = 0

        for (const r of results) {
            const errors = r.result.issues.filter(i => i.severity === "error")
            const warnings = r.result.issues.filter(i => i.severity === "warning")
            totalErrors += errors.length
            totalWarnings += warnings.length

            if (errors.length === 0 && warnings.length === 0) continue

            console.log(`\n${r.file}:`)
            for (const issue of errors) {
                console.log(`  ERROR: ${issue.field ? issue.field + ": " : ""}${issue.message}`)
            }
            if (cmdOpts.warnings) {
                for (const issue of warnings) {
                    console.log(`  WARNING: ${issue.field ? issue.field + ": " : ""}${issue.message}`)
                }
            }
        }

        const validCount = results.filter(r => r.result.valid).length
        console.log(`\n${results.length} files checked, ${validCount} valid, ${totalErrors} errors, ${totalWarnings} warnings`)
    }

    const hasErrors = results.some(r => !r.result.valid)
    if (hasErrors) process.exit(1)
}
