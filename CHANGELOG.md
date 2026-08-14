# Changelog

All notable changes to the **Zoo Code History Repair** (ZCHR) app will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Adopted tabs + Prettier** — reformatted all TypeScript sources and the `tests/` tooling to tab indentation
  (new [`.prettierrc.json`](.prettierrc.json): `useTabs`, no semicolons, `printWidth: 120`), updated
  [`.editorconfig`](.editorconfig) and linting docs, removed trailing semicolons, and sentence-cased error messages.

## [0.8.0] — 2026-08-14

### Added

- **`SPECIFICATION.md`** — new root-level consolidated specification (commands, repair/recovery algorithms,
  backup/restore model, detection model, file I/O and validation models, per-field recoverability format),
  including the architecture flowcharts moved out of [`README.md`](README.md); README slimmed to a concise
  overview with a link to the spec.
- **`--force-rebuild-hi`** — rebuilds a missing `history_item.json` from ACH + backups instead of returning
  "cannot repair" (`id` from the task dir, `ts`/`task`/`size` recovered, remaining fields via backup-source recovery).
- **Structured per-field recoverability** — `scan`/`list-corrupt` now report `{source, confidence, estimatedValue}`
  per recoverable field (sources: `ach` | `index` | `backup` | `default` | `none`) in `scan --json` and as a compact
  human summary, replacing the coarse recoverability percentage.
- **`invalid_json` / `missing_task_dir` detection** — the two previously-dead corruption reasons are now emitted:
  `invalid_json` when a task file (`history_item.json`, `ui_messages.json`, `api_conversation_history.json`,
  `task_metadata.json`, or `_index.json`) fails to parse; `missing_task_dir` when an `_index.json` entry references
  a task ID with no on-disk directory.
- **`--verify-ui-sync` on `rebuild-index`** — the UI-sync cross-check now runs during index rebuild, achieving
  parity with `scan`/`repair-all`.
- **Reference-field recovery** (`resolveReferences`) — recovers corrupted `parentTaskId`/`delegatedToId`/
  `childIds`/`awaitingChildId` from own ACH → cross-task index → backups → unset, with status reconciliation that
  marks incomplete delegated tasks as `interrupted`.
- **Interrupted-task repair** — appends a synthetic failed `tool_result` for interrupted tasks, strips
  `environment_details`, maps failed results to `say error`, skips successful results, and emits `newTask` rows so
  View-task links survive the `ui_messages` rebuild.
- **`restore` enhancements** — `--type` filter (`history_item`, `ui_messages`, `api_conversation_history`,
  `task_metadata`, `_index`, `_index.task`, `all`); `_index.task.{ts}.bak.json` restores to `history_item.json`
  (stripping `_removedReason`/`_removedAt`); `--diff` flag for field-by-field JSON diff; safety backup for
  `history_item` restores; restored entries re-added to the global index.
- **Backup deduplication** — `consolidateBackups()` removes backups identical to the target file or duplicate backups
  via content hash.
- **`zod` dependency declared** — `zod` 3.25.76 added to `dependencies` with a version-parity test against
  `@roo-code/types` (`deps.spec.ts`).
- **AI agent guidance + test tooling** — `AGENTS.md`/`.aiassistant/` docs and `tests/npm-test-tail.mjs`,
  `tests/jsdoc-fix-header.mjs` tooling with `test:tail`/`header:check`/`header:fix` scripts.

### Changed

- **Unified `repair` command** — merged `rebuild-index`, `repair-task`, and `repair-all` into a single
  `repair` command with mode selectors `repair --index`, `repair <taskId>`, and `repair --all`. Exactly one
  mode selector is required; any other combination errors with usage.
- **`scan --short`** — folded `list-corrupt` into `scan` as `scan --short` (compact task-id lines and JSON mode).
- **Backup naming formalized** — `_index.task.{ts}.bak.json` for per-task index-entry extracts and
  `_index.json.{ts}.bak.json` for the full index-file backup; `restore --type` help now enumerates these values.
- **Warnings polarity** — warnings are now shown by default everywhere; `--no-warnings` hides them (`validate`
  inverted from the old opt-in `--warnings`).
- **`IndexTransaction.repair`** — rewritten around a unified merge algorithm (spec v4 decision matrix); the
  `--from-disk` flag was removed and cross-reference cleanup nullifies dangling refs instead of removing entries.
