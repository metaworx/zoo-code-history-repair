# Changelog

All notable changes to the **Zoo Code History Repair** (ZCHR) app will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `scan` and `list-corrupt`: summary line with file/error/warning counts (`12 files checked, 7 corrupted, 829 errors, 19 warnings`); `--no-summary` flag to suppress
- `scan` and `list-corrupt`: `--no-warnings` flag — suppresses warning-level corruption reasons (`zero_tokens`, `interrupted_task`, `ui_sync_mismatch`)
- `ScanResult` now includes `totalErrorCount`, `totalWarningCount`, `filesChecked`; `TaskCorruption` includes `errorCount`, `warningCount`
- `validate` command — JSON schema validation for all task storage files (`_index.json`, `history_item.json`, `api_conversation_history.json`, `ui_messages.json`, `task_metadata.json`), with optional `--warnings` flag
- Validation framework (`src/lib/validate/`) — per-file-type validators with machine-readable error codes, severity levels (error/warning), field paths, and cross-reference checks
- `history_item.json` validator — UUID format checks, required/optional field type checks, status-specific consistency rules (`delegated`→`delegatedToId` required, `active`→`awaitingChildId` forbidden), dangling reference detection against full index
- `_index.json` validator — structure checks (version, updatedAt, entries array), per-entry validation via `validateHistoryItem` with cross-reference id map
- `api_conversation_history.json` validator — turn structure checks (role, content array, block types)
- `ui_messages.json` validator — event structure checks (ts, type, say, text fields)
- `task_metadata.json` validator — minimal type guard (must be JSON object if present)
- `FileTransaction` / `JsonFileTransaction` classes — snapshot-based concurrent modification detection, validator pipeline, read/save/validate lifecycle with atomic tempfile writes
- `resolveTarget()` helper — resolves CLI target path against storage root with absolute/relative handling
- `getValidatorByFile()` — maps filename to validator function for automatic validator registration
- `readJsonFile`, `writeJsonCompact`, `backupFile` moved to new `src/lib/file.ts` module
- `vitest/globals` types added to `tsconfig.json`
- Command unit tests (`src/lib/__tests__/commands/`) — 8 test files (51 tests) covering all CLI command wrappers: import validity, parameter mapping from CLI options to library functions, and output formatting branches (dry-run/force, JSON/text, success/error)
- `contentHash()` utility — SHA1 checksum of JSON files with volatile fields (`updatedAt`, `ts`) stripped via `stripVolatile()`
- `IndexTransaction` class exported from library index (`src/index.ts`)
- Integration test: `repairTask.indexUpdate.spec.ts` — validate→repair-task→validate workflow with backup existence + checksum verification
- Shared test helpers (`src/lib/__tests__/testHelpers.ts`) — temp dir lifecycle, fixture copying, JSON I/O, backup listing, hash utilities, and `assertJsonEqual` with `normalizeJson` for deep comparison with path replacements, prop ignores, and `maxLength` truncation
- Full pipeline integration test (`src/lib/__tests__/integration/fullPipeline.spec.ts`) — 11-phase scan→repair→validate→idempotency cycle using CLI commands with text + `--json` output parsing, backup/hash verification, and fixture-based snapshot comparison
- Unrepairable task hint — `RepairResult.hint` field printed in `repair-task` and `repair-all` output suggesting `delete <taskId> --force` for tasks that cannot be repaired
- JSON fixture files for scan/list-corrupt snapshot comparison — `tests/fixtures/scan.before.json`, `scan.after.json`, `list-corrupt.before.json`, `list-corrupt.after.json`

### Changed

- `FileTransaction`: `read()` replaced by `load():this` + `getData():unknown` — fluid API; `load()` populates in-memory data and returns `this` for chaining with `setData()`/`save()`; `getData()` returns loaded data
- `IndexTransaction.load()` overrides parent to rebuild `this.index` from loaded `_index.json` entries after load
- `IndexTransaction.replaceId()` now returns the backup path (`string | null`); lazy-load guard via `this.getEntries()` prevents single-entry overwrite when called on fresh instance
- `IndexTransaction.removeById()` now ensures index is loaded via `this.getEntries()` guard (was silent no-op from empty index)
- `FileTransaction.load()` early-return fixed to return `this` instead of `this.data`
- `repairTaskDir` now captures backup paths from `JsonFileTransaction.save()` into `result.backups`
- `repair-task` command captures `_index.json` backup from `replaceId()`, merges with task backups, prints all
- `repairTaskDir` size recomputation moved after token repair — size now accounts for token/cache fields added during repair, making repair-task idempotent
- `zero_tokens` detection: now requires all three zero-field codes (`ZERO_TOKENS_IN`, `ZERO_TOKENS_OUT`, `ZERO_TOTAL_COST`) present — `totalCost` alone being 0 no longer triggers false positive
- All internal `.read()` call sites migrated to `.load().getData()` pattern
- `detectCorruption.ts` renamed to `validation.ts` — now hosts both corruption detection and the new validation framework (core types, helper factories, `validatePath()` entrypoint)
- `detectCorruptionV2.spec.ts` renamed to `validation.spec.ts` — renamed to match new module
- `readJson.ts` simplified to only export `readPartialJsonArray()` — all file I/O primitives moved to `file.ts`
- All consumers (`scan`, `rebuildIndex`, `repairAll`, `repairTask`, `scanOutput`, `delete`, `repairTask` commands) updated to import from `file.ts` instead of `readJson.ts`
- Library index (`src/index.ts`) re-exports point to `validation.ts` instead of `detectCorruption.ts`

