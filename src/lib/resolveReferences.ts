/**
 * @file src/lib/resolveReferences.ts
 *
 * Reference-field and backup-source field recovery for corrupted history items.
 */

import fs from "node:fs"
import os from "node:os"

import { UUID_FULL_PATTERN, UUID_PATTERN } from "./constants.js"
import { estimateCacheReads, estimateTokensIn, estimateTokensOut, estimateTotalCost } from "./estimateTokens.js"

export type ReferenceSource = "ach" | "index" | "backup"

export interface ReferenceContext {
	/** Index entries keyed by task id, used for cross-task reference recovery. */
	fullIndex: Map<string, Record<string, unknown>>
	/** Known task ids, used to filter ACH free-text UUID candidates. */
	taskIds: Set<string>
	/** The task's own api_conversation_history.json, used for free-text UUID search. */
	ach: unknown[] | null
	/**
	 * Backup file paths (history_item / index backups). Entries that were
	 * removed from the live index still carry their reference fields here, so
	 * backups are the last-resort cross-task recovery source.
	 */
	backups?: string[]
}

export interface ReferenceRecovery {
	field: string
	source: ReferenceSource
}

export interface ReferenceResolution {
	entry: Record<string, unknown>
	changed: boolean
	recovered: ReferenceRecovery[]
}

function isUuidString(v: unknown): v is string {
	return typeof v === "string" && UUID_FULL_PATTERN.test(v)
}

/** A reference value is sound when it is a valid UUID that does not point at itself. */
function isSoundRef(v: unknown, self: string): boolean {
	return isUuidString(v) && v !== self
}

function entryHasChild(entry: Record<string, unknown> | undefined, childId: string): boolean {
	if (!entry) return false
	if (Array.isArray(entry.childIds) && entry.childIds.includes(childId)) return true
	return entry.delegatedToId === childId || entry.awaitingChildId === childId
}

function childrenOf(self: string, index: Map<string, Record<string, unknown>>): string[] {
	const children: string[] = []
	for (const [id, entry] of index) {
		if (entry.parentTaskId === self) children.push(id)
	}
	return children
}

function parentOf(self: string, index: Map<string, Record<string, unknown>>): string | null {
	for (const [id, entry] of index) {
		if (entryHasChild(entry, self)) return id
	}
	return null
}

/**
 * Walk the ACH object tree collecting, in first-appearance order, UUIDs that
 * are known tasks and not self. Walks the parsed structure directly instead of
 * building a duplicate string via JSON.stringify.
 */
function achCandidateUuids(ctx: ReferenceContext, self: string): string[] {
	if (!ctx.ach) return []
	const out: string[] = []
	const seen = new Set<string>()
	const visit = (node: unknown): void => {
		if (typeof node === "string") {
			const matches = node.match(UUID_PATTERN)
			if (!matches) return
			for (const id of matches) {
				if (seen.has(id)) continue
				seen.add(id)
				if (id !== self && ctx.taskIds.has(id)) out.push(id)
			}
		} else if (Array.isArray(node)) {
			for (const item of node) visit(item)
		} else if (node && typeof node === "object") {
			for (const value of Object.values(node)) visit(value)
		}
	}
	visit(ctx.ach)
	return out
}

/** Parse one backup file into a flattened array of entry objects (skips unreadable files). */
function readEntriesFromFile(p: string): Array<Record<string, unknown>> {
	let raw: string
	try {
		raw = fs.readFileSync(p, "utf8")
	} catch {
		return []
	}
	let data: unknown
	try {
		data = JSON.parse(raw)
	} catch {
		return []
	}
	const entries = Array.isArray(data)
		? data
		: data && typeof data === "object"
			? Array.isArray((data as Record<string, unknown>).entries)
				? ((data as Record<string, unknown>).entries as unknown[])
				: [data]
			: []
	const out: Array<Record<string, unknown>> = []
	for (const e of entries) {
		if (e && typeof e === "object" && !Array.isArray(e)) {
			out.push(e as Record<string, unknown>)
		}
	}
	return out
}

