# Project Guidelines Entry Point

This file is the project-specific entry point for agent-facing guidance in this repository.

## Table of Contents

- [Primary References](#primary-references)
- [Scope Guidance](#scope-guidance)

## Primary References

- `AGENTS.md` — runtime behavior contract, gating flow, and action-plan workflow.
- `/.aiassistant/COMMIT.md` — canonical commit workflow, commit gating, `EXEC+` variants, and commit message policy.
- `/.aiassistant/TESTING.md` — Vitest test conventions, fixture regeneration, and testability patterns.
- `/.aiassistant/LINTING.md` — JetBrains MCP linting, code style, and the `@file` header convention.
- `/.aiassistant/GATE_WORKFLOW.md` — gate lifecycle, pause behavior, and the universal gate template.
- `/.aiassistant/tools/README.md` — helper scripts and usage notes for runtime helper utilities.

## Scope Guidance

- Keep generic/mode/runtime behavior in `AGENTS.md`.
- Keep project-specific conventions in the `/.aiassistant/` documents listed above.
- Keep tool-specific operational documentation in `/.aiassistant/tools/`.