### Removed

- `detectCorruption.spec.ts` — tests migrated to `file.spec.ts` (file I/O primitives) and `validation.spec.ts` (corruption detection + validation)

- Corruption reasons annotated with file source: `placeholder_task_name(hi,idx)`, `zero_size(hi)`, `interrupted_task(ach)`
- Abbreviation help in `list-corrupt` command (`additionalHelp`)
- `--json` flag on `scan` and `list-corrupt` — machine-parseable JSON output for CI/scripting
- `--quiet` flag on `scan` — suppress per-task detail, summary only
- `--verbose` flag on `repair-all` — show skipped (no-op) tasks
- ANSI color support — red dry-run messages, `--no-color` flag, `NO_COLOR` env var, TTY detection
- Version banner on every command output (included in JSON)
- `→` arrow notation in repair output: `ui(ach→uim)`, `task(ach→hi)`, `size(calc→hi)`, `tokens(source→hi)`
- Abbreviation docs in `additionalHelp`: `ach`, `hi`, `uim`, `idx`
- `alignSummary()` helper for flush-left summary blocks
- Integration test fixtures (`tests/fixtures/tasks/`) — 7 corrupt + 3 healthy task dirs scrambled for privacy
- Scramble script (`scripts/scramble-fixture.ts`) — copies from source, exact byte-length lorem ipsum replacement per field, substring index→ACH sync, auto-detects folder orphans, computes SHA1 hashes
- Scramble source generator (`scripts/generate_scramble.ts`) — fetches War & Peace + TypeScript checker.ts, produces ~535KB never-repeating mix
- Integration tests (`src/lib/__tests__/integration/`) — scan, repair, restore against real(istic) fixture data

### Changed

- `repair-all` output shows storage path and index rebuild summary
- `repair-task` / `repair-all` use `→` arrow notation instead of bare aspect names
- Non-zero exit codes: `scan` and `list-corrupt` exit with corruption count (capped at 255)
- Summary blocks (Storage/Tasks/Index) no longer indented

### Fixed

- Case-sensitive provider name lookup in `estimateTotalCost` / `estimateCacheReads` — PRICING keys were "DeepSeek" but `apiConfigName` is "deepseek" (lowercase), causing `totalCost` to always be 0 for DeepSeek providers; now normalizes provider to lowercase before lookup
- `restore` no longer creates safety backups before restoring — the `.bak.json` being restored from already serves as pre-restore backup; stops backup file proliferation on repeated restores
- `restore` is now idempotent — restoring the same backup twice is a no-op (content already matches backup)
- Integration test fixtures now strip stale `.bak.json` files before each test to prevent contamination from prior runs
- `rebuildIndexFromDisk` no longer indexes tasks without a valid `history_item.json` (`id` + `ts` required) — stale tasks will never end up in `_index.json`
- `repair-all` index-added/removed counts now compare old index against new index (not disk directories), eliminating misleading "+ added" for tasks not actually indexed
- `repair-all` and `repair-task` now rebuild `_index.json` after individual repairs — fixes `folder_orphan` and stale index entries
- `writeJsonCompact` uses atomic tempfile→rename (crash-safe writes)
- `scan` command no longer crashes on corrupted `ui_messages.json` fixtures — `countEntries` now uses tolerant `tx.read(false)` instead of throwing on validation failures
- Added 5 integration tests for scan output helpers (`countEntries`, `recoverabilityScore`) against scrambled fixture data
- `repair-all --verify-ui-sync` was silently ignored — option declared but never read from `cmdOpts` or passed to `repairAllCorrupted`; now wired through
- `repair-task` crashed when reading `_index.json` with dangling references — changed to tolerant `tx.read(false)`; index read is only for token recovery lookup, not validation
- `validate` command: error output no longer includes full stack trace; UUID targets (e.g. `validate <taskId>`) now resolve to the task directory under the storage root; task directory validation also checks the `_index.json` entry with cross-references against the full index
- `repair-task --force` now rebuilds `_index.json` from disk after successful repair, keeping the index in sync with repaired task files

## [0.4.0] — 2026-08-08