/** Parse backup files into a merged id → entry map for cross-reference lookups. */
function parseBackupEntries(paths: string[] | undefined): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>()
	for (const p of paths ?? []) {
		for (const rec of readEntriesFromFile(p)) {
			if (typeof rec.id === "string" && !map.has(rec.id)) map.set(rec.id, rec)
		}
	}
	return map
}

/**
 * Reconcile a task's status against its (possibly recovered) reference fields.
 *
 * - `delegated` missing any required reference (delegatedToId, awaitingChildId,
 *   non-empty childIds, completedByChildId, completionResultSummary) becomes
 *   `interrupted`, clearing delegatedToId and awaitingChildId.
 * - `active` carrying awaitingChildId has it unset.
 *
 * Returns true when the entry was modified.
 */
export function reconcileStatus(entry: Record<string, unknown>): boolean {
	if (entry.status === "delegated") {
		const missing =
			!entry.delegatedToId ||
			!entry.awaitingChildId ||
			!Array.isArray(entry.childIds) ||
			entry.childIds.length === 0 ||
			!entry.completedByChildId ||
			!entry.completionResultSummary
		if (missing) {
			entry.status = "interrupted"
			delete entry.delegatedToId
			delete entry.awaitingChildId
			return true
		}
		return false
	}
	if (entry.status === "active" && entry.awaitingChildId) {
		delete entry.awaitingChildId
		return true
	}
	return false
}

/**
 * Recover corrupted reference fields on a history item.
 *
 * Per-field priority (own ACH → cross-task index → backups → unset):
 * - `completedByChildId` / `childIds` / `delegatedToId`: own ACH UUID search first.
 * - `parentTaskId`: cross-task index first (entry whose childIds/delegatedToId
 *   references this task).
 * - `rootTaskId`: walk the recovered parent chain to the root, else unset.
 * - `awaitingChildId`: unset (no reliable recovery source).
 *
 * The entry is mutated in place; `changed` reports whether anything moved and
 * `recovered` lists every field that received a value from a recovery source.
 */
