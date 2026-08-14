# AI Agent Guidelines (v2.4.0)

Core behavioral rules for AI agents working on this codebase.  
All agents MUST comply.
This document is intentionally concise; refer to linked documents for extended guidance.

## Contents

1. Critical Behavioral Rules (STRICT)
2. Instruction Precedence (STRICT)
3. Task Interpretation & Keywords
4. User‑Accessible Message Files (UAMF)
5. Action Plan (AP)
6. Commit Policy (STRICT)
7. Additional References
8. Document Governance

## 1. Critical Behavioral Rules (STRICT)

### 1.1 Gate Message Mechanism

- A **gate message** is an `<answer>` (or idempotent) message that concludes the current turn and requests explicit user
  confirmation.
- After sending a gate message, the agent MUST **stop** — no further actions, shell commands, or status updates are
  permitted until the user responds with a new `<issue_update>`.
- The gate message MUST follow the **Universal Gate Template**:
    - `Checkpoint`
    - `Overall Task`
    - `Last Action`
    - `Pending action`
    - `Confirmation needed: EXEC/EXEC+/EXEC++/EXEC+++/ROLLBACK`
    - Additional information according to specialized gate message (e.g. AP or commit)
- A gate message is the **only** valid way to request user confirmation. Echoing "waiting for input" via shell commands
  is a **violation** of this rule.
- A visual workflow diagram is available in `.aiassistant/GATE_WORKFLOW.md`.

### 1.2 Action Plan (AP) Requirement

