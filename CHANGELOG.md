# Changelog

All notable changes to the **Zoo Code History Repair** (ZCHR) app will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
