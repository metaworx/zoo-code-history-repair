import path from "node:path"
import type {RepairOptions} from "../types.js"
import {HISTORY_ITEM_NAME, listTaskDirs, resolveIndexPath, resolveTasksDir} from "./paths.js"
import {JsonFileTransaction} from "./file.js"
import {resolveRoot} from "./cliContext.js"
import {validateHistoryItem} from "./validate/historyItem.js"

export class IndexTransaction extends JsonFileTransaction {
    readonly storageRoot: string
    readonly tasksDir: string
    public index: Record<string, Record<string, unknown>> = {}

    constructor(readOnly: boolean = true) {
        const root = resolveRoot()
        const tasksDir = resolveTasksDir(root)
        const indexPath = resolveIndexPath(tasksDir)
        super(indexPath, readOnly, [])
        this.storageRoot = root
        this.tasksDir = tasksDir
    }

    load(validate: boolean = true, force: boolean = false): this {
        const content = super.load(validate, force).getData()

        if (!content) return this

        const entries = this._getEntriesFromData(content as Record<string, unknown>)

        this.index = {}
        for (const entry of entries) {
            const id = (entry.id as string) ?? crypto.randomUUID()
            this.index[id] = entry
        }

        return this
    }

    save(validate: boolean = true, backup: boolean = true): string | null {
        // Sort entries before saving
        if (this.data && typeof this.data === "object") {
            const d = this.data as Record<string, unknown>
            if (d.entries && Array.isArray(d.entries)) {
                (d.entries as Array<Record<string, unknown>>).sort((a, b) => ((b.ts as number) ?? 0) - ((a.ts as number) ?? 0))
            }
        }

        return super.save(validate, backup)
    }

    /** Return all entries as a flat array from the index. */
    getEntries(): Array<Record<string, unknown>> {
        if (Object.keys(this.index).length === 0) {
            this.load(false).getData()
        }
        return Object.values(this.index)
    }

    /** Get a single entry by ID. If fromDisk, reads the task's history_item.json. */
    getById(id: string, fromDisk: boolean = false): Record<string, unknown> | null {
        if (fromDisk) {
            const hiTx = new JsonFileTransaction(path.join(this.tasksDir, id, HISTORY_ITEM_NAME), true)
            return hiTx.load(false).getData() as Record<string, unknown> | null
        }
        if (Object.keys(this.index).length === 0) {
            this.load(false).getData()
        }
        return this.index[id] ?? null
    }

    /** Build a Map of id → entry for cross-reference validation. */
    getFullIndex(): Map<string, Record<string, unknown>> {
        if (Object.keys(this.index).length === 0) {
            this.load(false).getData()
        }
        const map = new Map<string, Record<string, unknown>>()
        for (const [id, entry] of Object.entries(this.index)) {
            map.set(id, entry)
        }
        return map
    }

    /**
     * Remove a single entry by ID.
     * @param id        The entry ID to remove.
     * @param saveToDisk If true (default), writes immediately.
     */
    removeById(id: string, saveToDisk: boolean = true): boolean {
        this.getEntries()
        if (!(id in this.index)) return false
        delete this.index[id]
        if (saveToDisk) {
            this.setData({entries: Object.values(this.index)}, false).save(false)
        }
        return true
    }

    /**
     * Replace a single entry by ID.
     * @param id         The entry ID to replace.
     * @param entry      The new entry data.
     * @param saveToDisk If true (default), writes immediately. Set false for batch edits.
     * @param validate   If true (default), runs validateHistoryItem before replacing.
     */
    replaceId(id: string, entry: Record<string, unknown>, saveToDisk: boolean = true, validate: boolean = true): void {
        this.getEntries()
        if (validate) {
            const fullIndex = this.getFullIndex()
            // Temporarily add the entry to the map for cross-reference validation
            fullIndex.set(id, entry)
            const result = validateHistoryItem(entry, fullIndex)
            if (result.errorCount > 0) {
                throw new Error(`Validation failed for index entry ${id}: ${result.issues.filter(i => i.severity === "error").map(i => i.message).join("; ")}`)
            }
        }

        this.index[id] = entry

        if (saveToDisk) {
            this.setData({entries: Object.values(this.index)}, false).save(false)
        }
    }

    /**
     * Repair the index.
     * - fromDisk=true: rebuild entire index from disk (was rebuildIndexFromDisk)
     * - fromDisk=false: validate entries, replace corrupt from valid disk,
     *   back up double-corrupt entries (was repairIndex)
     * - id specified: scope to a single entry (for repair-task)
     */
    repair(fromDisk: boolean, id?: string, options: RepairOptions = {}): {
        items: Array<Record<string, unknown>>
        warnings: string[]
        replacedFromDisk: number
        backedUpToDisk: number
        written: boolean
    } {
        if (fromDisk) {
            return this._repairFromDisk(id, options)
        }
        return this._repairExisting(id, options)
    }