- Every non‑trivial `[CODE]` task requires an Action Plan.
- Full AP format and versioning rules are defined in [§5](#5-action-plan-ap).
- Each AP iteration MUST be persisted as a [UAMF](#4-useraccessible-message-files-uamf) **before** any project writes.
- Unless the execution is directly authorized by an `EXEC`‑family keyword in the same user message, the AP MUST be
  presented as a **gate message** (see [§1.1](#11-gate-message-mechanism)).

### 1.3 Commit Confirmation Gate

- Before `git commit`, the agent MUST present a gate message containing the complete proposed commit message.
- Commit‑related execution signals (`EXEC`, `EXEC+`, `EXEC++`, `EXEC+++`) and commit tools are detailed in [
  `.aiassistant/COMMIT.md`](.aiassistant/COMMIT.md).
- The gate message must follow the Universal Gate Template.

### 1.4 `undo_edit` Authorization (`ROLLBACK`)

- A rollback action (calling `undo_edit`) requires explicit user authorization.
- Authorization may be given via:
    - The keyword `ROLLBACK` in the user message, or
    - An `EXEC`‑family signal that clearly references the rollback.
- If authorization is absent, the agent MUST present a gate message requesting `ROLLBACK` or `EXEC` confirmation.

### 1.5 Safe File Edits

- **Do not delete and recreate files** when making large changes. Instead, write the new content to a temporary file and
  atomically replace the original (`mv` on Linux/macOS, `Move-Item` on Windows). This preserves local IDE history.
- Temporary files SHOULD be placed in `/.aiassistant/temp/`.
- Always prefer history‑preserving edit tools (e.g., `apply_patch`, in‑place edits) over raw shell writes.

## 2. Instruction Precedence (STRICT)

1. Runtime/system rules (conflicts noted explicitly).
2. Direct user instruction (current session).
3. This `AGENTS.md`.
4. Local conventions

**IMPORTANT:**

- Writing *new* [UAMF](#4-useraccessible-message-files-uamf) messages does NOT constitute a source-file edit.
- Same for writing to .aiassistant/temp to create temporary files during evaluation (e.g. a temporary test file)
- BOTH are explicitly ALLOWED also in PLANNING-ONLY mode.

### 2.1 Rule Map & Canonical Owners (STRICT)

| Need                                                                                      | Canonical location              |
|-------------------------------------------------------------------------------------------|---------------------------------|
| Gate lifecycle, pause behavior, mixed-signal gate handling, `ERR` recovery, gate template | `.aiassistant/GATE_WORKFLOW.md` |
| Commit gate and `EXEC+` variants in commit context, commit message format, commit tooling | `.aiassistant/COMMIT.md`        |
| Test depth and commands                                                                   | `.aiassistant/TESTING.md`       |
| Lint/style commands and policy                                                            | `.aiassistant/LINTING.md`       |
| Document governance rules and canonical history ownership                                 | `.aiassistant/CHANGELOG.md`     |
| AP requirements (`MUST`)                                                                  | `AGENTS.md` §1.2 and §5         |

If overlap exists, follow the canonical owner document for that rule family.

## 3. Task Interpretation & Keywords

- **`ASK`** – Standalone: Send `<answer>` in [chat] mode. Combined with other keywords: include answer in new gate
  message (if task-relevant) or with the result of the gated action.
- **`PLAN`** – Produce/update AP, present it, send gate message.
- **`EXEC`** – Execute gated action(s). For `EXEC+`-family see [`.aiassistant/COMMIT.md`](.aiassistant/COMMIT.md).
- **`ROLLBACK`** – Authorize an `undo_edit` action (see [§1.4](#14-undo_edit-authorization-rollback)).
- **`ERR`** – Apply recovery protocol (detailed in `.aiassistant/GATE_WORKFLOW.md`).
- **`UAMF`** – Instructs agent to write a [UAMF](#4-useraccessible-message-files-uamf) message file.

Latest `<issue_update>` overrides earlier `<issue_description>`.

### 3.1 First Response Contract

- Non-trivial `[CODE]` task without inline `EXEC`: produce AP, persist AP UAMF, send gate.
- If the same user message includes clear execution authorization (`EXEC` family): execute only the authorized scope.
- Before `git commit`: always send a commit gate with full proposed commit message.

## 4. User‑Accessible Message Files (UAMF)

- Store user‑visible artifacts in `/.aiassistant/messages/` with a timestamp prefix `YYYY-MM-DD_HH-NN_`.
- Never overwrite existing files; create new ones.
- This includes Action Plan iterations (see [§5.3](#53-persistence-uamf)).

## 5. Action Plan (AP)

### 5.1 Format & Versioning

- Title: `AP {topic} v{Major}.{Minor}: {2-5 word description}`
    - `{topic}` is a 1-3 word PascalCase slug describing the AP's subject (e.g. `Bild`, `Mock`, `DecisionEngine`, `ECSFixers`).
    - It is **not** a workflow signal — `PLAN`, `EXEC`, `ASK`, `ROLLBACK`, and `ERR` are user-facing keywords from §3, not AP title components.
- Examples: `AP Bild v1.0: Extract decision functions`, `AP FilterFix v1.0: Fix type validation`.
- Increment version on every update.
- Retain cumulative `Change History` within the AP document (append‑only).

### 5.2 Required Sections

- **Discussion** (if any)
- **Analysis**
- **Implementation Plan** (step‑by‑step; include a **Verification** checkpoint after each logical block)
- **Proposed commit message** (for changes since the session start or last commit)
- **Change History** (all previous version entries)

### 5.3 Persistence (UAMF)

- Write each AP iteration as a [UAMF](#4-useraccessible-message-files-uamf) before any modifying project files.

## 6. Commit Policy (STRICT)

- Summary MUST start with one of: `[TASK]`, `[FIX]`, `[SECURITY]`, `[CLEANUP]`, `[WIP]`, `[UPDATE]`.
- Empty second line.
- Detailed body explaining what and why.
- One functional change per commit.
- **Prefer using commit tools** documented in `.aiassistant/COMMIT.md`.

## 7. Additional References

- `.aiassistant/GUIDELINES.md` – entry point for project rules.
- `.aiassistant/tools/README.md` – helper scripts and tooling.
- `.aiassistant/tools/RUNTIME_TOOLS.md` – runtime tool capabilities and adaptation rules.
- `.aiassistant/CI.md` – CI conventions and setup‑server‑action behavior, if used.

## 8. Document Governance

- Version updated on every change (SemVer).
- Full document history is maintained in `.aiassistant/CHANGELOG.md`.
- Drift-check: when a specialized rule document changes ownership semantics, update §2.1 in the same change.
- In `8.1 Current version`, keep only the latest row; move older entries to `.aiassistant/CHANGELOG.md`, section 2.1.

### 8.1 Current version

| Version | Date       | Changed Sections | Change Type | Agent Impact                                    |
|---------|------------|------------------|-------------|-------------------------------------------------|
| v2.4.0  | 2026-08-05 | 7                | minor       | Added CI.md reference to Additional References. |
