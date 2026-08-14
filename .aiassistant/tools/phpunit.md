# PHPUnit Wrapper (v1.0.0)

Agent-facing guidance for `\.aiassistant\tools\phpunit`.

## Contents

1. Overview
2. Basic Usage
3. Wrapper-specific Flags
4. Automatic Display Options
5. Output Format (`--use-diff-stats`)
6. Agent Parsing Notes
7. Example Commands
8. Compatibility Notes
9. Document Governance
10. Version History

## 1. Overview

`\.aiassistant\tools\phpunit` is the preferred PHPUnit entrypoint for agents.
It is fully compatible with normal PHPUnit CLI usage and forwards standard PHPUnit arguments.

The wrapper (via `mwx\Tests\ConditionalDiffFilter`) can additionally:

- suppress verbose assertion diffs into compact stats (`--use-diff-stats`),
- hide file/line trace tails (`--no-trace`),
- inject environment variables for the test process (`--env KEY=VALUE`).

## 2. Basic Usage

```powershell
# Wrapper as drop-in PHPUnit runner
.\.aiassistant\tools\phpunit [phpunit-options]

# Compact first-pass diagnosis
.\.aiassistant\tools\phpunit --use-diff-stats [phpunit-options]
```

```bash
# Normal PHPUnit execution (no filtering)
.aiassistant/tools/phpunit [phpunit-options]

# Enable diff suppression + statistics
.aiassistant/tools/phpunit --use-diff-stats [phpunit-options]
```

## 3. Wrapper-specific Flags

| Flag               | Effect                                                                      |
|--------------------|-----------------------------------------------------------------------------|
| `--use-diff-stats` | Replaces diff blocks with a one-line summary (`Added`, `Removed`, `Blocks`). |
| `--no-trace`       | Hides stack-trace tail lines like `...file.php:123` after failure output.   |
| `--no-display-*`   | Disables default display options. See §4.                                   |
| `--env KEY=VALUE`  | Sets an environment variable for the PHPUnit subprocess; can be repeated.   |

All other arguments (for example `--filter`, `--testdox`, `--log-junit`) are passed through unchanged.

## 4. Automatic Display Options

Unless explicitly disabled, the wrapper adds:

- `--display-warnings`
- `--display-incomplete`
- `--display-deprecations`
- `--display-skipped`
- `--display-phpunit-deprecations`

To disable one of these defaults, pass the matching `--no-display-*` option.

## 5. Output Format (`--use-diff-stats`)

Standard output line:

```text
✂️ Added: X, Removed: Y, Blocks: Z [Diff suppressed with --use-diff-stats]
```

With TestDox (`--testdox`):

```
   ├ ✂️ Added: X, Removed: Y, Blocks: Z [Diff suppressed with --use-diff-stats]
```

(The line is indented and prefixed with the testdox box-drawing character)

## 6. Agent Parsing Notes

- Detect suppression via the literal `[Diff suppressed with --use-diff-stats]`.
- Extract counts via: `✂️ Added: (\d+), Removed: (\d+), Blocks: (\d+)`.
- `--no-trace` removes lines matching a `*.php:<line>` trace pattern.
- The wrapper preserves PHPUnit exit codes (`0` success, non-zero failure).

## 7. Example Commands

```powershell
# Suppress diffs for a concise first overview
.\.aiassistant\tools\phpunit --use-diff-stats tests\Unit\CS\Fixer\

# Enable debug env flow for trait-based fixer tests
.\.aiassistant\tools\phpunit --env PHPUNIT_DEBUG=1 tests\Unit\CS\Fixer\ControlStructureBraceFixer\ControlStructureBraceFixerConfigTest.php

# Keep full output but disable one automatic display channel
.\.aiassistant\tools\phpunit --no-display-deprecations
```

## 8. Compatibility Notes

- Wrapper flags (`--use-diff-stats`, `--no-trace`, `--env`) are consumed before invoking PHPUnit and do not reach PHPUnit argument parsing.
- Raw `vendor\bin\phpunit` does not support `--env`; use PowerShell `$env:KEY=value` in that mode.

## 9. Document Governance

- This document follows shared governance rules in `.aiassistant/CHANGELOG.md`.
- Update the title version on each change and append a new row in `Version History`.

## 10. Version History

| Version | Date       | Changed sections | Change type | Agent impact |
|---------|------------|------------------|-------------|--------------|
| v1.0.0  | 2026-04-23 | Initial document | minor       | Establishes wrapper-specific behavior, options, and wrapper-first usage guidance for agents. |
