import fs from "node:fs"
import path from "node:path"
import type {HistoryItem, RepairOptions} from "../types.js"
import {
    HISTORY_ITEM_NAME,
    listTaskDirs,
    resolveIndexPath,
    resolveTasksDir
} from "./paths.js"
import {
    backupTimestamp,
    JsonFileTransaction,
    mapTypeToFileName,
    readJsonFile
} from "./file.js"
import {resolveRoot} from "./cliContext.js"
import {validateHistoryItem} from "./validate/historyItem.js"
import {safeWriteJson} from "./io/safeWriteJson.js"
import {inspectTaskDir} from "./validation.js"

interface RepairStats {
    orphansDisk: number
    orphansIdx: number
    corruptDisk: number
    corruptIdx: number
    errorsDisk: number
    errorsIdx: number
    warningsDisk: number
    warningsIdx: number
    replacedFromDisk: number
}

interface DanglingRef {
    field: string
    refId: string
}

export class IndexTransaction extends JsonFileTransaction {
    readonly storageRoot: string
    readonly tasksDir: string
    public index: Record<string, Record<string, unknown>> = {}

    constructor(readOnly: boolean = true) {
        const root = resolveRoot()
        const tasksDir = resolveTasksDir(root)
        const indexPath = resolveIndexPath(tasksDir)
        super(indexPath, readOnly)
        this.storageRoot = root
        this.tasksDir = tasksDir
    }

    async load(validate: boolean = true, force: boolean = false): Promise<this> {
        await super.load(validate, force)
        const content = super.getData()

        if (!content) return this

        const entries = this._getEntriesFromData(content as Record<string, unknown>)

        this.index = {}
        for (const entry of entries) {
            const id = (entry.id as string) ?? crypto.randomUUID()
            this.index[id] = entry
        }

        return this
    }

