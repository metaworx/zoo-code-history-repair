# Zoo Code History Repair

Scan and repair Zoo Code / Roo-code task history indexes and corrupted task metadata.

## Overview

Zoo Code stores task history as JSON files under `~/.zoo-code/globalStorage/wecode-ai.zoo-code/tasks/`. Each task directory contains:

| File | Purpose |
|------|---------|
| `history_item.json` | Task metadata (id, task prompt, token usage, size, etc.) |
| `api_conversation_history.json` | Full API conversation log (turns with content blocks) |
| `ui_messages.json` | UI-rendered message events (derived from API history) |
| `task_metadata.json` | Additional task context |
| `_index.json` | Global index of all tasks (`{version, updatedAt, entries: [...]}`) |

This tool detects and repairs common corruption patterns in these files.

## Quick Start

```bash
# Run directly (no install required)
npx zoo-code-history-repair scan

# Or install globally
npm install -g zoo-code-history-repair

# Scan for corruption
zoo-code-history-repair scan
zoo-code-history-repair scan --quiet                     # summary only
zoo-code-history-repair scan --json                      # machine-parseable JSON

# List corrupted task IDs only (with recoverability %)
zoo-code-history-repair list-corrupt
zoo-code-history-repair list-corrupt --json               # JSON array

# Validate task storage files against schema rules
zoo-code-history-repair validate                         # validate entire storage root
zoo-code-history-repair validate <file>                  # validate a specific file
zoo-code-history-repair validate --json                   # machine-parseable JSON
zoo-code-history-repair validate --warnings               # also show warning-level issues

# Repair a single task
zoo-code-history-repair repair-task <taskId>
zoo-code-history-repair repair-task <taskId> --force          # actually write
zoo-code-history-repair repair-task <taskId> --force-uim      # force ui_messages.json rebuild
zoo-code-history-repair repair-task <taskId> --fixed-input-token 50000  # override tokensIn

# Repair all corrupted tasks
zoo-code-history-repair repair-all --force
zoo-code-history-repair repair-all --verbose                  # show skipped tasks

# Rebuild the global index from disk
zoo-code-history-repair rebuild-index --force

# Delete a task directory + its _index entry
zoo-code-history-repair delete <taskId>
zoo-code-history-repair delete <taskId> --force               # actually delete

# Manage backup files
zoo-code-history-repair restore                              # list all backups
zoo-code-history-repair restore <taskId>                      # restore newest backup
zoo-code-history-repair restore <taskId> <timestamp>          # restore specific timestamp
zoo-code-history-repair restore <timestamp>                   # restore all tasks matching ts
zoo-code-history-repair restore --delete <taskId> --force     # delete backups
```

All write commands default to dry-run. Use `--force` to actually apply changes.
Dry-run messages are colorized red. Disable colors with `--no-color` or `NO_COLOR=1`.

```bash
# Print version information
zoo-code-history-repair --version       # "Zoo Code History Repair, v0.6.0"
zoo-code-history-repair --version-only  # "0.6.0"
```

All commands have detailed help available via `help <command>` (e.g. `zoo-code-history-repair help scan`).

### Scripting / CI Integration

`scan` and `list-corrupt` support `--json` for machine-parseable output and exit with non-zero
when corruption is detected (exit code = corruption count, capped at 255):

```bash
# Check for corruption in CI
zoo-code-history-repair scan --json --quiet && echo "All clean"

# Parse corruption details
zoo-code-history-repair scan --json | jq '.corruptions[] | {id: .taskId, reasons: .reasons}'
```

> **Tip:** Use `npx` to run the latest version without installing globally. Ideal for one-off repairs or CI pipelines.

## Validation

The `validate` command checks task storage files against comprehensive schema rules. It produces structured, machine-readable issue reports with error codes, severity levels, and dotted field paths:

```bash
# Validate everything
zoo-code-history-repair validate

# Validate a specific file
zoo-code-history-repair validate ~/.zoo-code/.../_index.json

# JSON output for CI
zoo-code-history-repair validate --json --warnings
```

