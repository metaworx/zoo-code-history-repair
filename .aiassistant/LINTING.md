# Linting & Code Style Conventions (v3.0.0)

Project-specific linting and style conventions for `zoo-code-history-repair` (TypeScript / Node CLI).
Generic agent flow-control rules are in `AGENTS.md`.

## Contents

1. Linting Tool
2. When to Run
3. Minimum Submission Checklist
4. Code Style Rules
5. File Header Convention
6. Document Governance
7. Version History

## 1. Linting Tool

There is **no ESLint** setup in this repository. Linting and validation go through the
JetBrains IDE inspections via the JetBrains MCP server.

| Purpose | Tool | Notes |
|---------|------|-------|
| Batch lint multiple files | `lint_files` | Pass array of project-relative paths |
| Single file inspection | `get_file_problems` | Shows errors/warnings per file |
| Compile/type-check | `npx tsc -p tsconfig.json --noEmit` | Native type-check (no MCP needed) |
| Code formatting | `reformat_file` | Apply IDE code style after edits |

## 2. When to Run

- Run linting **before submission** for any code change.
- If formatter/lint output conflicts with ad-hoc style assumptions, **project lint output is authoritative**.
- Lint changed files after risky or multi-file edits to prevent syntax errors reaching handoff.

## 3. Minimum Submission Checklist

- [ ] Ran `lint_files` on changed scope (or `get_file_problems` on individual files).
- [ ] Applied `reformat_file` without introducing functional drift.
- [ ] Ran `npx tsc -p tsconfig.json --noEmit` (type-check).
- [ ] Rechecked edited files after formatting.
- [ ] Documented any accepted non-blocking lint caveats in the final summary.

## 4. Code Style Rules

Enforced by `.editorconfig` and JetBrains formatting; keep changes consistent with the existing style:

- Tabs for indentation (tab width 4), 2-space for `package.json`/YAML, Linux line endings (`\n`), trailing newline.
- No semicolons; double quotes; trailing commas in multiline constructs.
- Formatting is governed by [`.prettierrc.json`](../.prettierrc.json) (tabs, `semi: false`, `printWidth: 120`); run `npx prettier --write` for bulk reformat.
- `NodeNext` module resolution — relative imports use the `.js` extension.
- Explicit return types and accessibility modifiers are NOT enforced project-wide; match the
  surrounding file's conventions.
- Prefer history-preserving edit tools (`apply_diff`) over raw rewrites (AGENTS.md §1.5).

## 5. File Header Convention

Every TypeScript/JavaScript file MUST begin with a JSDoc `@file` header naming its
repo-relative path **and a brief description** of what the file does or contains:

```typescript
/**
 * @file src/lib/scanOutput.ts
 *
 * Scan output helpers: entry counting, recoverability scoring, and the
 * structured per-field recoverability report.
 */
```

The `@file` line with the relative path is the minimal requirement; a path-only
header is acceptable only for insignificant files. Significant modules MUST carry
a one-sentence description.

Enforcement and auto-fix are provided by the adopted [`tests/jsdoc-fix-header.mjs`](../tests/jsdoc-fix-header.mjs):

```bash
npm run header:check   # report missing/misplaced headers (exit ≠ 0 on drift)
npm run header:fix     # add missing + move misplaced headers across the repo
```

- Add the `@file` header to **every file you change** — at minimum, every file touched by a commit.
- `tests/fixtures/**` is ignored (generated/scrambled data, not source).

## 6. Document Governance

- This document follows the shared governance rules in `.aiassistant/CHANGELOG.md`.
- Update the title version on each change and append a row in `Version History`.

## 7. Version History

| Version | Date       | Changed sections | Change type | Agent impact |
|---------|------------|------------------|-------------|--------------|
| v3.0.0  | 2026-08-14 | All sections     | major       | Project switch: FCIAS (Nextcloud/PHP) → zoo-code-history-repair (TypeScript). Removed PHP/ECS guidance; documented JetBrains MCP + `tsc` linting, code style, and the `@file` header convention with `header:check`/`header:fix`. |
| v2.0.0  | 2026-08-03 | All sections     | major       | Project switch: Kunstarchiv → FCIAS. (FCIAS) |
| v1.2.0  | 2026-04-22 | Contents, 1–7    | minor       | Adds section numbering (Kunstarchiv). |
| v1.1.0  | 2026-04-22 | Title, Contents  | minor       | Adds explicit versioning (Kunstarchiv). |
| v1.0.0  | 2026-04-22 | Initial document | minor       | Baseline linting guidance for Kunstarchiv (ECS). |