    async save(validate: boolean = true, backup: boolean = true): Promise<string | null> {
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
    async getEntries(): Promise<Array<Record<string, unknown>>> {
        if (Object.keys(this.index).length === 0) {
            await this.load(false)
        }
        return Object.values(this.index)
    }

    /** Get a single entry by ID. If fromDisk, reads the task's history_item.json. */
    async getById(id: string, fromDisk: boolean = false): Promise<Record<string, unknown> | null> {
        if (fromDisk) {
            const hiTx = new JsonFileTransaction(path.join(this.tasksDir, id, HISTORY_ITEM_NAME), true)
            await hiTx.load(false)
            return hiTx.getData() as Record<string, unknown> | null
        }
        if (Object.keys(this.index).length === 0) {
            await this.load(false)
        }
        return this.index[id] ?? null
    }

    /** Build a Map of id → entry for cross-reference validation. */
    async getFullIndex(): Promise<Map<string, Record<string, unknown>>> {
        if (Object.keys(this.index).length === 0) {
            await this.load(false)
        }
        const map = new Map<string, Record<string, unknown>>()
        for (const [id, entry] of Object.entries(this.index)) {
            map.set(id, entry)
        }
        return map
    }

    /** All known task ids: index entries plus on-disk task directories. */
    async getKnownTaskIds(): Promise<Set<string>> {
        await this.getEntries()
        const ids = new Set<string>(Object.keys(this.index))
        for (const dir of listTaskDirs(this.tasksDir)) {
            ids.add(path.basename(dir))
        }
        return ids
    }

    /**
     * Remove a single entry by ID.
     * @param id        The entry ID to remove.
     * @param saveToDisk If true (default), writes immediately.
     */
    async removeById(id: string, saveToDisk: boolean = true): Promise<boolean> {
        await this.getEntries()
        if (!(id in this.index)) return false
        delete this.index[id]
        if (saveToDisk) {
            this.setData({entries: Object.values(this.index)}, false)
            await this.save(false)
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
    async replaceId(id: string, entry: Record<string, unknown>, saveToDisk: boolean = true, validate: boolean = true): Promise<string | null> {
        await this.getEntries()
        if (validate) {
            const fullIndex = await this.getFullIndex()
            // Temporarily add the entry to the map for cross-reference validation
            fullIndex.set(id, entry)
            const result = validateHistoryItem(entry, fullIndex)
            if (result.errorCount > 0) {
                throw new Error(`Validation failed for index entry ${id}: ${result.issues.filter(i => i.severity === "error").map(i => i.message).join("; ")}`)
            }
        }

        this.index[id] = entry

        if (saveToDisk) {
            this.setData({entries: Object.values(this.index)}, false)
            return this.save(false)
        }
        return null
    }

    /**
     * Repair the index using a single unified merge algorithm.
     *
     * 1. Collects all task IDs from disk and current index.
     * 2. For each ID, merges disk history_item.json against the index entry
     *    using the spec v4 decision matrix.
     * 3. Cleans up cross-references (loops until stable).
     * 4. Reconciles childIds from other reference fields.
     * 5. Writes the result (unless dryRun).
     *
     * @param id      Optional: scope to a single task ID.
     * @param options Repair options (dryRun, backup).
     */
    async repair(id?: string, options: RepairOptions = {}): Promise<{
        items: Array<Record<string, unknown>>
        warnings: string[]
        replacedFromDisk: number
        backedUpToDisk: number
        written: boolean
        uiSyncMismatches: string[]
    }> {
        // Ensure the current index is loaded before merging
        await this.getEntries()

        const newIndex: Record<string, Record<string, unknown>> = {}
        const stats: RepairStats = {
            orphansDisk: 0,
            orphansIdx: 0,
            corruptDisk: 0,
            corruptIdx: 0,
            errorsDisk: 0,
            errorsIdx: 0,
            warningsDisk: 0,
            warningsIdx: 0,
            replacedFromDisk: 0,
        }
        const backedUp = new Set<string>()

        const diskIds = new Set(listTaskDirs(this.tasksDir).map(d => path.basename(d)))
        const allIds = new Set([...diskIds, ...Object.keys(this.index)])

        // Phase 1: Merge each ID
        for (const entryId of allIds) {
            // If scoped to a single ID, preserve other index entries as-is
            if (id !== undefined && entryId !== id) {
                if (this.index[entryId]) {
                    newIndex[entryId] = this.index[entryId]
                }
                continue
            }

            const disk = await this._readDiskEntry(entryId)
            const indexEntry = this.index[entryId] ?? null
            const result = await this._mergeEntry(entryId, indexEntry, disk, stats, backedUp, options)
            if (result) {
                newIndex[entryId] = result
            }
        }

        // Phase 2: Cross-reference cleanup (repeated until stable)
        await this._cleanupReferences(newIndex, backedUp, options)

        // Phase 3: Reference reconciliation
        this._reconcileChildIds(newIndex)

        this.index = newIndex

        const uiSyncMismatches = options.verifyUiSync
            ? await this._verifyUiSync(newIndex)
            : []

        const summary = this._formatSummary(stats)
        const warnings = summary ? [summary] : []

        if (!options.dryRun) {
            this.setData({entries: Object.values(newIndex)}, false)
            await this.save(false, options.backup !== false)
        }

        return {
            items: Object.values(newIndex),
            warnings,
            replacedFromDisk: stats.replacedFromDisk,
            backedUpToDisk: backedUp.size,
            written: !options.dryRun,
            uiSyncMismatches,
        }
    }

    /**
     * Read a task's history_item.json from disk.
     *
     * Returns null when the file is absent so callers can tell "no disk data"
     * apart from "present but invalid" — though readJsonFile's tolerant parse
     * also yields null for unreadable/corrupt JSON.
     */
    private async _readDiskEntry(id: string): Promise<Record<string, unknown> | null> {
        const hiPath = path.join(this.tasksDir, id, HISTORY_ITEM_NAME)
        if (!fs.existsSync(hiPath)) return null
        return await readJsonFile(hiPath) as Record<string, unknown> | null
    }

    /** Whether a task directory exists on disk — distinguishes `stale_entry` from `no_history_item`. */
    private _dirExists(id: string): boolean {
        return fs.existsSync(path.join(this.tasksDir, id))
    }

    /**
     * Merge one task ID's disk and index entries per the spec v4 decision
     * matrix, recording validation stats and scheduling backups for entries
     * that get removed.
     *
     * Rules (in priority order):
     *  - Disk perfect (0 errors, 0 warnings)        → use disk data.
     *  - Disk imperfect + index perfect              → keep the index entry.
     *  - Disk imperfect + index imperfect            → back up the index entry, drop both.
     *  - Disk imperfect + no index entry             → skip (do not add to index).
     *  - Disk absent + index present                 → back up the index entry, drop it
     *    (reason is `no_history_item` or `stale_entry` depending on the directory).
     *
     * Returns the entry to keep, or null when the ID must be removed from the index.
     */
    private async _mergeEntry(
        id: string,
        indexEntry: Record<string, unknown> | null,
        diskEntry: Record<string, unknown> | null,
        stats: RepairStats,
        backedUp: Set<string>,
        options: RepairOptions,
    ): Promise<Record<string, unknown> | null> {
        if (!diskEntry && !indexEntry) return null

        const diskResult = diskEntry ? validateHistoryItem(diskEntry) : null
        const idxResult = indexEntry ? validateHistoryItem(indexEntry) : null

        // Update stats
        if (!diskEntry && indexEntry) stats.orphansIdx++
        if (diskEntry && !indexEntry) stats.orphansDisk++
        if (diskResult && diskResult.errorCount > 0) stats.corruptDisk++
        if (idxResult && idxResult.errorCount > 0) stats.corruptIdx++
        if (diskResult) {
            stats.errorsDisk += diskResult.errorCount
            stats.warningsDisk += diskResult.warningCount
        }
        if (idxResult) {
            stats.errorsIdx += idxResult.errorCount
            stats.warningsIdx += idxResult.warningCount
        }

        const diskPerfect = diskResult !== null && diskResult.errorCount === 0 && diskResult.warningCount === 0
        const idxPerfect = idxResult !== null && idxResult.errorCount === 0 && idxResult.warningCount === 0

        // A clean disk entry always wins — it is the freshest authoritative data.
        if (diskPerfect) {
            stats.replacedFromDisk++
            return diskEntry
        }

        if (diskEntry) {
            // Disk has data but is imperfect; keep the index only if it is perfect.
            if (idxPerfect) {
                return indexEntry
            }

            // Both imperfect: preserve the index entry in a backup, then remove it.
            if (idxResult) {
                await this._backupIfNeeded(id, indexEntry!, "both_corrupt", backedUp, options)
                return null
            }

            // Disk imperfect, no index entry → nothing trustworthy to keep.
            return null
        }

        // diskEntry is null
        if (indexEntry) {
            const reason = this._dirExists(id) ? "no_history_item" : "stale_entry"
            await this._backupIfNeeded(id, indexEntry, reason, backedUp, options)
            return null
        }

        return null
    }

    /**
     * Nullify dangling cross-references, looping until a full pass makes no
     * changes — clearing one entry's reference can make another entry's
     * reference dangle in turn.
     *
     * Entries are never removed here: only their dangling reference fields are
     * cleared (and each modification is backed up first).
     *
     * Special case: when `awaitingChildId` dangles, the task was left waiting
     * for a child that no longer exists. Mark it `interrupted` and clear both
     * `awaitingChildId` and `delegatedToId` — a delegated task is by definition
     * awaiting its child, so the two must be cleared together.
     */
    private async _cleanupReferences(
        index: Record<string, Record<string, unknown>>,
        backedUp: Set<string>,
        options: RepairOptions,
    ): Promise<void> {
        let changed = true

        while (changed) {
            changed = false

            for (const [entryId, entry] of Object.entries(index)) {
                const dangling = this._findDanglingRefs(entry, index)
                if (dangling.length === 0) continue

                const hasAwaitingDangling = dangling.some(d => d.field === "awaitingChildId")

                if (hasAwaitingDangling) {
                    await this._backupIfNeeded(entryId, entry, "dangling_awaiting_child", backedUp, options)
                    entry.status = "interrupted"
                    entry.awaitingChildId = undefined
                    entry.delegatedToId = undefined
                    // awaitingChildId and delegatedToId were already cleared
                    // above (delegation implies awaiting), so skip them in the
                    // generic nullify loop to avoid redundant writes; still
                    // nullify any other dangling refs (e.g. parentTaskId).
                    for (const {field, refId} of dangling) {
                        if (field !== "awaitingChildId" && field !== "delegatedToId") {
                            this._nullifyRef(entry, field, refId)
                        }
                    }
                } else {
                    await this._backupIfNeeded(entryId, entry, "dangling_ref", backedUp, options)
                    for (const {field, refId} of dangling) {
                        this._nullifyRef(entry, field, refId)
                    }
                }

                changed = true
            }
        }
    }

    /**
     * List reference fields whose target ID does not exist in the index.
     * Scans the scalar reference fields plus every entry in childIds.
     */
    private _findDanglingRefs(
        entry: Record<string, unknown>,
        index: Record<string, Record<string, unknown>>,
    ): DanglingRef[] {
        const refs: DanglingRef[] = []
        const refFields = ["parentTaskId", "rootTaskId", "delegatedToId", "awaitingChildId", "completedByChildId"]

        for (const field of refFields) {
            const refId = entry[field]
            if (refId && typeof refId === "string" && !(refId in index)) {
                refs.push({field, refId})
            }
        }

        const childIds = entry.childIds as string[] | undefined
        if (childIds) {
            for (const childId of childIds) {
                if (!(childId in index)) {
                    refs.push({field: "childIds", refId: childId})
                }
            }
        }

        return refs
    }

    /**
     * Clear a single dangling reference. For `childIds` the specific ID is
     * filtered out of the array; for scalar reference fields the field is unset.
     *
     * Both `completed` and `interrupted` statuses require a parentTaskId, so
     * when a dangling parentTaskId is dropped the status would become invalid —
     * clear it as well to keep the entry self-consistent.
     */
    private _nullifyRef(entry: Record<string, unknown>, field: string, refId: string): void {
        if (field === "childIds") {
            const childIds = entry.childIds as string[] | undefined
            if (childIds) {
                entry.childIds = childIds.filter(cid => cid !== refId)
            }
        } else {
            entry[field] = undefined
            if (field === "parentTaskId" && (entry.status === "completed" || entry.status === "interrupted")) {
                entry.status = undefined
            }
        }
    }

    /**
     * After cleanup stabilizes, ensure every live child reference
     * (awaitingChildId / completedByChildId / delegatedToId) is also present in
     * childIds so the parent-child relationship stays navigable in the UI.
     *
     * The `childIds` key is only kept when at least one child is present;
     * entries without any children have the key removed entirely rather than
     * being left as an empty array.
     */
    private _reconcileChildIds(index: Record<string, Record<string, unknown>>): void {
        for (const [, entry] of Object.entries(index)) {
            const childIds = [...((entry.childIds as string[] | undefined) ?? [])]
            const refs = [entry.awaitingChildId, entry.completedByChildId, entry.delegatedToId]
            for (const ref of refs) {
                if (ref && typeof ref === "string" && ref in index && !childIds.includes(ref)) {
                    childIds.push(ref)
                }
            }

            if (childIds.length > 0) {
                entry.childIds = childIds
            } else {
                delete entry.childIds
            }
        }
    }

    /**
     * Write one `_index.{ts}.bak.json` per entry per repair run (first reason
     * wins). The backup carries `_removedReason`/`_removedAt` metadata.
     * Skipped entirely in dry-run; write failures are non-fatal.
     */
    private async _backupIfNeeded(
        id: string,
        entry: Record<string, unknown>,
        reason: string,
        backedUp: Set<string>,
        options: RepairOptions,
    ): Promise<void> {
        if (backedUp.has(id)) return
        backedUp.add(id)
        if (options.dryRun) return

        const backupPath = path.join(this.tasksDir, id, `${mapTypeToFileName("_index.task")}.${backupTimestamp}.bak.json`)
        const data = {...entry, _removedReason: reason, _removedAt: Date.now()}
        try {
            await safeWriteJson(backupPath, data, {keepBackup: true})
        } catch {
            // Backup failure is non-fatal; the repair continues
        }
    }

    /**
     * Cross-check ui_messages.json against the ACH-derived reconstruction for
     * each entry in the rebuilt index (parity with scan --verify-ui-sync).
     * Returns the task IDs whose ui_messages.json differs from the reconstruction.
     */
    private async _verifyUiSync(index: Record<string, Record<string, unknown>>): Promise<string[]> {
        const mismatches: string[] = []
        for (const [id, entry] of Object.entries(index)) {
            const corruption = await inspectTaskDir(id, path.join(this.tasksDir, id), entry as HistoryItem, {
                verifyUiSync: true,
                showWarnings: true,
            })
            if (corruption.reasons.some(r => r.reason === "ui_sync_mismatch")) {
                mismatches.push(id)
            }
        }
        return mismatches
    }

    /** Render the single-line warning summary from the accumulated stats. */
    private _formatSummary(stats: RepairStats): string {
        return `orphan: ${stats.orphansDisk} disk, ${stats.orphansIdx} index; corrupt: ${stats.corruptDisk} disk, ${stats.corruptIdx} index; errors: ${stats.errorsDisk} disk, ${stats.errorsIdx} index; warnings: ${stats.warningsDisk} disk, ${stats.warningsIdx} index`
    }

    private _getEntriesFromData(data: Record<string, unknown>): Array<Record<string, unknown>> {
        if (!data) return []
        if (Array.isArray(data)) return data as Array<Record<string, unknown>>
        return (data.entries as Array<Record<string, unknown>>) ?? []
    }
}