Each validated file type uses Zod schemas (from `@roo-code/types` or our own extensions) with corruption heuristics layered via `.superRefine()`:

| File | Validates |
|------|-----------|
| `_index.json` | `version`=1, `updatedAt` (finite number), `entries` array, per-entry Zod parsing via `historyItemSchema` + cross-reference integrity via `.superRefine()` (dangling `parentTaskId`/`delegatedToId`/`childIds`/etc.) |
| `history_item.json` | Zoo Code's canonical `historyItemSchema` extended with `.superRefine()` for corruption heuristics: placeholder task names, zero fields, UUID validation, status consistency (`delegated`→`delegatedToId`, `active`→`awaitingChildId` forbidden, `"interrupted"` status added) |
| `api_conversation_history.json` | Array structure, turn-level `role` ("user"/"assistant"), `content` array with Zod block validation, interrupted task detection |
| `ui_messages.json` | Array structure, Zod per-event schema aligned with Zoo Code's 28 `say` values and 11 `ask` values, optional fields (`partial`, `reasoning`, `images`, etc.) |
| `task_metadata.json` | Zod schema for `files_in_context` array (path, record_state, record_source, timestamps) with optional top-level passthrough |

All validators produce errors (invalid data) and warnings (suspicious but non-fatal). Use `--warnings` to see both; by default only errors are shown.

## Corruption Detection

The `scan` command detects these corruption patterns:

| Reason | Description |
|--------|-------------|
| `placeholder_task_name` | `task` field matches "Task #N" / "Task #N (Incomplete)" pattern |
| `zero_size` | `size` field is 0 or null/missing |
| `missing_task_text` | Disk `task` field is empty or whitespace-only |
| `missing_history_item` | `history_item.json` does not exist or is unreadable |
| `invalid_json` | (not yet produced) A JSON file is syntactically invalid or truncated |
| `missing_task_dir` | (not yet produced) Index entry has no corresponding task directory |
| `empty_ui_messages` | `ui_messages.json` is an empty array |
| `empty_api_history` | `api_conversation_history.json` is an empty array |
| `index_orphan` | Entry in `_index.json` has no matching task directory on disk |
| `folder_orphan` | Task directory exists on disk but is absent from `_index.json` |
| `ui_sync_mismatch` | (opt-in) `ui_messages.json` differs from ACH-derived reconstruction |
| `interrupted_task` | Task appears interrupted (last turn ends with `tool_use` + other corruption) |
| `zero_tokens` | `tokensIn`/`tokensOut`/`totalCost` all 0 but `api_conversation_history.json` has entries |

Run `zoo-code-history-repair help scan` for detailed explanations of each reason.

## Repair Capabilities

### `ui_messages.json` Reconstruction

Rebuilds the complete `ui_messages.json` from `api_conversation_history.json` using deterministic mapping rules:

| API block type | Role | UI `say` | Payload |
|---------------|------|----------|---------|
| `text` | user | `text` | Raw text |
| `text` | assistant | `text` | Raw text |
| `reasoning` | assistant | `reasoning` | Raw text |
| `tool_use` | assistant | `tool` | JSON descriptor with camelCase tool name |
| `tool_result` | user | `tool` | Concatenated result content |

Tool names are normalized from `snake_case` to `camelCase`. Timestamps are derived from turn-level `ts` with monotonic +1ms increments.

### `task` Field Extraction

Extracts the original user prompt from the first `<user_message>...</user_message>` block in `api_conversation_history.json`.

### Token Field Recovery

Recovers `tokensIn`/`tokensOut`/`totalCost`/`cacheReads` when zeroed out. Priority:

1. **Index recovery** — copy from `_index.json` backup (exact)
2. **Estimation** — output tokens from ACH assistant text (3.44 chars/token), input tokens from ACH user text (4.0 chars/token under-estimate), cost from provider pricing
3. **User override** — `--fixed-input-token <n>` to set tokensIn explicitly; `--fixed-input-token 0` to disable estimation

