import crypto from "node:crypto"
import {Dirent} from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {safeWriteJson} from "./io/safeWriteJson.js"
import {
    getValidatorByFile,
    ValidationResult,
    ValidatorFn
} from "./validation.js"
import {
    API_HISTORY_NAME,
    DEFAULT_INDEX_NAME,
    HISTORY_ITEM_NAME,
    listTaskDirs,
    resolveTasksDir,
    TASK_METADATA_NAME,
    UI_MESSAGES_NAME
} from "./paths.js";

export type FileType = "_index" | "api_conversation_history" | "history_item" | "task_metadata" | "ui_messages"

/**
 * Backup/restore type selection.
 *
 * The two `_index` flavors are distinct:
 * - `_index` (a FileType) is the full index file `_index.json`; its backups use
 *   the natural `_index.json.{ts}.bak.json` naming.
 * - `_index.task` is the baseName of per-task index-entry extract backups
 *   (`_index.task.{ts}.bak.json`), which restore to `history_item.json`.
 * - `all` matches every type (list/delete only).
 */
export type BackupType = FileType | "_index.task" | "all"

/** On-disk filename (or backup baseName, for `_index.task`) each type maps to. */
export const TYPE_FILENAME: Record<FileType | Exclude<BackupType, "all">, string> = {
    _index: DEFAULT_INDEX_NAME,
    api_conversation_history: API_HISTORY_NAME,
    history_item: HISTORY_ITEM_NAME,
    task_metadata: TASK_METADATA_NAME,
    ui_messages: UI_MESSAGES_NAME,
    "_index.task": DEFAULT_INDEX_NAME.replace(/\.json$/, ".task")
}

/**
 * The baseName a type's .bak.json files carry.
 *
 * `_index` maps to `_index.json` — the full index file, whose backups are
 * `_index.json.{ts}.bak.json` (produced by `FileTransaction.save()` with
 * `backup:true`). `_index.task` maps to the `_index.task` baseName carried by
 * per-task index-entry extract backups (`_index.task.{ts}.bak.json`), which
 * restore to `history_item.json`.
 */
export function mapTypeToFileName(type: FileType | Exclude<BackupType, "all">): string {
    return TYPE_FILENAME[type]
}

export function mapTypeToFileNames(type: FileType | BackupType): string[] | undefined {
    return type === "all" ? undefined : [mapTypeToFileName(type)]
}

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
    /** When a string, the internal .bak_*.tmp is renamed to this path.
     *  When true, the .bak_*.tmp path is retained for post-save consolidation.
     *  When omitted/falsy, the backup is deleted by safeWriteJson. */
    backup?: boolean | string | null
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

    if (result.backupPath && typeof options.backup === "string") {
        await fs.rename(result.backupPath, options.backup)
    } else if (result.backupPath && options.backup === true) {
        options.backup = result.backupPath
    }

    return statSnapshot(filePath)
}

const TIMESTAMP_RE = /^(.+?)\.(\d{8}-\d{6})\.bak\.json$/

export function parseTimestamp(ts: string): Date | null {
    const m = ts.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
    if (!m) return null
    return new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
    )
}

export interface BackupEntry {
    taskId: string
    timestamp: string
    bakPath: string
    baseName: string
    basePath: string
}

export interface BackupScanEntry {
    bakPath: string
    baseName: string
    timestamp: string
}

export interface ListBackupsOptions {
    taskId?: string
    basenames?: string[]
}

export async function listBackups(
    tasksDir: string,
    opts: ListBackupsOptions = {},
): Promise<BackupEntry[]> {
    const taskDirs = opts.taskId
        ? [path.join(tasksDir, opts.taskId)]
        : listTaskDirs(tasksDir)

    const entries: BackupEntry[] = []
    for (const taskDir of taskDirs) {
        const taskId = path.basename(taskDir)
        for (const scan of await listBackupsForTask(taskDir, opts.basenames)) {
            entries.push({
                taskId,
                timestamp: scan.timestamp,
                bakPath: scan.bakPath,
                baseName: scan.baseName,
                basePath: path.join(taskDir, scan.baseName),
            })
        }
    }

    return entries
}

/**
 * Scan a single task directory for `{basename}.{YYYYMMDD-HHmmss}.bak.json`
 * backups, optionally filtered to the given basenames. Returns the parsed
 * basename and timestamp alongside each full path.
 */