    /** Rebuild entire index from disk. */
    private _repairFromDisk(id?: string, options: RepairOptions = {}): {
        items: Array<Record<string, unknown>>
        warnings: string[]
        replacedFromDisk: number
        backedUpToDisk: number
        written: boolean
    } {
        const dirs = listTaskDirs(this.tasksDir)
        const warnings: string[] = []

        if (id) {
            // Scoped: only touch the specified task, keep others from current index
            const entries = this.getEntries()
            const newIndex: Record<string, Record<string, unknown>> = {}

            // Keep all existing entries except the one being repaired
            for (const entry of entries) {
                const eid = entry.id as string
                if (eid && eid !== id) {
                    newIndex[eid] = entry
                }
            }

            // Read the specified task from disk
            const hiTx = new JsonFileTransaction(path.join(this.tasksDir, id, HISTORY_ITEM_NAME), true)
            const disk = hiTx.load(false).getData() as Record<string, unknown> | null

            if (disk && disk.id) {
                const vResult = validateHistoryItem(disk)
                if (vResult.errorCount > 0) {
                    warnings.push(`${id}: ${vResult.issues.filter(i => i.severity === "error").map(i => i.message).join("; ")}`)
                }
                if (disk.id && disk.ts != null) {
                    newIndex[disk.id as string] = disk
                } else if (disk.id) {
                    newIndex[disk.id as string] = {...disk, ts: disk.ts ?? 0}
                }
            }

            this.index = newIndex
        } else {
            // Full rebuild from disk
            const newIndex: Record<string, Record<string, unknown>> = {}

            for (const dir of dirs) {
                const dirId = path.basename(dir)
                const hiTx = new JsonFileTransaction(path.join(dir, HISTORY_ITEM_NAME), true)
                const disk = hiTx.load(false).getData() as Record<string, unknown> | null

                if (disk && disk.id) {
                    const vResult = validateHistoryItem(disk)
                    if (vResult.errorCount > 0) {
                        warnings.push(`${dirId}: ${vResult.issues.filter(i => i.severity === "error").map(i => i.message).join("; ")}`)
                    }
                }

                if (disk && disk.id && disk.ts != null) {
                    newIndex[disk.id as string] = disk
                } else if (disk && disk.id) {
                    newIndex[disk.id as string] = {...disk, ts: disk.ts ?? 0}
                }
            }

            this.index = newIndex
        }

        const items = Object.values(this.index)
        items.sort((a, b) => ((b.ts as number) ?? 0) - ((a.ts as number) ?? 0))

        if (options.dryRun) {
            return {items, warnings, replacedFromDisk: 0, backedUpToDisk: 0, written: false}
        }

        this.setData({entries: items}, false)
        this.save(false, options.backup !== false)

        return {items, warnings, replacedFromDisk: 0, backedUpToDisk: 0, written: true}
    }

    /** Validate index entries against disk counterparts. */
    private _repairExisting(id?: string, options: RepairOptions = {}): {
        items: Array<Record<string, unknown>>
        warnings: string[]
        replacedFromDisk: number
        backedUpToDisk: number
        written: boolean
    } {
        const entries = this.getEntries()
        const warnings: string[] = []
        let replacedFromDisk = 0
        let backedUpToDisk = 0
        const newIndex: Record<string, Record<string, unknown>> = {}

        for (const entry of entries) {
            const eid = entry.id as string
            if (id && eid !== id) {
                newIndex[eid] = entry
                continue
            }

            const taskDir = path.join(this.tasksDir, eid)
            const hiTx = new JsonFileTransaction(path.join(taskDir, HISTORY_ITEM_NAME), true)
            const diskItem = hiTx.load(false).getData() as Record<string, unknown> | null

            const idxResult = validateHistoryItem(entry)
            const diskResult = diskItem ? validateHistoryItem(diskItem) : null

            if (idxResult.errorCount === 0) {
                newIndex[eid] = entry
            } else if (diskResult && diskResult.errorCount === 0 && diskItem) {
                newIndex[eid] = diskItem
                replacedFromDisk++
                warnings.push(`${eid}: replaced from disk`)
            } else {
                backedUpToDisk++
                warnings.push(`${eid}: both corrupt, removed from index`)
            }
        }

        this.index = newIndex

        if (!options.dryRun && !this.readOnly) {
            const items = Object.values(this.index)
            items.sort((a, b) => ((b.ts as number) ?? 0) - ((a.ts as number) ?? 0))
            this.setData({entries: items}, false)
            this.save(false, options.backup !== false)
        }

        const items = Object.values(this.index)
        return {items, warnings, replacedFromDisk, backedUpToDisk, written: !options.dryRun}
    }

    private _getEntriesFromData(data: Record<string, unknown>): Array<Record<string, unknown>> {
        if (!data) return []
        if (Array.isArray(data)) return data as Array<Record<string, unknown>>
        return (data.entries as Array<Record<string, unknown>>) ?? []
    }
}