### `size` Field Calculation

Computes the correct `size` value as the sum of compact UTF-8 byte sizes of all JSON files in the task directory:

```
size = compactBytes(ui_messages) + compactBytes(api_history) + compactBytes(history_item) + compactBytes(task_metadata)
```

## Architecture

### Validation Infrastructure

```mermaid
flowchart TB
    subgraph Validators["File-Type Validators (src/lib/validate/)"]
        direction TB
        V1["validateHistoryItem — Zod schema + corruption heuristics"]
        V2["validateIndex — structure + cross-references"]
        V3["validateApiConversationHistory — turns, roles, blocks"]
        V4["validateUiMessages — events, say/text, ts"]
        V5["validateTaskMetadata — JSON object"]
        V6["validateUiSync — cross-file ui vs ACH"]
        V7["validateInterruptedTask — tool_use pattern"]
    end

    subgraph FileIO["File I/O (src/lib/file.ts)"]
        direction TB
        F1["FileTransaction: snapshot→read, validate→write, atomic rename"]
        F2["JsonFileTransaction: JSON parse/write + auto-validator"]
        F3["backupFile / writeJsonCompact / readJsonFile"]
    end

    subgraph Detection["Corruption Detection (src/lib/validation.ts)"]
        direction TB
        D1["inspectTaskDir — validator-driven"]
        D2["validatePath — root or single file"]
        D3["getValidatorByFile — filename→ValidatorFn"]
        D4["issueToReason — ValidationIssue→CorruptionReason"]
    end

    DetCmd["validate CLI"] --> D2
    D2 --> FileIO
    FileIO --> Validators
    D1 --> FileIO
    D1 --> Validators
```

### `scanStorage` + `inspectTaskDir` (Detection)

```mermaid
flowchart TB
    subgraph scan["scanStorage(storageRoot)"]
        direction TB
        A["JsonFileTransaction → read _index.json"]
        A --> B["listTaskDirs → dirs"]
        A --> C["Build Map id→HistoryItem"]
        B --> D{"For each dir"}
        D --> E["→ inspectTaskDir"]
        E --> F{"byId.has?"}
        F -->|no| G["folder_orphan"]
        F -->|yes| H{"reasons?"}
        G --> H
        H -->|yes| I["push corruption"]
        H -->|no| J["skip"]
        I --> D
        J --> D
        D -->|done| K["Check index_orphan"]
        K --> L["Return ScanResult"]
    end

    scan --> inspect

    subgraph inspect["inspectTaskDir(taskId, dir, indexItem, opts)"]
        direction TB
        M["validateAndMap: FileTransaction.validate() on hi, ACH, ui"]
        M --> N["Map issues→CorruptionReason"]
        N --> O{"verifyUiSync?"}
        O -->|yes| P["validateUiSync(reconstructed, ui)"]
        O -->|no| Q["skip"]
        P --> Q
        Q --> R["validateInterruptedTask(ACH)"]
        R --> S["Check indexItem: placeholder, zero_size"]
        S --> T["Solo interrupted_task→clear"]
        T --> U["Return TaskCorruption"]
    end
```

### `repairTaskDir` (Repair)

```mermaid
flowchart TB
    subgraph repair["repairTaskDir(taskDir, options)"]
        direction TB
        A["JsonFileTransaction ×4 → tolerant reads"]
        A --> B{"ACH valid?"}
        B -->|no| C["readPartialJsonArray"]
        C --> D{"recovered?"}
        D -->|no| E["unrepairable=true → return"]
        D -->|yes| F["partial ACH"]
        B -->|yes| F
        F --> G["R-2: inspectTaskDir → reasons"]
        G --> H{"empty_ui or forceUim?"}
        H -->|yes| I["rebuildUiMessages→uiTx.save"]
        H -->|no| J["skip ui"]
        I --> J
        J --> K{"historyItem?"}
        K -->|no| L["return"]
        K -->|yes| M{"placeholder? (R-1)"}
        M -->|yes| N["extractTask→taskRepaired"]
        M -->|no| O["skip task"]
        N --> O
        O --> P{"size wrong?"}
        P -->|yes| Q["recompute→sizeRepaired"]
        P -->|no| R["skip size"]
        Q --> R
        R --> S{"tokens=0 && ACH? (R-5)"}
        S -->|yes| T["index→override→estimate"]
        S -->|no| U["skip tokens"]
        T --> U
        U --> V{"modified && !dry?"}
        V -->|yes| W["backup+hiTx.save"]
        V -->|no| X["Return RepairResult"]
        W --> X
    end
```

