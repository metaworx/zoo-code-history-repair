# AI Agent Guidelines History (v1.4.0)

## Contents

1. General Document Governance
   - 1.1 Document Versioning
   - 1.2 Document History Format
   - 1.3 Section Numbering
   - 1.4 `Contents` Section Rules
2. AGENTS.md Document Governance (STRICT)
   - 2.1 AGENTS.md Version History (INFORMATIONAL)
3. Root CHANGELOG.md (Keep a Changelog)
4. Version History

## 1. General Document Governance

- This file is the canonical governance and history reference for AI-guideline documents.
- Documents SHOULD be versioned.
- Documents SHOULD have a `Contents` section.

### 1.1 Document Versioning

The version number in the title of a document MUST be updated every time it is modified.

- Use **SemVer** (Semantic Versioning) logic:
  - **Major**: Incompatible changes to agent behavior or strict rules.
  - **Minor**: New optional guidelines, patterns, or clarifications.
  - **Patch**: Typo fixes or formatting adjustments.

### 1.2 Document History Format

- Keep each document's history section append-only and cumulative.
- Add one entry per document change, newest first.
- Each entry MUST include:
  - `version`
  - `date` (local)
  - `changes`/`changed sections`
  - `agent impact` (what behavior to revisit)
- Entries SHOULD be concise and reference section numbers where possible.

### 1.3 Section Numbering

- Sections SHOULD be numbered.
- The `Contents` section is the only top-level section that SHOULD remain unnumbered.

### 1.4 `Contents` Section Rules

- The `Contents` section SHOULD be optimized for agents: short, scannable, and deterministic.
- The `Contents` section SHOULD NOT use links.
- Format SHOULD mirror section numbering using plain lists.

Example:

```text
## Contents

1. Section One
2. Section Two
   - 2.1 Subsection Two-One
3. Section Three
```

## 2. AGENTS.md Document Governance (STRICT)

- Versioning is MANDATORY.
- History table in `AGENTS.md` contains only the latest entry; full history is maintained below.
- `AGENTS.md` history table MUST include:
  - `changed sections`
  - `change type`

### 2.1 AGENTS.md Version History (INFORMATIONAL)

| Version | Date       | Changed sections             | Change type | Agent impact                                                                                                                                                              |
|---------|------------|------------------------------|-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| v2.4.0  | 2026-08-05 | 7                            | minor       | Added CI.md reference to Additional References.                                 |
| v2.3.0  | 2026-06-15 | 5.1                          | minor       | Clarify AP title `{topic}` is a subject descriptor, not a workflow signal (§3).                                                                                           |
| v2.2.0  | 2026-06-10 | 2                            | minor       | Explicitly allow creation of UAMF in PLANNING-ONLY mode                                                                                                                   |
| v2.1.0  | 2026-04-22 | 2, 3, 8, Rule Map            | minor       | Added compact routing map, canonical rule-owner mapping, and first-response contract while keeping the document concise.                                                  |
| v2.0.4  | 2026-04-22 | All (restructured)           | major       | **Condensed and restructured content;** New `ROLLBACK` keyword for `undo_edit` authorization; Commit gate details and `EXEC+` variants moved to `.aiassistant/COMMIT.md`. |
| v1.33.0 | 2026-04-17 | 3.2, 3.3, 3.4, 3.5, 4.3, 4.4 | minor       | Adapt tool/lint rules to runtime availability and strengthen AP persistence guidance.                                                                                     |
| v1.32.0 | 2026-05-15 | 2.3                          | minor       | Note new `UAMF` keyword.                                                                                                                                                  |
| v1.31.0 | 2026-05-15 | 0.6, 3.4, 4.4, 5, 6          | minor       | Use `/.aiassistant` rather than `/.agent` directory.                                                                                                                      |
| v1.30.1 | 2026-03-12 | 7.3                          | patch       | Read `Document History` in table format; keep entries append-only and newest-first.                                                                                       |
| v1.30.0 | 2026-03-12 | 7, 7.1, 7.2, 7.3             | minor       | Check document-policy section for versioning/history requirements and update references accordingly.                                                                      |
| v1.29.0 | 2026-03-12 | 4.2 and AP examples          | minor       | AP updates must retain cumulative `Change History` entries.                                                                                                               |
| v1.28.0 | 2026-03-12 | 3.3, 3.4                     | minor       | Re-check file-edit and tool-selection rules after workflow/tool changes.                                                                                                  |
| v1.27.0 | 2026-03-12 | 1.1                          | minor       | Apply canonical-rule ownership when overlapping instructions exist.                                                                                                       |
| v1.24.0 | 2026-03-12 | 0.7, 3.x, 4.x                | minor       | Re-check numbering-sensitive references when sections move.                                                                                                               |
| v1.23.0 | 2026-03-12 | 0.7                          | minor       | Persist AP iterations before project write actions.                                                                                                                       |
| v1.11.0 | 2026-03-07 | 0.*, 1, 2, 3, 4, 5           | major       | Re-validate default execution behavior against pause/plan/commit gates.                                                                                                   |

## 3. Root CHANGELOG.md (Keep a Changelog)

The project root [`CHANGELOG.md`](../CHANGELOG.md) follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

- The `## [Unreleased]` section MUST ALWAYS remain the top version section and MUST NEVER be removed or renamed.
- When releasing a version, INSERT a new `## [X.Y.Z] — YYYY-MM-DD` header directly below `## [Unreleased]`
  (so `[Unreleased]` stays empty at the top) and move the released changes under the new header.
- Category sub-headings: `### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Security`.

## 4. Version History

| Version | Date       | Changed sections            | Change type | Agent impact                                                                                       |
|---------|------------|-----------------------------|-------------|----------------------------------------------------------------------------------------------------|
| v1.4.0  | 2026-08-14 | 3, 4, Contents               | minor       | Added root CHANGELOG.md Keep-a-Changelog rule: `[Unreleased]` must never be removed; releases insert a new header above it. |
| v1.3.0  | 2026-08-05 | 2.1                          | minor       | Added AGENTS.md v2.4.0 history entry.                                                              |
| v1.2.0  | 2026-04-22 | 1, 1.3, 1.4, 3              | minor       | Adds governance rules for `Contents` structure and section-numbering expectations across docs.     |
| v1.1.0  | 2026-04-22 | Title, Contents, 1, 2, 3, 4 | minor       | Adds title-based versioning, plain ToC, explicit canonical-governance statement, and self-history. |
| v1.0.0  | 2026-04-22 | Initial document            | minor       | Baseline governance and AGENTS history retention policy.                                           |