export function resolveReferences(entry: Record<string, unknown>, ctx: ReferenceContext): ReferenceResolution {
	const self = typeof entry.id === "string" ? entry.id : ""
	const recovered: ReferenceRecovery[] = []
	let changed = false

	const backupEntries =
		ctx.backups && ctx.backups.length > 0
			? parseBackupEntries(ctx.backups)
			: new Map<string, Record<string, unknown>>()
	const achCandidates = achCandidateUuids(ctx, self)
	const lookupParent = (id: string): Record<string, unknown> | undefined =>
		ctx.fullIndex.get(id) ?? backupEntries.get(id)

	const unset = (field: string): void => {
		if (field in entry) {
			delete entry[field]
			changed = true
		}
	}

	const resolveChildScalar = (field: "completedByChildId" | "delegatedToId"): void => {
		const current = entry[field]
		if (current === undefined || current === null) return
		if (isSoundRef(current, self)) return

		const achPick = achCandidates.length > 0 ? achCandidates[achCandidates.length - 1] : undefined
		if (achPick) {
			entry[field] = achPick
			recovered.push({ field, source: "ach" })
			changed = true
			return
		}

		const indexChildren = childrenOf(self, ctx.fullIndex)
		if (indexChildren.length > 0) {
			entry[field] = indexChildren[indexChildren.length - 1]
			recovered.push({ field, source: "index" })
			changed = true
			return
		}

		const backupChildren = childrenOf(self, backupEntries)
		if (backupChildren.length > 0) {
			entry[field] = backupChildren[backupChildren.length - 1]
			recovered.push({ field, source: "backup" })
			changed = true
			return
		}

		unset(field)
	}

	if (entry.childIds !== undefined) {
		const current = entry.childIds
		const sound = Array.isArray(current) && current.every((id) => isSoundRef(id, self))
		if (!sound) {
			let next: string[] | null = null
			let source: ReferenceSource | null = null
			if (achCandidates.length > 0) {
				next = achCandidates
				source = "ach"
			} else {
				const indexChildren = childrenOf(self, ctx.fullIndex)
				if (indexChildren.length > 0) {
					next = indexChildren
					source = "index"
				} else {
					const backupChildren = childrenOf(self, backupEntries)
					if (backupChildren.length > 0) {
						next = backupChildren
						source = "backup"
					}
				}
			}
			if (next && next.length > 0) {
				entry.childIds = next
				recovered.push({ field: "childIds", source: source! })
				changed = true
			} else {
				unset("childIds")
			}
		}
	}

	resolveChildScalar("completedByChildId")
	resolveChildScalar("delegatedToId")

	if (entry.parentTaskId !== undefined && entry.parentTaskId !== null) {
		if (!isSoundRef(entry.parentTaskId, self)) {
			const indexParent = parentOf(self, ctx.fullIndex)
			if (indexParent) {
				entry.parentTaskId = indexParent
				recovered.push({ field: "parentTaskId", source: "index" })
				changed = true
			} else {
				const achParent =
					achCandidates.find((id) => entryHasChild(ctx.fullIndex.get(id), self)) ?? achCandidates[0]
				if (achParent) {
					entry.parentTaskId = achParent
					recovered.push({ field: "parentTaskId", source: "ach" })
					changed = true
				} else {
					const backupParent = parentOf(self, backupEntries)
					if (backupParent) {
						entry.parentTaskId = backupParent
						recovered.push({ field: "parentTaskId", source: "backup" })
						changed = true
					} else {
						unset("parentTaskId")
					}
				}
			}
		}
	}

	if (entry.rootTaskId !== undefined && entry.rootTaskId !== null) {
		if (!isSoundRef(entry.rootTaskId, self)) {
			const seen = new Set<string>([self])
			let parent = entry.parentTaskId
			let root: string | undefined
			while (typeof parent === "string" && isSoundRef(parent, self) && !seen.has(parent)) {
				seen.add(parent)
				root = parent
				parent = lookupParent(parent)?.parentTaskId as string | undefined
			}
			if (root) {
				entry.rootTaskId = root
				recovered.push({ field: "rootTaskId", source: "index" })
				changed = true
			} else {
				unset("rootTaskId")
			}
		}
	}

	if (entry.awaitingChildId !== undefined && entry.awaitingChildId !== null) {
		if (!isSoundRef(entry.awaitingChildId, self)) {
			unset("awaitingChildId")
		}
	}

	if (reconcileStatus(entry)) changed = true

	return { entry, changed, recovered }
}

/** Source a recovered history-item field came from. */
export type FieldSource = "index" | "backup" | "default"

export interface FieldRecovery {
	field: string
	source: FieldSource
}

export interface FieldRecoveryContext {
	/** Live index entry for this task (priority source 1). */
	indexEntry?: Record<string, unknown> | null
	/** Task-level backup entries (`history_item.json.*` / `_index.task.*`), priority source 2. */
	taskBackups?: Array<Record<string, unknown>>
	/** Root `_index.json.*` backup entries for this task, priority source 3. */
	indexBackups?: Array<Record<string, unknown>>
}

export interface FieldRecoveryResult {
	entry: Record<string, unknown>
	changed: boolean
	recovered: FieldRecovery[]
}

const NUMERIC_FIELDS = ["tokensIn", "tokensOut", "totalCost", "cacheReads", "cacheWrites", "number"] as const
const SCALAR_FIELDS = ["mode", "workspace", "apiConfigName"] as const

const DEFAULT_SCALARS: Record<(typeof SCALAR_FIELDS)[number], () => string> = {
	mode: () => "unknown",
	workspace: () => os.homedir(),
	apiConfigName: () => "unknown",
}

/**
 * Read backup files into a flattened, order-preserving array of entries.
 * Accepts a bare entry object, an array of entries, or an `{entries: [...]}`
 * wrapper. Unreadable/unparseable files are skipped.
 */
export function readBackupEntries(paths: string[] | undefined): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = []
	for (const p of paths ?? []) {
		out.push(...readEntriesFromFile(p))
	}
	return out
}

export function positiveNumber(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null
}

export function nonEmptyString(v: unknown): string | null {
	return typeof v === "string" && v.trim() !== "" ? v : null
}

