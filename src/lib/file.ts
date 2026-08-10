import fs from "node:fs"
import path from "node:path"
import {getValidatorByFile, ValidationResult, ValidatorFn} from "./validation.js"
import {resolveTasksDir} from "./paths.js";

export interface FileSnapshot {
    mtimeMs: number
    ctimeMs: number
    size: number
}

function formatTimestamp(ms: boolean = false): string {
    const d = new Date()
    const Y = String(d.getFullYear())
    const M = String(d.getMonth() + 1).padStart(2, "0")
    const D = String(d.getDate()).padStart(2, "0")
    const h = String(d.getHours()).padStart(2, "0")
    const m = String(d.getMinutes()).padStart(2, "0")
    const s = String(d.getSeconds()).padStart(2, "0")
    const x = String(d.getMilliseconds()).padStart(2, "0")
    return `${Y}${M}${D}-${h}${m}${s}` + (ms ? x : '')
}

export const backupTimestamp = formatTimestamp()

function statSnapshot(filePath: string): FileSnapshot | null {
    try {
        const s = fs.statSync(filePath)
        return {mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size}
    } catch {
        return null
    }
}

function snapshotMatch(a: FileSnapshot, b: FileSnapshot): boolean {
    return a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.size === b.size
}

export function readJsonFile<T = unknown>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) return null
        const raw = fs.readFileSync(filePath, "utf8")
        if (!raw.trim()) return null
        return JSON.parse(raw) as T
    } catch {
        return null
    }
}

export function writeJsonCompact(filePath: string, data: unknown, snapshot: FileSnapshot | null = null): void {
    const text = JSON.stringify(data) // compact, matches plugin style

    saveFileWithSnapshot(filePath, text, snapshot)
}

export function backupFile(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null
    const bak = `${filePath}.${backupTimestamp}.bak.json`
    fs.copyFileSync(filePath, bak)
    return bak
}

export function saveFileWithSnapshot(filePath: string, data: string, snapshot: FileSnapshot | null = null): FileSnapshot | null {

    let tmpPath: string = ''

    do {
        tmpPath = `${filePath}.${formatTimestamp(true)}.tmp`
    } while (fs.existsSync(tmpPath))

    fs.writeFileSync(tmpPath, data, "utf8")

    if (snapshot) {
        const current = statSnapshot(filePath)
        if (current && !snapshotMatch(snapshot, current)) {
            try {
                fs.unlinkSync(tmpPath)
            } catch { /* best effort */
            }
            throw new Error(`Concurrent modification detected for ${filePath}: file changed since last read`)
        }
    }

    fs.renameSync(tmpPath, filePath)

    return statSnapshot(filePath)
}

export class FileTransaction {
    readonly filePath: string
    readonly readOnly: boolean
    protected snapshot: FileSnapshot | null = null
    protected data: any = null
    private hasRead = false
    private readonly validators: ValidatorFn[] = []

    constructor(filePath: string, readOnly: boolean = true, validators: ValidatorFn[] | undefined = undefined) {
        this.filePath = path.resolve(filePath)
        this.readOnly = readOnly


        if (validators) {
            this.validators = validators
        } else {
            const v = getValidatorByFile(filePath)

            if (v)
                this.addValidator(v)
        }
    }

    /** Register an additional custom validator. */
    addValidator(fn: ValidatorFn): void {
        this.validators.push(fn)
    }

    read(validate: boolean = true, force: boolean = false): unknown {
        if (!force && this.hasRead) return this.data

        this.data = this._read()

        if (validate && this.data != null && this.validators.length > 0) {
            this.validate(true)
        }

        return this.data
    }

    save(data: unknown = undefined): void {
        if (this.readOnly) throw new Error(`Cannot save read-only FileTransaction for ${this.filePath}`)

        let oldData = undefined

        if (data !== undefined) {
            oldData = this.data
            this.data = data
        }

        try {
            this.validate(true)
        } catch (e) {

            if (oldData !== undefined) {
                this.data = oldData
            }

            throw e
        }

        this._write(this.data)
    }

    validate($throw: boolean = false): ValidationResult {
        if (!this.hasRead) this.read(false)

        if (this.data === null) {
            const result: ValidationResult = {
                valid: false,
                issues: [{code: "NOT_FOUND", severity: "error", field: "", message: "file not found"}],
                errorCount: 1,
                warningCount: 0,
            }
            if ($throw) throw new Error(`Validation failed for ${this.filePath}`, {cause: result})
            return result
        }

        if (this.validators.length === 0) {
            return {
                valid: null,
                issues: [{
                    code: "NO_VALIDATOR",
                    severity: "warning",
                    field: "",
                    message: `no validator for ${path.basename(this.filePath)}`
                }],
                errorCount: 0,
                warningCount: 1,
            }
        }

        // Aggregate results from ALL validators
        const allIssues: ValidationResult["issues"] = []
        let allValid = true

        for (const v of this.validators) {
            const result = v(this.data)
            allIssues.push(...result.issues)
            if (!result.valid) allValid = false
        }

        const errors = allIssues.filter(i => i.severity === "error")
        const aggregate: ValidationResult = {
            valid: allValid,
            issues: allIssues,
            errorCount: errors.length,
            warningCount: allIssues.length - errors.length,
        }

        if ($throw && !allValid) {
            const msgs = errors.map(i => i.message).join("; ")
            throw new Error(`Validation failed for ${this.filePath}: ${msgs}`, {cause: aggregate})
        }

        return aggregate
    }

    /**
     * Read and parse the file from disk into the in-memory representation.
     *
     * Called by `read()` to perform the actual file I/O and any format-specific
     * parsing. The base implementation reads the file as a UTF-8 string.
     *
     * Subclasses override this to provide format-specific parsing
     * (e.g. `JSON.parse` for `JsonFileTransaction`).
     *
     * @returns The parsed data, or null if the file cannot be read.
     */
    protected _read(): string | null {
        this.snapshot = statSnapshot(this.filePath)
        if (!this.snapshot) {
            this.hasRead = true
            return null
        }
        const s = fs.readFileSync(this.filePath, "utf8");
        this.hasRead = true
        return s
    }

    /**
     * Serialize and write data to disk.
     *
     * Called by `save()` to perform the actual serialization and file I/O.
     * The base implementation converts data to a string and writes via
     * `saveFileWithSnapshot`, which handles temp-file + atomic rename +
     * concurrent modification detection.
     *
     * Subclasses override this to provide format-specific serialization
     * (e.g. `JSON.stringify` for `JsonFileTransaction`).
     *
     * @param data The in-memory data to serialize and write.
     */
    protected _write(data: unknown): void {
        const snapshot = saveFileWithSnapshot(this.filePath, String(data), this.snapshot)

        if (this.snapshot) {
            this.snapshot = snapshot
        }
    }
}

export function resolveTarget(target: string | undefined, root: string): string {
    if (!target) return resolveTasksDir(root)
    if (path.isAbsolute(target)) return target
    if (root) return path.resolve(root, target)
    return path.resolve(target)
}

export class JsonFileTransaction extends FileTransaction {

    protected _read(): any {
        const raw = super._read()
        if (raw == null || !raw.trim()) return null
        try {
            return JSON.parse(raw)
        } catch {
            return null
        }
    }

    protected _write(data: unknown): void {
        super._write(JSON.stringify(data))
    }
}