- **Field recovery with defaults** — missing/zero fields now search backup sources in priority order (index entry →
  task backups → root index backups) and fall back to defaults (`mode: "unknown"`, `workspace: os.homedir()`,
  `apiConfigName: "unknown"`, `number: 1`).
- **Dropped bogus `parentTaskId` requirement** — top-level completed tasks and abandoned interrupted children are no
  longer flagged by incorrect repair heuristics.
- **`_index.task` backups** — routed through `consolidateBackups` so duplicate index-entry backups are deduplicated.

### Fixed

- **`validateIndex` auto-registration** — `IndexTransaction` no longer suppresses the index validator with a `[]`
  validators argument, restoring automatic `_index.json` validation.
- **Backup rename propagation** — `JsonFileTransaction._write()` mutated a copied options object, leaving backups as
  `.bak_*.tmp`; it now mutates in place so the `.bak.json` rename and consolidation propagate correctly.
- **`rebuild-index` backup path printout** — now prints the actual `backupTimestamp`-derived path instead of a
  freshly-generated timestamp.
- **`_nullifyRef` status-clear** — nullifying a dangling `parentTaskId` now nullifies the reference only and keeps
  the entry's status.
- **Fixture scrambling** — UUID values are now preserved (detected by value, not just by key name) so fixture ACH can
  exercise reference recovery; fixtures regenerated with a valid `awaitingChildId`.

### Removed

- `rebuild-index`, `repair-task`, `repair-all`, and `list-corrupt` command names (no backwards compatibility).
- `--from-disk` flag on index repair (superseded by the unified merge algorithm).

## [0.7.1] — 2026-08-11

### Changed

- **Full async I/O migration** — all file operations now use `fs.promises` with native async/await.
  Removed the `deasync` dependency that previously wrapped `safeWriteJson` into a synchronous `saveFile`.
  All I/O functions now return `Promise` and propagate up through `FileTransaction`, `JsonFileTransaction`,
  `IndexTransaction`, library modules (`restore`, `validation`, `scan`, `repairTask`, `repairAll`), and
  all 8 CLI command handlers.
- **`FileTransaction` API** — `load()`, `save()`, `_read()`, `_write()` now return `Promise`.
  `validate()` stays synchronous but requires `await load()` first. `setData()` remains synchronous.
- **`inspectTaskDir` parallelization** — validates `history_item.json`, `api_conversation_history.json`,
  and `ui_messages.json` in parallel via `Promise.all`.
- **`cli.ts`** — extracted `runAction()` helper for async error handling following Zoo-Code CLI pattern.

### Fixed

- **`rebuild-index` concurrent modification** — `repair()` writes `_index.json` to disk, which changes
  mtime/size. The command previously called `save()` with a stale snapshot, causing a spurious
  "Concurrent modification detected" error. Now prints confirmation messages without a redundant write.
- **`validateAndMap` warning filtering** — warnings (including `EMPTY_ARRAY` for empty arrays) were
  prematurely filtered out, causing `inspectTaskDir` to miss `empty_ui_messages` / `empty_api_history` corruption reasons.

### Removed

- **`deasync` dependency** — no longer needed; all I/O is native async.

## [0.7.0] — 2026-08-11

### Added

- **`safeWriteJson` integration** — vendored Zoo Code's atomic JSON write utility (`src/lib/io/safeWriteJson.ts`) with
  inter-process locking (`proper-lockfile`), streaming serialization (`json-stream-stringify`), temp-file + atomic
  rename, and backup-before-overwrite with rollback. Two extensions: `stringify` option (bypass streaming for
  pre-serialized strings) and `keepBackup` option (return backup path instead of deleting).
- **`saveFile`** — sync wrapper around `safeWriteJson` using `deasync`, replacing `saveFileWithSnapshot`. Maintains
  snapshot-based concurrent modification detection with post-write `FileSnapshot` return.
- **`SaveFileOptions`** interface — `snapshot`, `stringify`, `backup` options for controlling write behavior.
- **`io/` directory** — `src/lib/io/` for I/O primitives: `safeWriteJson.ts`, `readJson.ts` (moved from `src/lib/`).

### Changed

