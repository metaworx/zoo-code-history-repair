/**
 * Integration tests: restore against scrambled fixture data.
 * Copies fixtures to temp dir, creates .bak.json files, tests restore operations.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listBackups, restoreFromBackups, deleteBackups } from "../../restore.js";

const FIXTURE_DIR = path.resolve("tests/fixtures/tasks");

function copyDir(src: string, dst: string): void {
    fs.cpSync(src, dst, { recursive: true });
}

function touch(filePath: string, content: string) {
    fs.writeFileSync(filePath, content, "utf8");
}

function read(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
}

describe("restore against fixtures (integration)", () => {
    let tmpRoot: string;
    let tasksDir: string;

    function stripBakFiles(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stripBakFiles(p);
            } else if (entry.isFile() && /\.\d{8}-\d{6}\.bak\.json$/.test(entry.name)) {
                fs.rmSync(p);
            }
        }
    }

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-restore-int-"));
        tasksDir = path.join(tmpRoot, "tasks");
        copyDir(FIXTURE_DIR, tasksDir);
        stripBakFiles(tasksDir);
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    describe("listBackups", () => {
        it("finds .bak.json files across fixture tasks", () => {
            // Create a backup in one task
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(
                path.join(d, "history_item.json.20260808-054500.bak.json"),
                "backup content",
            );

            const entries = listBackups(tasksDir);
            expect(entries.length).toBe(1);
            expect(entries[0].taskId).toBe("019f726a-0f50-711c-929e-9546e5100546");
            expect(entries[0].timestamp).toBe("20260808-054500");
            expect(entries[0].baseName).toBe("history_item.json");
        });

        it("returns empty when no backups exist", () => {
            expect(listBackups(tasksDir)).toEqual([]);
        });

        it("finds multiple backups across tasks", () => {
            const d1 = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            const d2 = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            touch(path.join(d1, "history_item.json.20260808-054500.bak.json"), "a");
            touch(path.join(d1, "ui_messages.json.20260807-120000.bak.json"), "b");
            touch(path.join(d2, "_index.json.20260808-054500.bak.json"), "c");

            expect(listBackups(tasksDir).length).toBe(3);
        });
    });

    describe("restoreFromBackups", () => {
        it("restores by taskId using newest timestamp", () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260807-120000.bak.json"), "older");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "newer");

            const result = restoreFromBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
            });
            expect(result.restored).toHaveLength(1);
            expect(result.restored[0].timestamp).toBe("20260808-054500");
            expect(read(path.join(d, "history_item.json"))).toBe("newer");
        });

        it("restores by taskId and specific timestamp", () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260807-120000.bak.json"), "older");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "newer");

            const result = restoreFromBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                timestamp: "20260807-120000",
            });
            expect(result.restored[0].timestamp).toBe("20260807-120000");
            expect(read(path.join(d, "history_item.json"))).toBe("older");
        });

        it("dry-run does not modify files", () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            const orig = read(path.join(d, "history_item.json"));
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
                dryRun: true,
            });
            expect(read(path.join(d, "history_item.json"))).toBe(orig);
        });

        it("does NOT create safety backup before overwriting", () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
            });

            // No extra safety backup — only the original .bak.json remains
            const files = fs.readdirSync(d);
            const bakFiles = files.filter((f) =>
                /^history_item\.json\.\d{8}-\d{6}\.bak\.json$/.test(f),
            );
            expect(bakFiles).toEqual(["history_item.json.20260808-054500.bak.json"]);
        });

        it("restore is idempotent — second run is no-op", () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            // First restore
            const r1 = restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
            });
            expect(r1.restored).toHaveLength(1);
            expect(r1.skipped).toHaveLength(0);

            // Second restore — should be no-op
            const r2 = restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
            });
            expect(r2.restored).toHaveLength(0);
            expect(r2.skipped).toHaveLength(1);
            expect(r2.skipped[0]).toContain("already matches backup");

            // Backup count should NOT have grown
            const bakFiles = fs.readdirSync(d).filter((f) => /\.bak\.json$/.test(f));
            expect(bakFiles).toHaveLength(1);
        });

        it("backup count does not grow on repeated restores", () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            // Run restore 3 times
            restoreFromBackups(tasksDir, { taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2" });
            restoreFromBackups(tasksDir, { taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2" });
            restoreFromBackups(tasksDir, { taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2" });

            // Should only have the original backup, no proliferation
            const bakFiles = fs.readdirSync(d).filter((f) => /\.bak\.json$/.test(f));
            expect(bakFiles).toHaveLength(1);
        });
    });

    describe("deleteBackups", () => {
        it("deletes backups for a specific taskId", () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "x");
            touch(path.join(d, "ui_messages.json.20260807-120000.bak.json"), "y");

            const result = deleteBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
            });
            expect(result.deleted).toHaveLength(2);
            expect(
                fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json")),
            ).toBe(false);
        });

        it("dry-run does not remove files", () => {
            const d = path.join(tasksDir, "019f726a-0f50-711c-929e-9546e5100546");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "x");

            deleteBackups(tasksDir, {
                taskId: "019f726a-0f50-711c-929e-9546e5100546",
                dryRun: true,
            });
            expect(
                fs.existsSync(path.join(d, "history_item.json.20260808-054500.bak.json")),
            ).toBe(true);
        });
    });
});
