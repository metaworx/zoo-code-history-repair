# AI Agent Commit Guidelines (v1.2.0)

This document defines the complete commit workflow, message format, and execution signals for AI agents. Follow these rules precisely when preparing and executing commits.

## Contents

1. Quick Reference Checklist
2. Commit Gate & Execution Signals
   - 2.1 EXEC Signal Mini-Matrix (Quick Decision) 
3. Commit Message Format (STRICT)
   - 3.1 Summary Line (Line 1)
   - 3.2 Empty Second Line (Line 2)
   - 3.3 Body (Line 3+)
   - 3.4 Trailer
4. Tag‑Specific Rules
   - 4.1 [CLEANUP] (Strict)
   - 4.2 [WIP] – Work in Progress
5. Functional Atomicity
6. Commit Tools (/.aiassistant/tools/)
   - 6.1 Workflow
7. Example Commit Message
8. Related References
9. Document History

## 1. Quick Reference Checklist

Before committing, verify:

- [ ] Functional atomicity: one logical change per commit.
- [ ] Summary line starts with a valid tag (`[TASK]`, `[FIX]`, `[SECURITY]`, `[CLEANUP]`, `[WIP]`, `[UPDATE]`).
- [ ] Line 2 is empty.
- [ ] Detailed body explains what changed and why.
- [ ] Commit message matches this repo's convention (no `Co-authored-by` trailer).
- [ ] Gate message sent and user confirmation received via `EXEC`-family signal.

---

## 2. Commit Gate & Execution Signals

Before executing `git commit`, the agent MUST present a **gate message** containing the complete proposed commit message and wait for user confirmation.

| Signal      | Scope                                                                                                                      |
|-------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| `EXEC`      | Commit **only** the currently gated changes (scope described in the gate message).                                |
| `EXEC+`     | Commit the gated changes **and continue** to the next planned step.                                           |
| `EXEC++`    | Commit **all staged files** (including those outside the gated scope). Adapt commit message.                      |
| `EXEC+++`   | Commit **all changed files** (`git add .` respecting ignore rules). Adapt commit message.                       |

- The gate message must follow the **Universal Gate Template** defined in [`AGENTS.md`](../AGENTS.md#11-gate-message-mechanism).
- The `Proposed commit message` field MUST contain the **full** commit message body (summary, empty line, details, trailer).

### 2.1 EXEC Signal Mini-Matrix (Quick Decision)

| Signal | Agent action | One-line example |
|--------|--------------|------------------|
| `EXEC` | Commit only gated scope. | `EXEC` |
| `EXEC+` | Commit gated scope, then continue plan. | `EXEC+ continue` |
| `EXEC++` | Commit all currently staged files, then continue. | `EXEC++ use staged set` |
| `EXEC+++` | Stage all changed files (`git add .`), commit, then continue. | `EXEC+++ include all changes` |

If signal is ambiguous, send a clarification gate and stop.

---

## 3. Commit Message Format (STRICT)

### 3.1 Summary Line (Line 1)
- Must start with one of the following tags enclosed in square brackets:
    - `[TASK]` - Features, logic changes, documentation updates.
    - `[FIX]` - Bug fixes.
    - `[SECURITY]` - Security fixes/hardening.
    - `[CLEANUP]` - **Formatting/layout-only** changes; **NO functional changes**.
    - `[WIP]` - Intermediate work-in-progress; leaves repo in "dirty" state.
    - `[UPDATE]` - Environment, dependency, or test-config updates.
- Maximum length: ~72 characters.

### 3.2 Empty Second Line (Line 2)
- **MUST be empty.** This separates the summary from the body.

### 3.3 Body (Line 3+)
- Explain **what** changed and **why**.
- Use bullet points for `Key changes` (when helpful).
- Be concise but complete.

### 3.4 Trailer
- This repository does **not** use a `Co-authored-by` trailer. The project history
  (human- and agent-authored commits) carries only the summary and body.
- Do not append a trailer unless the user explicitly requests one.

---

## 4. Tag-Specific Rules

### 4.1 `[CLEANUP]` (Strict)
- **Allowed:** Import reordering, whitespace normalization, code formatting, file reorganization.
- **NOT allowed:** Any change that alters runtime behavior (logic, control flow, data handling).

### 4.2 `[WIP] - Work in Progress
- Use for intermediate states (e.g., file renaming before heavy edits, saving state on a branch).
- A subsequent **non-`[WIP]`** commit MUST follow.
- The follow-up commit SHOULD reference the `[WIP]` commit by including a line like:
  ``g
  Follows [WIP] commit <hash>
  ```

---

## 5. Functional Atomicity

- One functional change per commit.
- Include **related code and tests** in the same commit.
- Do not bundle unrelated changes.

---

## 6. Commit Tools

Commits are made with plain `git` from the repository root (Windows shell: CMD.EXE).

### 6.1 Workflow

1. Write the complete commit message to `.aiassistant/tools/commit-msg.txt`.
2. Stage and commit:
   ```
   git add <files>
   git commit -F .aiassistant\tools\commit-msg.txt
   ```
3. Amend (only with its own gate + confirmation, AGENTS.md §1.3):
   ```
   git commit --amend -F .aiassistant\tools\commit-msg.txt
   ```

> Stage only the files in the gated scope — do not use `git add .` unless the user
> confirms an `EXEC+++` signal.

---

## 7. Example Commit Message

```
[TASK] Implement derivative validation flow and status handling

This commit introduces clearer synchronous validation in `Bild::checkFiles()` 
and improves derivative outcome branching for deterministic conflict resolution.

Key changes:
- Extracted focused status helpers used by `Bild::checkFiles()`.
- Simplified derivative outcome logic to avoid mixed-state false positives.
- Updated DB and contributor documentation.

Added 5 targeted tests covering mixed states and fallback handling.
All 25 tests pass, lint clean.
```

---

## 8. Related References

- [`AGENTS.md` commit policy](../AGENTS.md#6-commit-policy-strict) - High-level rules.
- [`CONTRIBUTING.md` commit rules](../../CONTRIBUTING.md#commit-rules) - Repository-specific examples.
- [`.aiassistant/tools/README.md`](tools/README.md) - Additional helper script details.

## 9. Document History

| Version | Date       | Changes                                                                 | Agent Impact                                                              |
|---------|------------|-------------------------------------------------------------------------|---------------------------------------------------------------------------|
| v1.3.0  | 2026-08-14 | §1, §3.4, §6, §7: dropped mandatory `Co-authored-by` trailer and FCIAS WSL git path; documented plain `git` workflow for this repo. | Commits match this repo's history (no trailer); agents use plain `git commit -F`. |
| v1.2.0  | 2026-08-05 | Added trailer mutual-exclusion warning and ask-user-first identity rule in §6.1.              | Prevents duplicate Co-authored-by trailers; ensures correct identity string.  |
| v1.1.0  | 2026-04-22 | Added `EXEC` signal mini-matrix with quick examples for faster commit confirmation.   | Improves commit signal clarity in user-agent interaction.                     |
| v1.0.0  | 2026-04-22 | Initial consolidated version from `AGENTS.md` v2.0.4 and `GUIDELINES.md`              | Use this document as the authoritative commit reference; gate signals clarified. |
