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

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-restore-int-"));
        tasksDir = path.join(tmpRoot, "tasks");
        copyDir(FIXTURE_DIR, tasksDir);
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

        it("creates safety backup before overwriting", () => {
            const d = path.join(tasksDir, "019fdcba-5173-74cd-a9c3-9663d7917aa2");
            touch(path.join(d, "history_item.json.20260808-054500.bak.json"), "restored");

            restoreFromBackups(tasksDir, {
                taskId: "019fdcba-5173-74cd-a9c3-9663d7917aa2",
            });

            // A safety backup should have been created
            const files = fs.readdirSync(d);
            const safetyBaks = files.filter(
                (f) =>
                    /^history_item\.json\.\d{8}-\d{6}\.bak\.json$/.test(f) &&
                    f !== "history_item.json.20260808-054500.bak.json",
            );
            expect(safetyBaks.length).toBe(1);
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
