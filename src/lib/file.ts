import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {safeWriteJson} from "./io/safeWriteJson.js"
import {getValidatorByFile, ValidationResult, ValidatorFn} from "./validation.js"
import {resolveTasksDir} from "./paths.js";

export interface FileSnapshot {
    mtimeMs: number
    ctimeMs: number
    size: number
    inode: number
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

async function statSnapshot(filePath: string): Promise<FileSnapshot | null> {
    try {
        const s = await fs.stat(filePath)
        return {mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size, inode: s.ino}
    } catch {
        return null
    }
}

function snapshotMatch(a: FileSnapshot, b: FileSnapshot): string | null {
    let s = []

    if (a.mtimeMs !== b.mtimeMs)
        s.push(`mtime: ${a.mtimeMs} <> ${b.mtimeMs}`)

    if (a.ctimeMs !== b.ctimeMs)
        s.push(`ctimeMs: ${a.ctimeMs} <> ${b.ctimeMs}`)

    if (a.size !== b.size)
        s.push(`size: ${a.size} <> ${b.size}`)

    if (a.inode !== b.inode)
        s.push(`inode: ${a.inode} <> ${b.inode}`)

    if (s.length > 0)
        return s.join("; ")

    return null
}

export async function readJsonFile<T = unknown>(filePath: string): Promise<T | null> {
    try {
        const raw = await fs.readFile(filePath, "utf8")
        if (!raw.trim()) return null
        return JSON.parse(raw) as T
    } catch {
        return null
    }
}

export interface SaveFileOptions {
    /** Optional snapshot for concurrent modification detection. */
    snapshot?: FileSnapshot
    /** When true (default), data is an object to be JSON-serialized via json-stream-stringify.
     *  When false, data is already a string — write directly. */
    stringify?: boolean
    /** If provided and a backup was created, the internal .bak_*.tmp is renamed to this path.
     *  If omitted, the backup is deleted. */
    backup?: string
}

/** Compute a SHA1 checksum of a JSON file with volatile fields (updatedAt, ts) stripped. */
export async function contentHash(filePath: string): Promise<string | null> {
    try {
        const raw = await fs.readFile(filePath, "utf8")
        const data = JSON.parse(raw)
        stripVolatile(data)
        return crypto.createHash("sha1").update(JSON.stringify(data)).digest("hex")
    } catch {
        return null
    }
}

/** Recursively remove volatile timestamp fields from an object (mutates in place). */
function stripVolatile(obj: unknown): void {
    if (!obj || typeof obj !== "object") return
    if (Array.isArray(obj)) {
        for (const item of obj) stripVolatile(item)
        return
    }
    const rec = obj as Record<string, unknown>
    delete rec.updatedAt
    delete rec.ts
    for (const v of Object.values(rec)) stripVolatile(v)
}

/**
 * Write data to a file with atomic rename, inter-process locking, and optional backup.
 *
 * Delegates to safeWriteJson for lock + stream + atomic rename.
 * Snapshot-based concurrent modification check runs before the async write.
 */
export async function saveFile(filePath: string, data: unknown, options: SaveFileOptions = {}): Promise<FileSnapshot | null> {
    if (options.snapshot) {
        const current = await statSnapshot(filePath)
        if (current) {
            const s = snapshotMatch(options.snapshot, current)
            if (s !== null) {
                throw new Error(`Concurrent modification detected for ${filePath}: file changed since last read (${s})`)
            }
        }
    }

    const result = await safeWriteJson(filePath, data, {
        stringify: options.stringify ?? false,
        keepBackup: !!options.backup,
    })

    if (result.backupPath && options.backup) {
        await fs.rename(result.backupPath, options.backup)
    }

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

    async load(validate: boolean = true, force: boolean = false): Promise<this> {
        if (!force && this.hasRead) return this

        this.data = await this._read()

        if (validate && this.data != null && this.validators.length > 0) {
            this.validate(true)
        }

        return this
    }

    getData(): unknown {
        return this.data
    }

    /** Set the in-memory data directly, bypassing file read. Returns this for chaining. */
    setData(data: unknown, validate: boolean = true): this {
        this.data = data
        this.hasRead = true

        if (validate) {
            this.validate(true)
        }

        return this
    }

    /** Save the current in-memory data to disk. */
    async save(validate: boolean = true, backup: boolean = true): Promise<string | null> {
        if (this.readOnly) throw new Error(`Cannot save read-only FileTransaction for ${this.filePath}`)

        if (validate) {
            const oldData = this.data
            try {
                this.validate(true)
            } catch (e) {
                this.data = oldData
                throw e
            }
        }

        const backupName = backup ? `${this.filePath}.${backupTimestamp}.bak.json` : undefined
        await this._write(this.data, {backup: backupName})
        return backupName ?? null
    }

    validate($throw: boolean = false): ValidationResult {
        if (!this.hasRead) throw new Error(`Cannot validate before loading ${this.filePath}`)

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
     * Called by `load()` to perform the actual file I/O and any format-specific
     * parsing. The base implementation reads the file as a UTF-8 string.
     *
     * Subclasses override this to provide format-specific parsing
     * (e.g. `JSON.parse` for `JsonFileTransaction`).
     *
     * @returns The parsed data, or null if the file cannot be read.
     */
    protected async _read(): Promise<string | null> {
        this.snapshot = await statSnapshot(this.filePath)
        if (!this.snapshot) {
            this.hasRead = true
            return null
        }
        const s = await fs.readFile(this.filePath, "utf8");
        this.hasRead = true
        return s
    }

    /**
     * Serialize and write data to disk.
     *
     * Called by `save()` to perform the actual serialization and file I/O.
     * The base implementation converts data to a string and writes via
     * `saveFile`, which delegates to safeWriteJson for lock + stream + atomic rename.
     *
     * Subclasses override this to provide format-specific serialization
     * (e.g. `JSON.stringify` for `JsonFileTransaction`).
     *
     * @param data The in-memory data to serialize and write.
     * @param options Options forwarded to saveFile (stringify, backup, snapshot).
     */
    protected async _write(data: unknown, options: SaveFileOptions = {}): Promise<void> {
        await saveFile(this.filePath, data, {
            stringify: false,
            snapshot: this.snapshot ?? undefined,
            ...options,
        })
    }
}

export function resolveTarget(target: string | undefined, root: string): string {
    if (!target) return resolveTasksDir(root)
    if (path.isAbsolute(target)) return target
    if (root) return path.resolve(root, target)
    return path.resolve(target)
}

export class JsonFileTransaction extends FileTransaction {

    protected async _read(): Promise<any> {
        const raw = await super._read()
        if (raw == null || !raw.trim()) return null
        try {
            return JSON.parse(raw)
        } catch {
            return null
        }
    }

    protected async _write(data: unknown, options: SaveFileOptions = {}): Promise<void> {
        await super._write(data, {stringify: true, ...options})
    }
}
