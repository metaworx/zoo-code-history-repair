# Roadmap

## Current State (v0.1.0)

✔️ `_index.json` structure fix (`{version, updatedAt, entries}`)  
✔️ Corruption detection — 10 patterns across index + task directories  
✔️ `ui_messages.json` reconstruction from `api_conversation_history.json`  
✔️ `task` field extraction from `<user_message>` in API history  
✔️ `size` field computation (compact UTF-8 sum of all task JSONs)  
✔️ Single-task repair (`repair-task <id>`)  
✔️ Batch repair (`repair-all`)  
✔️ Index rebuild from disk (`rebuild-index`)  
✔️ Library-first architecture (callable from IDE plugin)  
✔️ Compact JSON format (matches Zoo Code convention)  
✔️ Backup before write  
✔️ Dry-run mode  

## Known Corruption Patterns (from Roo Code lineage)

The following failure modes are documented in the Roo Code / Zoo Code ecosystem and our tool addresses them:

| Pattern | Our Coverage |
|---------|-------------|
| `ui_messages.json` empty/truncated | ✔️ `empty_ui_messages` → rebuild from ACH |
| `ui_messages.json` out of sync with ACH | ⚠️ Detected only if empty; full diff not implemented |
| `api_conversation_history.json` truncated to `[]` | ✔️ `empty_api_history` detected; not recoverable |
| `history_item.json` `task` field lost/placeholder | ✔️ Reconstruct from ACH |
| `history_item.json` `size` field incorrect | ✔️ Recompute |
| `_index.json` structure mismatch | ✔️ Fixed read + write |
| History disappearing from UI (index missing entries) | ✔️ `rebuild-index` + `folder_orphan` detection |
| Gray-screen / unusable UI after large JSON | ⚠️ Not yet addressed (needs Zoo Code-side fix) |
| Cancel / resume race conditions | ⚠️ Not yet addressed (needs Zoo Code-side fix) |
| Concurrent writes to task files | ⚠️ Not yet addressed (needs Zoo Code-side fix) |

## Future Directions

### v0.2.0 — Edge Cases & Robustness

- [ ] Handle partial/tool-use messages that span multiple ACH blocks
- [ ] Handle image content blocks in `api_conversation_history.json`
- [ ] Handle MCP tool results (currently treated as generic tool_result)
- [ ] Handle truncated `api_conversation_history.json` (partial JSON recovery)
- [ ] `ui_messages.json` sync verification — compare against ACH-derived events rather than just checking empty/non-empty
- [ ] Resume detection — flag tasks that were interrupted (cancel/restart) based on missing final `attempt_completion` tool result

### v0.3.0 — Plugin Integration

- [ ] Use real Zoo Code TypeScript types (`ClineMessage`, `ApiMessage`, etc.) via optional dependency
- [ ] Reuse Zoo Code's `safeWriteJson` / path helpers where available
- [ ] Contribute a "Repair Task History" command to the JetBrains plugin
- [ ] Register as a VS Code extension command (via Extension Host)
- [ ] In-IDE notification when corruption is detected on task open

### v0.4.0 — Preventive Measures

- [ ] File watcher — detect corruption as it happens (file size drops to 0, invalid JSON on write)
- [ ] Automatic backup rotation — keep last N versions of task JSON files
- [ ] Integrity checks on task save — verify `ui_messages.json` consistency before writing
- [ ] Health dashboard — visual report of storage health in IDE

### v1.0.0 — Ship

- [ ] Comprehensive test suite against real corrupted task directories
- [ ] CI pipeline with cross-platform testing (Windows, Linux, macOS)
- [ ] npm package publication
- [ ] Documentation site / wiki

## Design Principles

1. **Library-first** — all logic lives in `src/lib/`, callable without CLI
2. **Compact JSON** — matches Zoo Code's on-disk format exactly
3. **Non-destructive** — backup before write, dry-run always available
4. **Deterministic** — reconstruction produces byte-identical output given same input
5. **Self-contained** — minimal dependencies (only `commander` for CLI)