- `FileTransaction._write()` / `JsonFileTransaction._write()` — now delegate through `saveFile()` with `stringify`
  option propagation via `super._write()`.
- `FileTransaction.save()` — generates backup path and passes to `saveFile()` via `options.backup`; removed
  `backupFile()` call.
- `readJson.ts` moved to `src/lib/io/readJson.ts`; all imports updated.

### Removed

- `writeJsonCompact()` — replaced by `saveFile()` with `stringify: true`.
- `backupFile()` — replaced by `safeWriteJson`'s rename-before-overwrite + `saveFile`'s rename to `.bak.json`.
- `saveFileWithSnapshot()` — renamed and reimplemented as `saveFile()`.

### Dependency Additions

- `json-stream-stringify` ^3.1.6, `proper-lockfile` ^4.1.2, `deasync` ^0.1.31, `@types/proper-lockfile`,
  `@types/deasync`

## [0.6.0] — 2026-08-11

### Added

- **Zod validation integration** — replaced hand-rolled field validators (~300 lines) with Zoo Code's canonical Zod
  schemas from `@roo-code/types` v1.115.0
- `src/lib/validate/zod.ts` — translation helper: `zodIssueToValidationIssue()`, `zodResultToValidationResult()`,
  `safeParseAsWarning()`; converts Zod's binary success/failure to our `ValidationResult` with error/warning distinction
- `taskMetadataSchema` — new Zod schema for `task_metadata.json` (Zoo Code has none); validates `files_in_context` array
  with optional top-level passthrough for forward compatibility
- `historyItemForRepair` schema — extends Zoo's `historyItemSchema` with `.extend()` (makes `size`/`workspace`/`mode`/
  `apiConfigName` required, adds `"interrupted"` to `status` enum) and `.superRefine()` for corruption heuristics
  (PLACEHOLDER_TASK, ZERO_SIZE, zero tokens, status consistency, UUID validation)
- `indexSchema` with `entriesWithRefs` — `.superRefine()` on entries array for duplicate detection + cross-reference
  validation (dangling `parentTaskId`/`delegatedToId`/`childIds`/etc.), replaces manual `idMap` loop
- `uiMessageEventSchema` — Zod per-event schema aligned with Zoo Code's 28 `say` values and 11 `ask` values (from
  `rooCodeEventsSchema`), replacing the old hand-rolled text/reasoning/tool-only check
- `achTurnSchema` / `contentBlockSchema` — Zod message-content validation for `api_conversation_history.json`

### Changed