/** Source a token recovery came from. */
export type TokenRecoverySource = "index" | "estimate" | "user_override"

/** Token-related fields recoverTokens can write. */
export type TokenField = "tokensIn" | "tokensOut" | "totalCost" | "cacheReads" | "cacheWrites"

/** Provenance of a single recovered token field. */
export type TokenChangeSource = "index" | "ach" | "user_override" | "default"

export interface TokenRecoveryChange {
	field: TokenField
	from: TokenChangeSource
}

export interface TokenRecoveryResult {
	repaired: boolean
	source: TokenRecoverySource
	changes: TokenRecoveryChange[]
}

export interface RecoverTokensOptions {
	/** Live index entry for this task, used as the priority token source. */
	indexEntry?: {
		tokensIn?: number
		tokensOut?: number
		totalCost?: number
		cacheReads?: number
		cacheWrites?: number
	} | null
	/** The task's api_conversation_history.json, used for estimation. */
	ach: unknown[] | null
	/** User-supplied tokensIn override. 0 disables estimation (keeps zeros). */
	fixedInputToken?: number
}

/**
 * Repair token fields (`tokensIn`/`tokensOut`/`totalCost` plus cache fields)
 * on a history item whose token triple is all zero.
 *
 * Priority: index entry → user override → ACH estimation. After a successful
 * recovery, cache fields are filled (`cacheReads` estimated, `cacheWrites`
 * defaulted to 0). Mutates `entry` in place and reports whether, from where,
 * and which fields were recovered.
 */
export function recoverTokens(entry: Record<string, unknown>, opts: RecoverTokensOptions): TokenRecoveryResult {
	const changes: TokenRecoveryChange[] = []
	if (entry.tokensIn !== 0 || entry.tokensOut !== 0 || entry.totalCost !== 0) {
		return { repaired: false, source: "estimate", changes }
	}
	if (!Array.isArray(opts.ach) || opts.ach.length === 0) {
		return { repaired: false, source: "estimate", changes }
	}

	const ach = opts.ach
	const provider = entry.apiConfigName as string | undefined

	// Fill cache fields after a token recovery; no-op when tokensIn stayed 0.
	const fillCache = (): void => {
		if (positiveNumber(entry.tokensIn) === null) return
		if (positiveNumber(entry.cacheReads) === null) {
			const est = estimateCacheReads(entry.tokensIn as number, provider)
			entry.cacheReads = est
			if (positiveNumber(est) !== null) changes.push({ field: "cacheReads", from: "ach" })
		}
		if (entry.cacheWrites === undefined || entry.cacheWrites === null) {
			entry.cacheWrites = 0
			changes.push({ field: "cacheWrites", from: "default" })
		}
	}

	const idx = opts.indexEntry
	if (idx && typeof idx.tokensIn === "number" && idx.tokensIn > 0) {
		entry.tokensIn = idx.tokensIn
		changes.push({ field: "tokensIn", from: "index" })
		entry.tokensOut = idx.tokensOut ?? 0
		if (positiveNumber(idx.tokensOut) !== null) changes.push({ field: "tokensOut", from: "index" })
		entry.totalCost = idx.totalCost ?? 0
		if (positiveNumber(idx.totalCost) !== null) changes.push({ field: "totalCost", from: "index" })
		if (idx.cacheReads != null) entry.cacheReads = idx.cacheReads
		if (positiveNumber(idx.cacheReads) !== null) changes.push({ field: "cacheReads", from: "index" })
		if (idx.cacheWrites != null) entry.cacheWrites = idx.cacheWrites
		if (positiveNumber(idx.cacheWrites) !== null) changes.push({ field: "cacheWrites", from: "index" })
		fillCache()
		return { repaired: true, source: "index", changes }
	}

	if (opts.fixedInputToken !== undefined) {
		if (opts.fixedInputToken > 0) {
			const tokensIn = opts.fixedInputToken
			const tokensOut = estimateTokensOut(ach as Parameters<typeof estimateTokensOut>[0])
			entry.tokensIn = tokensIn
			changes.push({ field: "tokensIn", from: "user_override" })
			entry.tokensOut = tokensOut
			if (positiveNumber(tokensOut) !== null) changes.push({ field: "tokensOut", from: "ach" })
			entry.totalCost = estimateTotalCost(tokensIn, tokensOut, provider)
			if (positiveNumber(entry.totalCost) !== null) changes.push({ field: "totalCost", from: "ach" })
			fillCache()
			return { repaired: true, source: "user_override", changes }
		}
		// fixedInputToken === 0: explicitly skip estimation, keep zeros
		return { repaired: false, source: "estimate", changes }
	}

	const estOut = estimateTokensOut(ach as Parameters<typeof estimateTokensOut>[0])
	const estIn = estimateTokensIn(ach as Parameters<typeof estimateTokensIn>[0])
	if (estOut > 0 || estIn > 0) {
		entry.tokensOut = estOut
		if (estOut > 0) changes.push({ field: "tokensOut", from: "ach" })
		entry.tokensIn = estIn
		if (estIn > 0) changes.push({ field: "tokensIn", from: "ach" })
		entry.totalCost = estimateTotalCost(estIn, estOut, provider)
		if (positiveNumber(entry.totalCost) !== null) changes.push({ field: "totalCost", from: "ach" })
		fillCache()
		return { repaired: true, source: "estimate", changes }
	}

	return { repaired: false, source: "estimate", changes }
}

