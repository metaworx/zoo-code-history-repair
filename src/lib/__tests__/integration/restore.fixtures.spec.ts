/**
 * Integration tests: restore against scrambled fixture data.
 * Copies fixtures to temp dir, creates .bak.json files, tests restore operations.
 */
import fs from "node:fs";
import path from "node:path";
import {vi} from "vitest";
import {
    deleteBackups,
    diffBackup,
    listBackupsForType,
    restoreFromBackups
} from "../../restore.js";
import {
    copyFixtureTasks,
    createTempDir,
    read,
    touch,
    writeJson
} from "../testHelpers.js";

const mockReplaceId = vi.hoisted(() => vi.fn(async () => null));
vi.mock("../../IndexTransaction.js", () => ({
    IndexTransaction: class {
        async replaceId(...args: unknown[]): Promise<null> {
            return mockReplaceId(...args);
        }
    },
}));

describe("restore against fixtures (integration)", () => {
    let tmpRoot: string;
    let tasksDir: string;
    let cleanup: () => void;

    function stripBakFiles(dir: string): void {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stripBakFiles(p);
            } else if (entry.isFile() && /\.\d{8}-\d{6}\.bak\.json$/.test(entry.name)) {
                fs.rmSync(p);
            }
        }
    }

    beforeEach(() => {
        const td = createTempDir("zoo-restore-int-");
        tmpRoot = td.root;
        tasksDir = td.tasksDir;
        cleanup = td.cleanup;
        copyFixtureTasks(tasksDir);
        stripBakFiles(tasksDir);
        mockReplaceId.mockClear();
    });

    afterEach(() => {
        cleanup();
    });

    describe("listBackupsForType", () => {
        it("finds history_item backups by default", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(
                path.join(d, "history_item.json.20260808-054500.bak.json"),
                "backup content",
            );

            const entries = await listBackupsForType(tasksDir);
            expect(entries).toHaveLength(1);
            expect(entries[0].taskId).toBe("019f726a-0f50-711c-929e-9546e5100546");
            expect(entries[0].timestamp).toBe("20260808-054500");
            expect(entries[0].baseName).toBe("history_item.json");
        });

        it("returns empty when no backups exist", async () => {
            expect(await listBackupsForType(tasksDir)).toEqual([]);
        });

        it("returns only _index.task entries when type is _index.task", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "a");
            touch(path.join(d, "ui_messages.json.20260808-054500.bak.json"), "b");
            touch(path.join(d, "_index.task.20260808-054500.bak.json"), "c");

            const entries = await listBackupsForType(tasksDir, "_index.task");
            expect(entries).toHaveLength(1);
            expect(entries[0].baseName).toBe("_index.task");
        });

        it("returns everything when type is all", async () => {
            const d1 = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            const d2 = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            touch(path.join(d1, "history_item.json.20260808-054500.bak.json"), "a");
            touch(path.join(d1, "ui_messages.json.20260807-120000.bak.json"), "b");
            touch(path.join(d2, "_index.task.20260808-054500.bak.json"), "c");

            expect((await listBackupsForType(tasksDir, "all")).length).toBe(3);
        });
    });

    describe("restoreFromBackups", () => {
        it("restores by taskId using newest timestamp", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260807-120000.bak.json"), "older");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "newer");

            const result = await restoreFromBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
            });
            expect(result.restored).toHaveLength(1);
            expect(result.restored[0].timestamp).toBe("20260808-054500");
            expect(read(path.join(d, "history_item.json"))).toBe("newer");
        });

        it("restores by taskId and specific timestamp", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260807-120000.bak.json"), "older");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "newer");

            const result = await restoreFromBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                timestamp: "20260807-120000",
            });
            expect(result.restored[0].timestamp).toBe("20260807-120000");
            expect(read(path.join(d, "history_item.json"))).toBe("older");
        });

        it("dry-run does not modify files", async () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            const orig = read(path.join(d, "history_item.json"));
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            await restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
                dryRun: true,
            });
            expect(read(path.join(d, "history_item.json"))).toBe(orig);
        });

        it("history_item restore creates a safety backup before overwriting", async () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            const original = read(path.join(d, "history_item.json"));
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            await restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
            });

            expect(read(path.join(d, "history_item.json"))).toBe("restored");

            const bakFiles = fs.readdirSync(d).filter((f) =>
                /^history_item\.json\.\d{8}-\d{6}\.bak\.json$/.test(f),
            );
            // Original source backup + safety backup of the prior content
            expect(bakFiles).toHaveLength(2);
            expect(bakFiles).toContain("history_item.json.20260808-054500.bak.json");

            const safety = bakFiles.find((f) => f !== "history_item.json.20260808-054500.bak.json");
            expect(read(path.join(d, safety!))).toBe(original);
        });

        it("restore is idempotent — second run is no-op", async () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            // First restore
            const r1 = await restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
            });
            expect(r1.restored).toHaveLength(1);
            expect(r1.skipped).toHaveLength(0);

            // Second restore — should be no-op
            const r2 = await restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
            });
            expect(r2.restored).toHaveLength(0);
            expect(r2.skipped).toHaveLength(1);
            expect(r2.skipped[0]).toContain("already matches backup");

            // Backup count should NOT have grown (source + safety backup)
            const bakFiles = fs.readdirSync(d).filter((f) => /\.bak\.json$/.test(f));
            expect(bakFiles).toHaveLength(2);
        });

        it("backup count does not grow on repeated restores", async () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            // Run restore 3 times
            await restoreFromBackups(tasksDir, {taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2"});
            await restoreFromBackups(tasksDir, {taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2"});
            await restoreFromBackups(tasksDir, {taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2"});

            // Only the original source backup + one safety backup
            const bakFiles = fs.readdirSync(d).filter((f) => /\.bak\.json$/.test(f));
            expect(bakFiles).toHaveLength(2);
        });

        it("_index.task backup restores to history_item.json (not _index.json)", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            const entry = {
                id: "019f726a-0f50-711c-929e-9546e5100546",
                ts: 100,
                task: "restored from _index",
                _removedReason: "no_history_item",
                _removedAt: 1234567890,
            };
            touch(path.join(d, "_index.task.20260808-054500.bak.json"), JSON.stringify(entry));

            const result = await restoreFromBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                type: "_index.task",
                mergeIntoIndex: false,
            });
            expect(result.restored).toHaveLength(1);

            const hi = JSON.parse(read(path.join(d, "history_item.json")));
            expect(hi.task).toBe("restored from _index");
            expect(hi).not.toHaveProperty("_removedReason");
            expect(hi).not.toHaveProperty("_removedAt");
            expect(fs.existsSync(path.join(d, "_index.json"))).toBe(false);
        });

        it("_index.task restore creates a safety backup of the prior history_item.json", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            const original = read(path.join(d, "history_item.json"));
            const entry = {
                id: "019f726a-0f50-711c-929e-9546e5100546",
                ts: 100,
                task: "restored from _index",
            };
            touch(path.join(d, "_index.task.20260808-054500.bak.json"), JSON.stringify(entry));

            await restoreFromBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                type: "_index.task",
                mergeIntoIndex: false,
            });

            const safetyFiles = fs.readdirSync(d).filter((f) =>
                /^history_item\.json\.\d{8}-\d{6}\.bak\.json$/.test(f),
            );
            expect(safetyFiles).toHaveLength(1);
            expect(read(path.join(d, safetyFiles[0]))).toBe(original);
        });

        it("_index.task restore merges entry into global index via replaceId", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            const entry = {
                id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                ts: 100,
                task: "restored from _index",
                _removedReason: "both_corrupt",
                _removedAt: 1234567890,
            };
            touch(path.join(d, "_index.task.20260808-054500.bak.json"), JSON.stringify(entry));

            await restoreFromBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                type: "_index.task",
            });

            expect(mockReplaceId).toHaveBeenCalledTimes(1);
            expect(mockReplaceId).toHaveBeenCalledWith(
                "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                expect.objectContaining({task: "restored from _index"}),
                true,
                false,
            );

            const entryArg = mockReplaceId.mock.calls[0][1] as Record<string, unknown>;
            expect(entryArg).not.toHaveProperty("_removedReason");
            expect(entryArg).not.toHaveProperty("_removedAt");

            const hi = JSON.parse(read(path.join(d, "history_item.json")));
            expect(hi).not.toHaveProperty("_removedReason");
            expect(hi).not.toHaveProperty("_removedAt");
        });
    });

    describe("diffBackup", () => {
        it("returns changed fields with dotted paths", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            const backup = {childIds: ["a", "b"], meta: {x: 1}, tokensIn: 0};
            const current = {childIds: ["a", "c"], meta: {x: 2}, tokensIn: 0};
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), JSON.stringify(backup));
            writeJson(path.join(d, "history_item.json"), current);

            const result = await diffBackup(tasksDir, "019f726a-0f50-711c-929e-9546e5100546", "20260808-054500");

            expect(result.baseName).toBe("history_item.json");
            expect(result.diffs).toHaveLength(2);
            expect(result.diffs[0]).toEqual({field: "childIds[1]", backup: "b", current: "c"});
            expect(result.diffs[1]).toEqual({field: "meta.x", backup: 1, current: 2});
        });

        it("counts unchanged fields correctly", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            const backup = {task: "Task #1 (Incomplete)", tokensIn: 0, tokensOut: 0, id: "x", ts: 123};
            const current = {task: "Fix the login bug", tokensIn: 50000, tokensOut: 12000, id: "x", ts: 123};
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), JSON.stringify(backup));
            writeJson(path.join(d, "history_item.json"), current);

            const result = await diffBackup(tasksDir, "019f726a-0f50-711c-929e-9546e5100546", "20260808-054500");

            expect(result.diffs).toHaveLength(3);
            expect(result.unchanged).toBe(2);
        });

        it("strips _removedReason/_removedAt for _index.task backups", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            const entry = {
                id: "x",
                task: "from backup",
                ts: 1,
                _removedReason: "no_history_item",
                _removedAt: 1234567890,
            };
            const current = {id: "x", task: "current", ts: 2};
            touch(path.join(d, "_index.task.20260808-054500.bak.json"), JSON.stringify(entry));
            writeJson(path.join(d, "history_item.json"), current);

            const result = await diffBackup(
                tasksDir,
                "019f726a-0f50-711c-929e-9546e5100546",
                "20260808-054500",
                {type: "_index.task"},
            );

            const fields = result.diffs.map(e => e.field);
            expect(fields).not.toContain("_removedReason");
            expect(fields).not.toContain("_removedAt");
            expect(result.diffs).toHaveLength(2);
            expect(result.unchanged).toBe(1);
        });

        it("handles currentMissing (target file absent)", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), JSON.stringify({a: 1}));
            fs.rmSync(path.join(d, "history_item.json"));

            const result = await diffBackup(tasksDir, "019f726a-0f50-711c-929e-9546e5100546", "20260808-054500");

            expect(result.currentMissing).toBe(true);
            expect(result.backupMissing).toBe(false);
            expect(result.diffs).toHaveLength(0);
        });

        it("handles backupMissing", async () => {
            const result = await diffBackup(tasksDir, "019f726a-0f50-711c-929e-9546e5100546", "20260808-054500");

            expect(result.backupMissing).toBe(true);
            expect(result.currentMissing).toBe(false);
        });
    });

    describe("deleteBackups", () => {
        it("deletes backups for a specific taskId", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "x");
            touch(path.join(d, "ui_messages.json.20260807-120000.bak.json"), "y");

            const result = await deleteBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                type: "all",
            });
            expect(result.deleted).toHaveLength(2);
            expect(
                fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json")),
            ).toBe(false);
        });

        it("deletes only the requested type", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "x");
            touch(path.join(d, "_index.task.20260808-054500.bak.json"), "y");

            const result = await deleteBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                type: "_index.task",
            });
            expect(result.deleted).toHaveLength(1);
            expect(
                fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json")),
            ).toBe(true);
            expect(
                fs.existsSync(path.join(d, "_index.task.20260808-054500.bak.json")),
            ).toBe(false);
        });

        it("dry-run does not remove files", async () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "x");

            await deleteBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                dryRun: true,
            });
            expect(
                fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json")),
            ).toBe(true);
        });
    });
});