export async function listBackupsForTask(
    dir: string,
    basenames?: string[],
): Promise<BackupScanEntry[]> {
    const entries: BackupScanEntry[] = []
    let dirEntries: Dirent[]
    try {
        dirEntries = await fs.readdir(dir, {withFileTypes: true})
    } catch {
        return entries
    }

    for (const de of dirEntries) {
        if (!de.isFile()) continue
        const m = de.name.match(TIMESTAMP_RE)
        if (!m) continue

        const baseName = m[1]
        const timestamp = m[2]

        if (basenames && !basenames.includes(baseName)) continue

        entries.push({
            bakPath: path.join(dir, de.name),
            baseName,
            timestamp,
        })
    }

    return entries
}

export interface BackupConsolidationResult {
    /** The target file path that was saved. */
    target: string
    /** The newBackup path if it was kept (unique content), undefined if deduplicated. */
    new?: string
    /** Backup paths that were removed because they matched the target's content hash. */
    removed: string[]
}

/**
 * Consolidate backups for a target file by removing duplicates via content hash.
 *
 * 1. Lists backups for `target`'s basename + `additionalBasenames`
 * 2. Removes any backup whose content hash matches the target file
 * 3. If `newBackup` is provided and its content hash matches any remaining backup,
 *    deletes `newBackup` (deduplication) — `new` is returned as undefined
 * 4. Otherwise returns `new: newBackup`
 *
 * `newBackup` is NEVER included in `removed[]`.
 */
export async function consolidateBackups(
    target: string,
    newBackup?: string,
    additionalBasenames?: string[]
): Promise<BackupConsolidationResult> {
    const dir = path.dirname(target)
    const targetBasename = path.basename(target)
    const basenames = [targetBasename, ...(additionalBasenames ?? [])]

    const backups = (await listBackupsForTask(dir, basenames)).map(b => b.bakPath)
    const targetHash = await contentHash(target)
    const removed: string[] = []

    if (targetHash) {
        for (const bak of backups) {
            // Never consider newBackup for removal in this pass
            if (bak === newBackup) continue
            const bakHash = await contentHash(bak)
            if (bakHash === targetHash) {
                await fs.rm(bak)
                removed.push(bak)
            }
        }
    }

    if (newBackup) {
        const newHash = await contentHash(newBackup)
        if (newHash) {
            const remaining = backups.filter(b => !removed.includes(b) && b !== newBackup)
            for (const bak of remaining) {
                const bakHash = await contentHash(bak)
                if (bakHash === newHash) {
                    await fs.rm(newBackup)
                    return {target, removed}
                }
            }
        }
        return {target, new: newBackup, removed}
    }

    return {target, removed}
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

        const opts: SaveFileOptions = {backup: backup ? true : undefined}
        await this._write(this.data, opts)
        if (typeof opts.backup === "string") {
            const finalName = `${this.filePath}.${backupTimestamp}.bak.json`
            await fs.rename(opts.backup, finalName)
            return finalName
        }
        return null
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
     *                Mutated in place: backup may change from true → path string.
     */
    protected async _write(data: unknown, options: SaveFileOptions = {}): Promise<void> {
        const wasAutoBackup = options.backup === true

        options.stringify ??= false
        options.snapshot ??= this.snapshot ?? undefined

        await saveFile(this.filePath, data, options)

        if (wasAutoBackup && typeof options.backup === "string") {
            const result = await consolidateBackups(this.filePath, options.backup)
            options.backup = result.new
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

    protected async _read(): Promise<any> {
        const raw = await super._read()
        if (raw == null || !raw.trim()) return null
        try {
            return JSON.parse(raw)
        } catch {
            return null
        }
    }

    /**
     * Serialize and write JSON data.
     *
     * `options` is mutated in place (stringify defaulted to `true` when not
     * already set) rather than being replaced via object spread. saveFile()
     * and consolidateBackups() mutate `options.backup` (true → the retained
     * .bak_*.tmp path, then → the final consolidated path or undefined), and
     * FileTransaction.save() must observe those mutations in order to rename
     * the backup to its final .bak.json name.
     */
    protected async _write(data: unknown, options: SaveFileOptions = {}): Promise<void> {
        options.stringify ??= true
        await super._write(data, options)
    }
}
