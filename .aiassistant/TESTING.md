# Testing Conventions (v3.0.1)

Project-specific testing conventions for `zoo-code-history-repair` (TypeScript / Node CLI).
Generic agent flow-control rules are in `AGENTS.md`.

## Contents

1. Test Runner
2. Concise Output
3. Minimum Submission Checklist
4. When to Write Tests
5. Coverage Guidance
6. Testability Patterns
7. Fixture Regeneration
8. Diagnosis Strategy
9. JetBrains MCP Quality Workflow
10. Document Governance
11. Version History

## 1. Test Runner

The test runner is [Vitest](https://vitest.dev/), configured in [`vitest.config.ts`](../vitest.config.ts).

```bash
npm run test:tail                # runs npm test, prints last 60 relevant lines - avoids unnecessary noise
                                 # -> use as preferred method. Details see next section 
npm test                         # full suite (vitest run)
npm run test:watch               # watch mode (vitest)
npm run test:coverage            # coverage report (text + lcov → coverage/)
```

Scoped runs (single file or directory):

```bash
npx vitest run src/lib/__tests__/resolveReferences.spec.ts
npx vitest run src/lib/__tests__/commands/
npx vitest run src/lib/__tests__/integration/
```

Config highlights:
- `environment: "node"`, `globals: true` (test files rely on globals `describe`/`it`/`expect`/`vi`).
- `include: ["src/**/*.spec.ts"]` — tests are colocated under `src/lib/__tests__/`.
- `coverage` uses `@vitest/coverage-v8`, includes `src/lib/**/*.ts`.

## 2. Concise Output

Full-suite output is large. For a filtered tail of failure-relevant lines, use the
adopted [`tests/npm-test-tail.mjs`](../tests/npm-test-tail.mjs):

```bash
npm run test:tail                          # runs npm test, prints last 60 relevant lines
npm run test:tail -- -n 100 -P "TIMEOUT"   # extra patterns, more lines
npm run test:tail -- test:coverage         # tail a different script
```

Use direct `npm test` only when full raw output is required.

## 3. Minimum Submission Checklist

- [ ] Ran the changed scope (at minimum) and the full `npm test` before handoff.
- [ ] Ran dependent/adjacent tests when change risk is moderate or higher.
- [ ] Confirmed new/updated tests are green.
- [ ] Documented known non-blockers in the final summary.

## 4. When to Write Tests

| Change type | Requirement |
|-------------|-------------|
| Bug fix | **Always** write a reproduction test; verify it fails before the fix. |
| New feature | Add tests proportional to complexity; skip only for trivial getters/labels. |
| Refactoring | Rely on existing tests; add new ones only if coverage is clearly missing. |
| Docs-only | No tests required. |

## 5. Coverage Guidance

1. **Unit tests** — each `src/lib/*.ts` module has a colocated `__tests__/*.spec.ts`.
2. **Command tests** — `src/lib/commands/*.ts` are tested through their `action()`
   functions with `vi.mock` of the underlying lib modules and `console.log`/`process.exit` spies.
3. **Integration tests** — `src/lib/__tests__/integration/*` run the CLI pipeline
   (scan → repair → validate → idempotency) against scrambled fixtures.

## 6. Testability Patterns

- **Temp dirs**: `fs.mkdtempSync(path.join(os.tmpdir(), "zoo-<name>-"))` in `beforeEach`,
  `fs.rmSync(root, {recursive: true, force: true})` in `afterEach`.
- **Capture CLI output**:
  ```typescript
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any)
  ```
- **Module mocks**: `vi.mock("../../scan.js", () => ({ scanStorage: mockScanStorage }))`
  with `const mockScanStorage = vi.hoisted(() => vi.fn())` (hoisted so the mock factory can see it).
- **Shared helpers**: [`src/lib/__tests__/testHelpers.ts`](../src/lib/__tests__/testHelpers.ts)
  provides `createTempDir`, `copyFixtureTasks`, `assertJsonEqual`/`toDeepEqualJson`,
  and fixture path constants.
- **JSON equality**: `assertJsonEqual(actual, expected, {ignoreProps, replacements, maxLength})`
  normalizes key order and path prefixes before comparison.

## 7. Fixture Regeneration

Integration tests run against scrambled real-world task data in [`tests/fixtures/tasks/`](../tests/fixtures/tasks/).

- Scramble fixtures: `npx tsx scripts/scramble-fixture.ts [<source-dir>] <taskId> [taskId...]`
- Regenerate scan/repair expectation fixtures: `npx tsx scripts/regenerate-fixtures.ts`
  (writes `tests/fixtures/scan.before.json`, `scan.short.before.json`, `scan.after.json`,
  `scan.short.after.json`, `_index.rebuilt.json`).

> When `scan --json` output changes shape, regenerate `tests/fixtures/scan.before.json` /
> `scan.after.json` rather than hand-editing them — the full-pipeline test compares
> these verbatim.

## 8. Diagnosis Strategy

- Prefer concise, filtered output for first-pass diagnosis (`npm run test:tail`).
- Run scoped tests first, then expand to the full suite.
- Debug failures to root cause before adjusting expectations; be conservative when
  modifying expectations for newly-covered code (AGENTS.md).
- For build verification without running tests, use `npx tsc -p tsconfig.json --noEmit`.

## 9. JetBrains MCP Quality Workflow

After editing TypeScript files, run the full quality pipeline via JetBrains MCP
(MCP server named "webstorm"/"jetbrains"/"phpstorm"):

1. **Reformat**: `reformat_file` with `files: ["path/relative/to/project"]`.
2. **Inspect**: `get_file_problems` with `filePath` (shows errors/warnings).
3. **Lint**: `lint_files` with `files: ["path1", "path2"]` for batch validation.
4. Run `npm run header:check` to report missing/misplaced headers (exit ≠ 0 on drift)
   (see ./LINTNG.md §5 for details)
5. Repeat steps 1–3 until no additional changes are needed.

> This is NOT only linting — it includes reformatting AND file-problem inspection.
> Run the full workflow on EVERY changed file. If JetBrains MCP is unavailable,
> say so prominently and fall back to `npx tsc -p tsconfig.json --noEmit`.


## 10. Document Governance

- This document follows the shared governance rules in `.aiassistant/CHANGELOG.md`.
- Update the title version on each change and append a row in `Version History`.

## 11. Version History

| Version | Date       | Changed sections | Change type | Agent impact |
|---------|------------|------------------|-------------|--------------|
| v3.0.1  | 2026-08-14 | 7                | minor       | `regenerate-fixtures.ts` now also regenerates `scan.before.json` / `list-corrupt.before.json`. |
| v3.0.0  | 2026-08-14 | All sections     | major       | Project switch: PHPUnit → zoo-code-history-repair (Vitest/TypeScript). Replaced PHPUnit/WSL/ddev/Cypress with Vitest commands, added `npm run test:tail`, fixture regeneration, and TS testability patterns. |
| v2.4.0  | 2026-08-06 | 14               | minor       | Added JetBrains MCP Quality Workflow (§14). Author: metaworx. (FCIAS) |
| v2.3.0  | 2026-08-05 | 1                | minor       | Added --display-warnings note for CI PHPUnit. (FCIAS) |
| v2.2.0  | 2026-08-05 | 1.1, 8–13        | minor       | Documented phpunit wrapper; Cypress E2E. (FCIAS) |
| v2.1.0  | 2026-08-05 | 1.1, 6.1, 12     | minor       | DDEV test runner; readonly class mockability. (FCIAS) |
| v2.0.0  | 2026-08-03 | All sections     | major       | Project switch: Kunstarchiv → FCIAS. (FCIAS) |
