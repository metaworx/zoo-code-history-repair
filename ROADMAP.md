# Roadmap

## Known Corruption Patterns (from Roo Code lineage)

The following failure modes are documented in the Roo Code / Zoo Code ecosystem and our tool addresses them:

| Pattern                                              | Our Coverage                                        |
|------------------------------------------------------|-----------------------------------------------------|
| `ui_messages.json` empty/truncated                   | ✔️ `empty_ui_messages` → rebuild from ACH           |
| `ui_messages.json` out of sync with ACH              | ✔️ `ui_sync_mismatch` detection (opt-in)            |
| `api_conversation_history.json` truncated to `[]`    | ✔️ `empty_api_history` detected; not recoverable    |
| `api_conversation_history.json` truncated mid-write  | ✔️ Partial JSON recovery via `readPartialJsonArray` |
| `history_item.json` `task` field lost/placeholder    | ✔️ Reconstruct from ACH                             |
| `history_item.json` `size` field incorrect           | ✔️ Recompute                                        |
| `_index.json` structure mismatch                     | ✔️ Fixed read + write                               |
| History disappearing from UI (index missing entries) | ✔️ `rebuild-index` + `folder_orphan` detection      |
| Cancel / resume race conditions (interrupted tasks)  | ✔️ `interrupted_task` detection                     |
| Gray-screen / unusable UI after large JSON           | ⚠️ Not yet addressed (needs Zoo Code-side fix)      |
| Schema-level validation (30+ checks, 5 file types)   | ✔️ `validate` command + auto-registered validators   |
| Safe file writes with concurrent modification check  | ✔️ `JsonFileTransaction` atomic write + snapshot     |
| Validator-driven corruption detection                | ✔️ `inspectTaskDir` delegates to validators          |
| `repairIndex` — validate index entries vs disk       | ✔️ Replace from disk or backup + remove              |
| Cancel / resume race conditions                      | ⚠️ Not yet addressed (needs Zoo Code-side fix)      |
| Concurrent writes to task files                      | ⚠️ Not yet addressed (needs Zoo Code-side fix)      |

## Future Directions

### Plugin Integration

- [x] Use real Zoo Code TypeScript types (`ClineMessage`, `ApiMessage`, etc.) via optional dependency
- [x] Reuse Zoo Code's `safeWriteJson` / path helpers where available
- [ ] Contribute a "Repair Task History" command to the JetBrains plugin
- [ ] Register as a VS Code extension command (via Extension Host)
- [ ] In-IDE notification when corruption is detected on task open

### Preventive Measures

- [ ] File watcher — detect corruption as it happens (file size drops to 0, invalid JSON on write)
- [ ] Automatic backup rotation — keep last N versions of task JSON files
- [ ] Integrity checks on task save — verify `ui_messages.json` consistency before writing
- [ ] Health dashboard — visual report of storage health in IDE

### Ship

- [x] Comprehensive test suite against real corrupted task directories
- [ ] CI pipeline with cross-platform testing (Windows, Linux, macOS)
- [ ] npm package publication
- [ ] Documentation site / wiki

## Design Principles

1. **Library-first** — all logic lives in `src/lib/`, callable without CLI
2. **Compact JSON** — matches Zoo Code's on-disk format exactly
3. **Non-destructive** — backup before write, dry-run always available
4. **Deterministic** — reconstruction produces byte-identical output given same input
5. **Self-contained** — minimal dependencies (only `commander` for CLI)