### Added

- `zero_tokens` CorruptionReason — detects tasks where `tokensIn`/`tokensOut`/`totalCost` are all 0 but ACH has entries
- `estimateTokens` module (`src/lib/estimateTokens.ts`) — `estimateTokensOut` (3.44 chars/token), `estimateTokensIn` (4.0 chars/token under-estimate), `estimateTotalCost` (provider pricing), `estimateCacheReads` (≈0.97×tokensIn)
- Token repair in `repairTaskDir` — priority: index recovery → estimation → `--fixed-input-token` user override
- `--fixed-input-token <n>` CLI flag (0=disable estimation, omit=estimate)
- `delete <taskId>` command — purge task directory from disk and strip entry from `_index.json`
- `restore` command — list, restore, or delete `.bak.json` backup files (safety backup on restore, `--delete` for cleanup, no timestamp mixing)
- `restore` library (`src/lib/restore.ts`) — `listBackups`, `restoreFromBackups`, `deleteBackups`, `parseTimestamp`
- `--force-uim` flag on `repair-task` — force `ui_messages.json` rebuild even when not detected as corrupt
- Scan output enrichments: recoverability %, `entries.ACH`, `entries.UIM`, aligned columns, blank lines between entries
- `list-corrupt` output now includes recoverability % as second tab-separated column
- `--force` flag on all write commands — dry-run is now the default
- `scanOutput` module (`countEntries`, `recoverabilityScore`, `align` helpers)
- `registerCommandOptions` prototype extension on commander `Command`
- CLI commands extracted to `src/lib/commands/` (one module per command) — `cli.ts` reduced from 285 to ~80 lines

### Changed

- `interrupted_task` detection: removed unreliable Trigger A (unanswered `attempt_completion` — normal child-task behavior), gated Trigger B behind multi-error check (solo `interrupted_task` suppressed)
- Backup files now use `$base.json.YYYYMMDD-HHmmss.bak.json` format (e.g. `history_item.json.20260808-054500.bak.json`) instead of epoch-ms naming — enables `*.bak.json` glob discovery
- `RepairResult` now includes `touchedFiles` and `backups` — repair output shows which files changed and lists backup files created
- `repairAll` passes index entries through to `repairTaskDir` for token recovery
- Corruption detection now covers 13 patterns (up from 12)

## [0.3.0] — 2026-08-08

### Added

- `truncate()` and `taskMatch()` format helpers in `src/lib/format.ts` (17 unit tests)
- Corruption reasons documentation in `scan` command help via `.addHelpText('after', ...)`, including
  the two type-declared but not-yet-produced reasons (`invalid_json`, `missing_task_dir`)

### Changed

- `scan` output keys renamed to `task.index` / `task.file` / `task.match` / `size.index` / `size.file`
- Task fields truncated to 200 characters with `...` ellipsis in scan output
- `task.match: YES/NO` field added to scan output (case-sensitive trimmed comparison; omitted when either task is absent)

## [0.2.1] — 2026-08-08

### Added

- Vitest test runner configuration (`vitest.config.ts`) with `globals: true`, v8 coverage provider, `*.spec.ts` pattern
- Comprehensive test suite: 11 spec files, 120 tests, 0 failures covering all 9 library modules:
    - `detectCorruption.spec.ts` (7 tests): `isPlaceholderTaskName`, `inspectTaskDir` — existing
    - `detectCorruptionV2.spec.ts` (12 tests): v0.2.0 features — `verifyUiSync` mismatch, `interrupted_task` (unmatched `attempt_completion`, last-turn `tool_use`), `missing_task_text`
    - `rebuildIndex.spec.ts` (3 tests): `rebuildIndexFromDisk` — dry-run, backup, skip-empty
    - `scan.spec.ts` (3 tests): `scanStorage` — orphan detection, index/disk consistency
    - `readJson.spec.ts` (20 tests): `readJsonFile`, `readPartialJsonArray` truncated recovery, `writeJsonCompact`, `backupFile`
    - `rebuildUiMessages.spec.ts` (25 tests): `snakeToCamel`, `rebuildUiMessages` — all 6 block types (text, reasoning, tool_use, tool_result, image), MCP descriptors, ts monotonicity, multi-turn reconstruction
    - `rebuildTaskField.spec.ts` (12 tests): `extractTaskFromApiHistory` — multi-block concatenation, first-user-turn-only
    - `size.spec.ts` (9 tests): `compactSizeBytes`, `computeTaskSize` determinism
    - `paths.spec.ts` (13 tests): constants, `resolveTasksDir`, `resolveIndexPath`, `listTaskDirs` filtering (dot-prefixed, files vs dirs)
    - `repairTask.spec.ts` (12 tests): full repair pipeline — ui rebuild, task extraction, size recomputation, dry-run, backup, partial ACH recovery, error paths
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
