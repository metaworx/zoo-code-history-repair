/**
 * @file src/lib/constants.ts
 *
 * Shared constants: UUID patterns, backup metadata field names, and timestamp plausibility.
 */

/** Matches every UUID-like token in a free-text string (global search). */
export const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** Anchored, case-insensitive match of a single UUID string. */
export const UUID_FULL_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Backup metadata written into `_index.task.*.bak.json` and stripped on restore. */
export const REMOVED_REASON_FIELD = "_removedReason"
export const REMOVED_AT_FIELD = "_removedAt"

/** All backup metadata field names, for bulk strip operations. */
export const BACKUP_META_FIELDS = [REMOVED_REASON_FIELD, REMOVED_AT_FIELD] as const

/** Lower bound for a plausible epoch-millisecond timestamp (2001-09-09T01:46:40Z). */
export const MIN_PLAUSIBLE_EPOCH_MS = 1_000_000_000_000