### `repairAllCorrupted` (repair-all)

```mermaid
flowchart TB
    subgraph ra["repairAllCorrupted(storageRoot, opts)"]
        direction TB
        A["scanStorage(root, {verifyUiSync})"]
        A --> B["R-6: scan.indexItems"]
        B --> C{"For each corruptId"}
        C --> D["→repairTaskDir"]
        D --> E{"unrepairable? (R-8)"}
        E -->|yes| F["unrepairable++"]
        E -->|no| G{"fixed>0?"}
        G -->|yes| H["repaired++"]
        G -->|no| I["failed++"]
        F --> C
        H --> C
        I --> C
        C -->|done| J["→rebuildIndexFromDisk"]
        J --> K["indexAdded/Removed"]
        K --> L["Return RepairAllResult"]
    end
```

### `rebuildIndexFromDisk`

```mermaid
flowchart TB
    subgraph ri["rebuildIndexFromDisk(storageRoot, opts)"]
        direction TB
        A["listTaskDirs"]
        A --> B{"For each dir"}
        B --> C["JsonFileTransaction→read hi"]
        C --> D["R-3: validateHistoryItem→warnings"]
        D --> E{"disk.id+ts?"}
        E -->|yes| F["push items[]"]
        E -->|id only| G["push {ts:0}"]
        E -->|no| H["skip"]
        F --> B
        G --> B
        H --> B
        B -->|done| I["sort newest first"]
        I --> J{"dryRun?"}
        J -->|yes| K["Return {items, warnings}"]
        J -->|no| L["writeJsonCompact→_index.json"]
        L --> M["Return {items, backupPath, warnings}"]
    end
```

### `repairIndex`

```mermaid
flowchart TB
    subgraph rpi["repairIndex(storageRoot, indexItems, opts)"]
        direction TB
        A{"For each entry"}
        A --> B["validateHistoryItem(idx) vs disk"]
        B --> C{"idx clean?"}
        C -->|yes| D["keep"]
        C -->|no, disk valid| E["replace from disk"]
        C -->|both corrupt| F["backup→disk, remove"]
        D --> A
        E --> A
        F --> A
        A -->|done| G["Return {items, warnings, counters}"]
    end
```

### Command: `scan`

```mermaid
flowchart TB
    A["scan [--verify-ui-sync] [--json] [--quiet]"] --> B["resolveRoot → scanStorage"]
    B --> C{"--json?"}
    C -->|yes| D["JSON output → exit(min(corruptions,255))"]
    C -->|no| E["Print banner + summary"]
    E --> F{"--quiet?"}
    F -->|no| G["Per-task detail → exit"]
    F -->|yes| G
```

### Command: `list-corrupted`

```mermaid
flowchart TB
    A["list-corrupted [--verify-ui-sync] [--json]"] --> B["resolveRoot → scanStorage"]
    B --> C{"--json?"}
    C -->|yes| D["JSON array → exit(min(corruptions,255))"]
    C -->|no| E["Print taskId recoverability reasons → exit"]
```

### Command: `rebuild-index`

```mermaid
flowchart TB
    A["rebuild-index [--force] [--no-backup]"] --> B["resolveRoot → rebuildIndexFromDisk"]
    B --> C["Print 'Rebuilt index with N items'"]
    C --> D{"--force?"}
    D -->|no| E["Print dry-run warning"]
    D -->|yes| F["Print written path + backup path"]
```

