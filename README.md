# Zoo Code History Repair

Scan and repair Zoo Code / Roo-code task history indexes and corrupted task metadata.

## Overview

Zoo Code stores task history as JSON files under
`~/.zoo-code/globalStorage/wecode-ai.zoo-code/tasks/`. Each task directory
contains `history_item.json`, `api_conversation_history.json`, `ui_messages.json`,
`task_metadata.json`, plus a global `_index.json`. This tool detects and repairs
common corruption patterns across those files.

Full behavior — commands, repair algorithms, backup/restore model, detection
model, file I/O, validation, and architecture — is specified in
[`SPECIFICATION.md`](SPECIFICATION.md).

## Install

```bash
npm install -g zoo-code-history-repair
```

No install required for one-off use: prefix commands with `npx`:

```bash
npx zoo-code-history-repair scan
```

## Quick Start

```bash
# Scan for corruption
zoo-code-history-repair scan
zoo-code-history-repair scan --quiet     # summary only
zoo-code-history-repair scan --json      # machine-parseable JSON
zoo-code-history-repair list-corrup      # List corrupted task IDs only

# Rebuild the global index from disk
zoo-code-history-repair rebuild-index [--force]

# Repair a single task / all corrupted tasks (dry-run by default)
zoo-code-history-repair repair-task <taskId> [--force]
zoo-code-history-repair repair-all [--force]

# Delete a task directory + its _index entry
zoo-code-history-repair delete <taskId> [--force]           # actually delete

# Manage backup files
zoo-code-history-repair restore                             # list all backups
zoo-code-history-repair restore <taskId> [--force]          # restore newest backup
zoo-code-history-repair restore --delete <taskId> [--force] # delete backups
```

All write commands default to **dry-run**; pass `--force` to apply changes.
Dry-run messages are colorized red. Disable colors with `--no-color` or
`NO_COLOR=1`. `help <command>` shows detailed per-command help.

## Commands

| Command | One-liner |
|---|---|
| `scan` | Cross-reference `_index.json` vs task dirs and report corruption |
| `list-corrupt` | List only corrupted task IDs with recoverability % |
| `validate [file\|uuid]` | Validate task storage files against schema rules |
| `rebuild-index` | Rebuild `_index.json` from each task's `history_item.json` |
| `repair-task <taskId>` | Repair ui/task/size/tokens/refs/interrupted for one task |
| `repair-all` | Repair all corrupted tasks, then rebuild `_index.json` |
| `restore [taskId] [ts]` | List, restore, or delete backup files |
| `delete <taskId>` | Delete a task directory + its `_index` entry |

## Specification

See [`SPECIFICATION.md`](SPECIFICATION.md) for the full consolidated
specification.

## License

MIT