/**
 * Recover missing/zero history-item fields from backup sources with defaults.
 *
 * Priority order: live index entry → task backups → root `_index.json` backups
 * → defaults.
 *
 * - Numeric fields (`tokensIn`, `tokensOut`, `totalCost`, `cacheReads`,
 *   `cacheWrites`, `number`): highest non-zero value across sources (L2).
 *   `number` falls back to `1` when no source provides a positive value (L3).
 * - Scalar strings (`mode`, `workspace`, `apiConfigName`): first non-empty value
 *   across sources, else the configured default — `mode:"unknown"`,
 *   `workspace:os.homedir()`, `apiConfigName:"unknown"` (L3/L9).
 *
 * The entry is mutated in place; `changed` reports whether anything moved and
 * `recovered` lists each field and the source it was recovered from.
 */
export function recoverFields(entry: Record<string, unknown>, ctx: FieldRecoveryContext): FieldRecoveryResult {
	const recovered: FieldRecovery[] = []
	let changed = false

	const candidates: Array<{ source: FieldSource; entry: Record<string, unknown> }> = []
	if (ctx.indexEntry) candidates.push({ source: "index", entry: ctx.indexEntry })
	for (const e of ctx.taskBackups ?? []) candidates.push({ source: "backup", entry: e })
	for (const e of ctx.indexBackups ?? []) candidates.push({ source: "backup", entry: e })

	for (const field of NUMERIC_FIELDS) {
		if (positiveNumber(entry[field]) !== null) continue

		let best: number | null = null
		let bestSource: FieldSource = "backup"
		for (const { source, entry: srcEntry } of candidates) {
			const v = positiveNumber(srcEntry[field])
			if (v !== null && (best === null || v > best)) {
				best = v
				bestSource = source
			}
		}

		if (best !== null) {
			entry[field] = best
			recovered.push({ field, source: bestSource })
			changed = true
		} else if (field === "number") {
			entry[field] = 1
			recovered.push({ field, source: "default" })
			changed = true
		}
	}

	for (const field of SCALAR_FIELDS) {
		if (nonEmptyString(entry[field]) !== null) continue

		let found: string | null = null
		let foundSource: FieldSource = "backup"
		for (const { source, entry: srcEntry } of candidates) {
			const v = nonEmptyString(srcEntry[field])
			if (v !== null) {
				found = v
				foundSource = source
				break
			}
		}

		if (found !== null) {
			entry[field] = found
			recovered.push({ field, source: foundSource })
			changed = true
		} else {
			entry[field] = DEFAULT_SCALARS[field]()
			recovered.push({ field, source: "default" })
			changed = true
		}
	}

	return { entry, changed, recovered }
}