### Command: `repair-task`

```mermaid
flowchart TB
    A["repair-task <id> [--force] [--no-backup] [--force-uim] [--fixed-input-token N]"] --> B["resolveRoot → read index → repairTaskDir"]
    B --> C{"errors?"}
    C -->|yes| D["Print errors → done"]
    C -->|no| E["formatRepairParts → '[DRY-RUN] would repair X' | 'repaired X'"]
    E --> F["Print backups + dry-run msg"]
```

### Command: `repair-all`

```mermaid
flowchart TB
    A["repair-all [--force] [--no-backup] [--verbose] [--fixed-input-token N] [--verify-ui-sync]"] --> B["resolveRoot → repairAllCorrupted"]
    B --> C["Print 'Found N corrupted tasks'"]
    C --> D["Per-task: [DRY-RUN] X | UNREPAIRABLE | FAILED"]
    D --> E{"indexEntries>0?"}
    E -->|yes| F["Print '_index.json rebuilt: N (+added, -removed)'"]
    E -->|no| G["skip"]
    F --> H["Print 'Repaired: N, Unrepairable: N, Failed: N' + dry-run"]
    G --> H
```

### Command: `validate`

```mermaid
flowchart TB
    A["validate [<file>] [--root <path>] [--json] [--warnings]"] --> B["validatePath(target, root)"]
    B --> C{"target dir?"}
    C -->|yes| D["FileTransaction.validate() on index + all task files"]
    C -->|no| E["FileTransaction.validate() on single file"]
    D --> F{"--json?"}
    E --> F
    F -->|yes| G["JSON {files: {path: ValidationResult}} → exit(1 if errors)"]
    F -->|no| H{"--warnings?"}
    H -->|yes| I["errors + warnings per file"]
    H -->|no| J["errors only per file"]
    I --> K["exit(1 if any error-level issues)"]
    J --> K
```
## Development

### Integration Test Fixtures

Integration tests run against scrambled real-world task data in `tests/fixtures/tasks/`.
All text content is replaced with exact byte-length lorem ipsum while preserving
JSON structure and corruption patterns.

To regenerate fixtures from source:

```bash
npx tsx scripts/scramble-fixture.ts [<source-dir>] <taskId> [taskId...]
```

The script copies from Zoo Code storage (auto-detected from `~/.zoo-code` or
passed as first argument), scrambles all text fields with exact byte-length
replacement, and writes to `tests/fixtures/tasks/`. It also builds `_index.json`
and a `tests/fixtures/hashes.json` manifest with SHA1 hashes for repair
verification. Tasks not found in the source index are automatically treated as
folder orphans (excluded from output index).

The scramble source defaults to `tests/fixtures/scramble_mixed.txt`. To
regenerate it:

```bash
npx tsx scripts/generate_scramble.ts
```

This fetches War & Peace (Gutenberg) and TypeScript checker.ts (GitHub), mixes
them, and writes a ~535KB file. On error (no internet), the scramble script
falls back to embedded lorem ipsum.

Run integration tests:

```bash
npx vitest run src/lib/__tests__/integration/
```

## Library API

All functionality is available programmatically — useful for IDE plugin integration:

```typescript
import {
    scanStorage,
    IndexTransaction,
    repairTaskDir,
    repairAllCorrupted,
    rebuildUiMessages,
    extractTaskFromApiHistory,
    computeTaskSize,
    compactSizeBytes,
} from "zoo-code-history-repair"
```

## File Format Notes

- All JSON files use **compact format** (single line, no whitespace between tokens)
- `_index.json` structure: `{"version": 1, "updatedAt": <millis>, "entries": [...]}`
- `history_item.json` fields are mirrored in `_index.json` entries
- Tool names in `ui_messages.json` use camelCase (e.g., `readFile`, `executeCommand`)

## License

MIT