- `@roo-code/types` ^1.115.0 added as runtime dependency; `zod` 3.25.76 is transitive via the types package (our direct
  `zod` dependency was removed to match Zoo's exact version)
- `issueToReason()` now handles Zod's `invalid_type` error code on the `task` field, mapping it to `missing_task_text`
- `rebuildIndexFromDisk` now correctly computes `size` from actual on-disk file sizes (previously left corrupted 0
  values)
- Validator error codes changed: structural errors now use Zod's built-in codes (`invalid_type`, `invalid_enum_value`)
  instead of custom codes (`MISSING_ID`, `INVALID_TYPE`, etc.); `.superRefine()` custom issues retain our codes via
  `params.code`
- `validate` command: per-entry `_index.json` validation now runs the same full historyItem validator as disk items,
  doubling error/warning counts for tasks corrupted in both index and disk

### Fixed

- `task_metadata.json` now properly validated against its schema (previously accepted any object)
- 4 fixture files updated: `_index.rebuilt.json` (corrected `size: 1766515`), `scan.before.json` and
  `list-corrupt.before.json` (reordered `zero_size`/`zero_tokens` to match new source ordering)

## [0.5.0] — 2026-08-10

### Added

- `validate` command — JSON schema validation for all task storage files (`_index.json`, `history_item.json`,
  `api_conversation_history.json`, `ui_messages.json`, `task_metadata.json`), with optional `--warnings` flag
- Validation framework (`src/lib/validate/`) — per-file-type validators with machine-readable error codes, severity
  levels (error/warning), field paths, and cross-reference checks
- `FileTransaction` / `JsonFileTransaction` classes — snapshot-based concurrent modification detection, validator
  pipeline, `load()`/`getData()`/`save()` lifecycle with atomic tempfile writes
- `IndexTransaction` class — extends `JsonFileTransaction` with index-aware guards, `replaceId()` backup tracking,
  `removeById()` lazy-load safety; exported from library index
- `resolveTarget()` helper — resolves CLI target path against storage root with absolute/relative handling
- `getValidatorByFile()` — maps filename to validator function for automatic validator registration
- `contentHash()` utility — SHA1 checksum of JSON files with volatile fields (`updatedAt`, `ts`) stripped via
  `stripVolatile()`
- `scan` and `list-corrupt`: summary line with file/error/warning counts
  (`12 files checked, 7 corrupted, 829 errors, 19 warnings`); `--no-summary` flag to suppress; `--no-warnings` flag to
  suppress warning-level reasons
- `--json` flag on `scan` and `list-corrupt` — machine-parseable JSON output for CI/scripting
- `--quiet` flag on `scan` — suppress per-task detail, summary only
- `--verbose` flag on `repair-all` — show skipped (no-op) tasks
- ANSI color support — red dry-run messages, `--no-color` flag, `NO_COLOR` env var, TTY detection
- Version banner on every command output (included in JSON output)
- `→` arrow notation in repair output: `ui(ach→uim)`, `task(ach→hi)`, `size(calc→hi)`, `tokens(source→hi)`
- Corruption reasons annotated with file source: `placeholder_task_name(hi,idx)`, `zero_size(hi)`,
  `interrupted_task(ach)`
- `alignSummary()` helper for flush-left summary blocks
- Unrepairable task hint — `RepairResult.hint` field printed in `repair-task` and `repair-all` output suggesting
  `delete <taskId> --force` for tasks that cannot be repaired

### Changed

- `zero_tokens` detection: now requires all three zero-field codes (`ZERO_TOKENS_IN`, `ZERO_TOKENS_OUT`,
  `ZERO_TOTAL_COST`) present — `totalCost` alone being 0 no longer triggers false positive
- `repairTaskDir` size recomputation moved after token repair — size now accounts for token/cache fields added during
  repair, making repair-task idempotent
- `repair-task` output now includes `_index.json` backup path when the index entry is updated
- `repair-all` output shows storage path and index rebuild summary
- Non-zero exit codes: `scan` and `list-corrupt` exit with corruption count (capped at 255)
- Summary blocks (Storage/Tasks/Index) no longer indented (flush-left)
- Corruption detection module renamed `detectCorruption.ts` → `validation.ts` (library re-exports unchanged)

### Fixed

- Case-sensitive provider name lookup in `estimateTotalCost` / `estimateCacheReads` — PRICING keys were "DeepSeek" but
  `apiConfigName` is "deepseek" (lowercase), causing `totalCost` to always be 0 for DeepSeek providers; now normalizes
  provider to lowercase before lookup
- `writeJsonCompact` now uses atomic tempfile→rename (crash-safe writes)
- `restore` no longer creates safety backups before restoring — the `.bak.json` being restored from already serves as
  pre-restore backup; stops backup file proliferation on repeated restores
- `restore` is now idempotent — restoring the same backup twice is a no-op (content already matches backup)
- `rebuildIndexFromDisk` no longer indexes tasks without a valid `history_item.json` (`id` + `ts` required) — stale
  tasks will never end up in `_index.json`
- `repair-all` index-added/removed counts now compare old index against new index (not disk directories), eliminating
  misleading "+ added" for tasks not actually indexed
- `repair-all` and `repair-task` now rebuild `_index.json` after individual repairs — fixes `folder_orphan` and stale
  index entries
- `scan` command no longer crashes on corrupted `ui_messages.json` — `countEntries` now uses tolerant read instead of
  throwing on validation failures
- `repair-all --verify-ui-sync` was silently ignored — option declared but never read from `cmdOpts` or passed to
  `repairAllCorrupted`; now wired through
- `repair-task` crashed when reading `_index.json` with dangling references — changed to tolerant read; index read is
  only for token recovery lookup, not validation
- `validate` command: error output no longer includes full stack trace; UUID targets (e.g. `validate <taskId>`) now
  resolve to the task directory under the storage root; task directory validation also checks the `_index.json` entry
  with cross-references against the full index

### Removed

- `detectCorruption.spec.ts` — tests migrated to `file.spec.ts` (file I/O primitives) and `validation.spec.ts`
  (corruption detection + validation)

## [0.4.0] — 2026-08-08

### Added

- `zero_tokens` CorruptionReason — detects tasks where `tokensIn`/`tokensOut`/`totalCost` are all 0 but ACH has entries
- `estimateTokens` module (`src/lib/estimateTokens.ts`) — `estimateTokensOut` (3.44 chars/token), `estimateTokensIn`
  (4.0 chars/token under-estimate), `estimateTotalCost` (provider pricing), `estimateCacheReads` (≈0.97×tokensIn)
- Token repair in `repairTaskDir` — priority: index recovery → estimation → `--fixed-input-token` user override
- `--fixed-input-token <n>` CLI flag (0=disable estimation, omit=estimate)
- `delete <taskId>` command — purge task directory from disk and strip entry from `_index.json`
- `restore` command — list, restore, or delete `.bak.json` backup files (safety backup on restore, `--delete` for
  cleanup, no timestamp mixing)
- `restore` library (`src/lib/restore.ts`) — `listBackups`, `restoreFromBackups`, `deleteBackups`, `parseTimestamp`
- `--force-uim` flag on `repair-task` — force `ui_messages.json` rebuild even when not detected as corrupt
- Scan output enrichments: recoverability %, `entries.ACH`, `entries.UIM`, aligned columns, blank lines between entries
- `list-corrupt` output now includes recoverability % as second tab-separated column
- `--force` flag on all write commands — dry-run is now the default
- `scanOutput` module (`countEntries`, `recoverabilityScore`, `align` helpers)
- `registerCommandOptions` prototype extension on commander `Command`
- CLI commands extracted to `src/lib/commands/` (one module per command) — `cli.ts` reduced from 285 to ~80 lines

### Changed

- `interrupted_task` detection: removed unreliable Trigger A (unanswered `attempt_completion` — normal child-task
  behavior), gated Trigger B behind multi-error check (solo `interrupted_task` suppressed)
- Backup files now use `$base.json.YYYYMMDD-HHmmss.bak.json` format (e.g. `history_item.json.20260808-054500.bak.json`)
  instead of epoch-ms naming — enables `*.bak.json` glob discovery
- `RepairResult` now includes `touchedFiles` and `backups` — repair output shows which files changed and lists backup
  files created
- `repairAll` passes index entries through to `repairTaskDir` for token recovery
- Corruption detection now covers 13 patterns (up from 12)

## [0.3.0] — 2026-08-08

### Added

- `truncate()` and `taskMatch()` format helpers in `src/lib/format.ts` (17 unit tests)
- Corruption reasons documentation in `scan` command help via `.addHelpText('after', ...)`, including the two
  type-declared but not-yet-produced reasons (`invalid_json`, `missing_task_dir`)

### Changed

- `scan` output keys renamed to `task.index` / `task.file` / `task.match` / `size.index` / `size.file`
- Task fields truncated to 200 characters with `...` ellipsis in scan output
- `task.match: YES/NO` field added to scan output (case-sensitive trimmed comparison; omitted when either task is
  absent)

## [0.2.1] — 2026-08-08

### Added

- Vitest test runner configuration (`vitest.config.ts`) with `globals: true`, v8 coverage provider, `*.spec.ts` pattern
- Comprehensive test suite: 11 spec files, 120 tests, 0 failures covering all 9 library modules:
    - `detectCorruption.spec.ts` (7 tests): `isPlaceholderTaskName`, `inspectTaskDir` — existing
    - `detectCorruptionV2.spec.ts` (12 tests): v0.2.0 features — `verifyUiSync` mismatch, `interrupted_task` (unmatched
      `attempt_completion`, last-turn `tool_use`), `missing_task_text`
    - `rebuildIndex.spec.ts` (3 tests): `rebuildIndexFromDisk` — dry-run, backup, skip-empty
    - `scan.spec.ts` (3 tests): `scanStorage` — orphan detection, index/disk consistency
    - `readJson.spec.ts` (20 tests): `readJsonFile`, `readPartialJsonArray` truncated recovery, `writeJsonCompact`,
      `backupFile`
    - `rebuildUiMessages.spec.ts` (25 tests): `snakeToCamel`, `rebuildUiMessages` — all 6 block types (text, reasoning,
      tool_use, tool_result, image), MCP descriptors, ts monotonicity, multi-turn reconstruction
    - `rebuildTaskField.spec.ts` (12 tests): `extractTaskFromApiHistory` — multi-block concatenation,
      first-user-turn-only
    - `size.spec.ts` (9 tests): `compactSizeBytes`, `computeTaskSize` determinism
    - `paths.spec.ts` (13 tests): constants, `resolveTasksDir`, `resolveIndexPath`, `listTaskDirs` filtering
      (dot-prefixed, files vs dirs)
    - `repairTask.spec.ts` (12 tests): full repair pipeline — ui rebuild, task extraction, size recomputation, dry-run,
      backup, partial ACH recovery, error paths
    - `repairAll.spec.ts` (4 tests): `repairAllCorrupted` orchestration, dry-run, zero-corruption case
- npm scripts: `test`, `test:watch`, `test:coverage` using Vitest
- `vitest`, `@vitest/coverage-v8` devDependencies

## [0.2.0] — 2026-08-08

### Added

- `readPartialJsonArray()` — salvage readable elements from truncated JSON arrays by walking backward to find the last
  valid element boundary. Integrated as fallback in `repairTaskDir`.
- Cross-block task extraction — concatenate all text blocks in the first user turn before regex-matching
  `<user_message>` tags (handles split partial-streaming messages).
- Image block handling — produce `[Image: media/type]` text placeholder for image content blocks in `ui_messages.json`
  reconstruction.
- MCP tool descriptor enrichment — when tool name contains `mcp--`, include `serverName`, `toolName`, `arguments`,
  `maxResults`, `maxTokens` in the tool descriptor JSON.
- MCP resource-type result handling — serialize resource-type content blocks as JSON in tool result text.
- `ui_sync_mismatch` corruption reason — opt-in (`--verify-ui-sync`) comparison of existing `ui_messages.json` against
  ACH-derived reconstruction. Detects drift even when the file is non-empty.
- `interrupted_task` corruption reason — detect tasks where `attempt_completion` tool_use has no matching tool_result,
  or where the last assistant turn ends mid-tool_use.
- `InspectOptions`, `ScanOptions`, `PartialArrayResult` exported types.
- `readPartialJsonArray` exported from library index.

### Changed

- Corruption detection now covers 12 patterns (up from 10).
- ROADMAP.md restructured — "Current State" moved to CHANGELOG.md; table updated with new pattern coverage.
- `RepairResult` now includes `apiTruncated: boolean` field.
- `tsconfig.json` excludes `__test__` directories from build.

## [0.1.0] — 2026-08-08

### Added

- `scan` command — detect 10 corruption patterns across `_index.json` and task directories
- `list-corrupt` command — terse output of corrupted task IDs and reasons
- `rebuild-index` command — rebuild `_index.json` from `history_item.json` files on disk
- `repair-task <taskId>` command — repair a single task (ui_messages, task field, size field)
- `repair-all` command — scan and repair all corrupted tasks in one pass
- `rebuildUiMessages()` — reconstruct `ui_messages.json` from `api_conversation_history.json` with deterministic mapping
  rules (text, reasoning, tool_use, tool_result → text/reasoning/tool say types, snake_case → camelCase tool names,
  monotonic timestamps)
- `extractTaskFromApiHistory()` — extract original user prompt from `<user_message>` block in API history
- `compactSizeBytes()` / `computeTaskSize()` — compute correct `size` field as sum of compact UTF-8 byte sizes of all
  task JSON files
- `repairTaskDir()` — single-task repair orchestrator (ui + task + size)
- `repairAllCorrupted()` — batch repair (scan → fix all)
- `IndexFile` type — `{version: number, updatedAt: number, entries: HistoryItem[]}`
- `TASK_METADATA_NAME` constant in paths module
- Library-first architecture — all logic in `src/lib/`, thin CLI in `src/cli.ts`
- All JSON writes use compact format (single line, no whitespace)

### Fixed

- `scan.ts` read `_index.json` as `{items: [...]}` instead of correct `{entries: [...]}`, causing all task directories
  to falsely report as `folder_orphan`
- `rebuildIndex.ts` wrote a bare array instead of `{version: 1, updatedAt, entries: [...]}`, producing an index
  incompatible with Zoo Code
