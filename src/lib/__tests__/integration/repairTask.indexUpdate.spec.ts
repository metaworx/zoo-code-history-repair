/**
 * Integration test: repair-task → index update preserves all entries.
 *
 * Validates that after repair-task --force on a single corrupt task,
 * the _index.json still contains all original entries (not just the repaired one).
 *
 * Workflow: list-corrupt → validate → repair-task --force → list-corrupt → validate
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";

const mockSetRoot = vi.hoisted(() => vi.fn());
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"));
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"));

vi.mock("../../cliContext.js", () => ({
    setRoot: mockSetRoot,
    getVersionBanner: mockGetVersionBanner,
    resolveRoot: mockResolveRoot,
    ABBREV_HELP: "",
}));

vi.mock("../../format.js", () => ({
    c: {red: "red"},
    colorize: vi.fn((s: string) => s),
}));

import {action as repairTaskAction} from "../../commands/repairTask.js";
import {action as validateAction} from "../../commands/validate.js";
import {action as listCorruptAction} from "../../commands/listCorrupt.js";
import {contentHash} from "../../file.js";
import {HISTORY_ITEM_NAME} from "../../paths.js";

const FIXTURE_DIR = path.resolve("tests/fixtures/tasks");
const TASK_ID = "019fdc9c-a59f-75d9-bf05-4fd3d4fe4913";

function copyDir(src: string, dst: string): void {
    fs.cpSync(src, dst, {recursive: true});
}

function listBackupFiles(dir: string): string[] {
    return fs.readdirSync(dir).filter(f => f.endsWith(".bak.json"));
}

describe("repair-task → index update (integration)", () => {
    let tmpRoot: string;
    let tasksDir: string;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn<typeof process, "exit">>;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-repair-idx-"));
        tasksDir = path.join(tmpRoot, "tasks");
        copyDir(FIXTURE_DIR, tasksDir);
        mockResolveRoot.mockReturnValue(tmpRoot);
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    });

    afterEach(() => {
        vi.clearAllMocks();
        fs.rmSync(tmpRoot, {recursive: true, force: true});
    });

    it("preserves all index entries after targeted repair", () => {
        const indexPath = path.join(tasksDir, "_index.json");
        const taskDir = path.join(tasksDir, TASK_ID);
        const hiPath = path.join(taskDir, HISTORY_ITEM_NAME);
        const uiPath = path.join(taskDir, "ui_messages.json");

        const hiOut = path.join(tasksDir, TASK_ID, HISTORY_ITEM_NAME);
        const uiOut = path.join(tasksDir, TASK_ID, "ui_messages.json");
        const idxOut = `${path.join(tasksDir, "_index.json")}:entries[${TASK_ID}]`;

        // --- Phase 0: Snapshot initial state ---
        const indexBefore = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        const entryCountBefore = indexBefore.entries.length;
        const hiHashBefore = contentHash(hiPath);
        const uiHashBefore = contentHash(uiPath);
        const indexHashBefore = contentHash(indexPath);

        // --- Phase 1: list-corrupt before repair ---
        listCorruptAction({});
        const lc1 = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
        const lc1task = lc1.split("\n").find(l => l.startsWith(TASK_ID));
        expect(lc1task, "task must appear in pre-repair list-corrupt").toBeDefined();
        expect(lc1task).toContain("70%");
        expect(lc1task).toContain("placeholder_task_name(hi,idx)");
        expect(lc1task).toContain("zero_tokens(hi)");
        expect(lc1task).toContain("zero_size(hi,idx)");
        expect(lc1task).toContain("empty_ui_messages(uim)");
        expect(lc1task).toContain("interrupted_task(ach)");

        // --- Phase 2: validate before repair ---
        consoleLogSpy.mockClear();
        validateAction(TASK_ID, {warnings: true});
        const v1 = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
        expect(v1).toContain(hiOut + ":");
        expect(v1).toContain(uiOut + ":");
        expect(v1).toContain(idxOut + ":");
        expect(v1).toContain("task is a placeholder");
        expect(v1).toContain("tokensIn: tokensIn is 0");
        expect(v1).toContain("tokensOut: tokensOut is 0");
        expect(v1).toContain("totalCost: totalCost is 0");
        expect(v1).toContain("ui_messages array is empty");
        expect(v1).toContain("5 files checked, 3 valid, 2 errors, 9 warnings");

        // --- Phase 3: Repair the task (with backups) ---
        consoleLogSpy.mockClear();
        repairTaskAction(TASK_ID, {force: true, backup: true});
        const rOut = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
        expect(rOut).toContain(`${TASK_ID}: repaired ui(ach→uim), task(ach→hi), size(calc→hi), tokens(estimate→hi)`);
        expect(rOut).toContain("Backups:");

        // Backup files in output + on disk + checksums match originals
        const taskBaks = listBackupFiles(taskDir);
        expect(taskBaks.length).toBeGreaterThanOrEqual(2);
        const hiBak = taskBaks.find(f => f.startsWith("history_item.json."));
        const uiBak = taskBaks.find(f => f.startsWith("ui_messages.json."));
        expect(hiBak, "history_item.json backup").toBeDefined();
        expect(uiBak, "ui_messages.json backup").toBeDefined();
        expect(rOut).toContain(hiBak!);
        expect(rOut).toContain(uiBak!);
        expect(contentHash(path.join(taskDir, hiBak!)), "hi backup checksum").toBe(hiHashBefore);
        expect(contentHash(path.join(taskDir, uiBak!)), "ui backup checksum").toBe(uiHashBefore);

        const indexBaks = listBackupFiles(tasksDir);
        expect(indexBaks.length).toBeGreaterThanOrEqual(1);
        const idxBak = indexBaks.find(f => f.startsWith("_index.json."));
        expect(idxBak, "_index.json backup").toBeDefined();
        expect(rOut).toContain(idxBak!);
        expect(contentHash(path.join(tasksDir, idxBak!)), "index backup checksum").toBe(indexHashBefore);

        // --- Phase 4: list-corrupt after repair (reasons reduced) ---
        consoleLogSpy.mockClear();
        listCorruptAction({});
        const lc2 = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
        const lc2task = lc2.split("\n").find(l => l.startsWith(TASK_ID));
        // Task may be fully repaired (no longer in list-corrupt)
        if (lc2task) {
            expect(lc2task).not.toContain("placeholder_task_name");
            expect(lc2task).not.toContain("zero_size");
            expect(lc2task).not.toContain("empty_ui_messages");
        }

        // --- Phase 5: Verify index integrity ---
        const indexAfter = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        const idsAfter = new Set(indexAfter.entries.map((e: {id: string}) => e.id));
        expect(idsAfter.has(TASK_ID), "repaired entry must exist in index").toBe(true);
        for (const e of indexBefore.entries) {
            expect(idsAfter.has(e.id), `entry ${e.id} must be preserved`).toBe(true);
        }
        expect(indexAfter.entries.length).toBe(entryCountBefore);

        // --- Phase 6: validate after repair ---
        consoleLogSpy.mockClear();
        validateAction(TASK_ID, {warnings: false});
        const v2 = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
        expect(v2).toContain(hiOut + ":");
        expect(v2).not.toContain(uiOut + ":");
        expect(v2).toContain(idxOut + ":");
        expect(v2).not.toContain("task is a placeholder");
        expect(v2).not.toContain("tokensIn: tokensIn is 0");
        expect(v2).not.toContain("tokensOut: tokensOut is 0");
        expect(v2).not.toContain("totalCost: totalCost is 0");
        expect(v2).not.toContain("ui_messages array is empty");
        expect(v2).toContain("0 errors");

        // --- Phase 7: contentHash verification ---
        const hiHashAfter = contentHash(hiPath);
        const uiHashAfter = contentHash(uiPath);
        const indexHashAfter = contentHash(indexPath);
        expect(hiHashAfter).not.toBeNull();
        expect(uiHashAfter).not.toBeNull();
        expect(indexHashAfter).not.toBeNull();
        expect(hiHashAfter).not.toBe(hiHashBefore);
        expect(uiHashAfter).not.toBe(uiHashBefore);
        expect(indexHashAfter).not.toBe(indexHashBefore);

        const hi = JSON.parse(fs.readFileSync(hiPath, "utf8"));
        expect(hi.task).not.toMatch(/^Task\s*#\s*\d+/);

        // --- Phase 8: Second repair — idempotency (must change nothing) ---
        const bakCountBefore = listBackupFiles(taskDir).length + listBackupFiles(tasksDir).length;
        const lc2Before = lc2;
        const v2Before = v2;

        consoleLogSpy.mockClear();
        repairTaskAction(TASK_ID, {force: true, backup: true});
        const rOut2 = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
        // Second repair must not report any changes
        expect(rOut2).not.toContain("repaired");
        expect(rOut2).not.toContain("Backups:");

        // No new backups created
        const bakCountAfter = listBackupFiles(taskDir).length + listBackupFiles(tasksDir).length;
        expect(bakCountAfter).toBe(bakCountBefore);

        // Checksums unchanged
        expect(contentHash(hiPath)).toBe(hiHashAfter);
        expect(contentHash(uiPath)).toBe(uiHashAfter);
        expect(contentHash(indexPath)).toBe(indexHashAfter);

        // list-corrupt output unchanged
        consoleLogSpy.mockClear();
        listCorruptAction({});
        const lc3 = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
        expect(lc3).toBe(lc2Before);

        // validate output unchanged
        consoleLogSpy.mockClear();
        validateAction(TASK_ID, {warnings: false});
        const v3 = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
        expect(v3).toBe(v2Before);
    });
});
