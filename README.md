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
# Install
npm install -g zoo-code-history-repair

# Scan for corruption
zoo-code-history-repair scan

# List corrupted task IDs only
zoo-code-history-repair list-corrupt

# Repair a single task
zoo-code-history-repair repair-task <taskId>

# Repair all corrupted tasks
zoo-code-history-repair repair-all

# Rebuild the global index from disk
zoo-code-history-repair rebuild-index
```

All repair commands support `--dry-run` and `--no-backup` flags.

## Corruption Detection

The `scan` command detects these corruption patterns:

| Reason | Description |
|--------|-------------|
| `placeholder_task_name` | `task` field is "Task #N" or similar placeholder |
| `zero_size` | `size` field is 0 or missing |
| `missing_task_text` | `task` field is empty |
| `missing_history_item` | `history_item.json` does not exist |
| `invalid_json` | A JSON file cannot be parsed |
| `missing_task_dir` | Task directory referenced in index does not exist |
| `empty_ui_messages` | `ui_messages.json` is empty or missing |
| `empty_api_history` | `api_conversation_history.json` is empty or missing |
| `index_orphan` | Entry in `_index.json` has no matching task directory |
| `folder_orphan` | Task directory exists but is not in `_index.json` |

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

### `size` Field Calculation

Computes the correct `size` value as the sum of compact UTF-8 byte sizes of all JSON files in the task directory:

```
size = compactBytes(ui_messages) + compactBytes(api_history) + compactBytes(history_item) + compactBytes(task_metadata)
```

## Library API

All functionality is available programmatically — useful for IDE plugin integration:

```typescript
import {
    scanStorage,
    rebuildIndexFromDisk,
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
