/**
 * Integration tests: repair against scrambled fixture data.
 * Copies fixtures to temp dir, runs repair, verifies output against SHA1 hashes.
 */
import fs from "node:fs";
import path from "node:path";
import {repairTaskDir} from "../../repairTask.js";
import {copyFixtureTasks, createTempDir, HASHES_FILE, sha1} from "../testHelpers.js";

describe("repair against fixtures (integration)", () => {
    let hashes: Record<string, string>;

    beforeAll(() => {
        hashes = JSON.parse(fs.readFileSync(HASHES_FILE, "utf8"));
    });

    describe("dry-run mode", () => {
        let tmpRoot: string;
        let tasksDir: string;
        let cleanup: () => void;

        beforeEach(() => {
            const td = createTempDir("zoo-repair-int-");
            tmpRoot = td.root;
            tasksDir = td.tasksDir;
            cleanup = td.cleanup;
            copyFixtureTasks(tasksDir);
        });

        afterEach(() => {
            cleanup();
        });

        it("reports repairs but does not modify files", () => {
            // Target: 019fdc9c — placeholder_task_name, zero_size, zero_tokens, empty_ui_messages
            const taskDir = path.join(tasksDir, "019fdc9c-a59f-75d9-bf05-4fd3d4fe4913");
            const r = repairTaskDir(taskDir, { dryRun: true, backup: false });

            expect(r.uiRepaired).toBe(true);
            expect(r.taskRepaired).toBe(true);
            expect(r.sizeRepaired).toBe(true);

            // Files should NOT have changed
            const hiPath = path.join(taskDir, "history_item.json");
            const hiHash = sha1(hiPath);
            expect(hiHash).toBe(hashes["019fdc9c-a59f-75d9-bf05-4fd3d4fe4913/history_item.json"]);
        });
    });

    describe("write mode", () => {
        let tmpRoot: string;
        let tasksDir: string;
        let cleanup: () => void;

        beforeEach(() => {
            const td = createTempDir("zoo-repair-int-");
            tmpRoot = td.root;
            tasksDir = td.tasksDir;
            cleanup = td.cleanup;
            copyFixtureTasks(tasksDir);
        });

        afterEach(() => {
            cleanup();
        });

        it("repairs empty ui_messages.json", () => {
            // 019fdc9c has empty_ui_messages
            const taskDir = path.join(tasksDir, "019fdc9c-a59f-75d9-bf05-4fd3d4fe4913");
            const r = repairTaskDir(taskDir, { dryRun: false, backup: false });

            expect(r.uiRepaired).toBe(true);
            expect(r.errors).toEqual([]);

            // ui_messages.json should now have content (not 3B "[]")
            const uiPath = path.join(taskDir, "ui_messages.json");
            const ui = JSON.parse(fs.readFileSync(uiPath, "utf8"));
            expect(Array.isArray(ui)).toBe(true);
            expect(ui.length).toBeGreaterThan(0);
        });

        it("repairs placeholder task name from ACH", () => {
            // 019f0f12 has placeholder_task_name "Task #1 (Incomplete)"
            const taskDir = path.join(tasksDir, "019f0f12-02f9-70df-a35e-2b110efe4107");
            const r = repairTaskDir(taskDir, { dryRun: false, backup: false });

            expect(r.taskRepaired).toBe(true);

            const hi = JSON.parse(
                fs.readFileSync(path.join(taskDir, "history_item.json"), "utf8"),
            );
            expect(hi.task).not.toMatch(/^Task\s*#\s*\d+/);
        });

        it("repairs zero_size", () => {
            // 019fdcf5 has zero_size
            const taskDir = path.join(tasksDir, "019fdcf5-64ad-709f-a1d1-00d1a59c6f8e");
            const r = repairTaskDir(taskDir, { dryRun: false, backup: false });

            expect(r.sizeRepaired).toBe(true);

            const hi = JSON.parse(
                fs.readFileSync(path.join(taskDir, "history_item.json"), "utf8"),
            );
            expect(hi.size).toBeGreaterThan(0);
        });

        it("repairs zero_tokens via estimation", () => {
            // 019fdcf5 has zero_tokens and sufficient ACH (178 entries) for estimation
            const taskDir = path.join(tasksDir, "019fdcf5-64ad-709f-a1d1-00d1a59c6f8e");
            const r = repairTaskDir(taskDir, { dryRun: false, backup: false });

            expect(r.tokensRepaired).toBe(true);
            expect(r.tokensRecoverySource).toBe("estimate");

            const hi = JSON.parse(
                fs.readFileSync(path.join(taskDir, "history_item.json"), "utf8"),
            );
            // Token estimation from scrambled ACH should produce positive counts
            expect(hi.tokensIn).toBeGreaterThan(0);
            expect(hi.tokensOut).toBeGreaterThan(0);
            // totalCost depends on apiConfigName recognition (scrambled) — just verify it's set
            expect(typeof hi.totalCost).toBe("number");
        });

        it("repairs zero_tokens via index recovery", () => {
            // 019fb786 has zero_tokens; its index entry has token data
            const taskDir = path.join(tasksDir, "019fb786-503a-76ca-8708-fee1243c878d");
            const idx = JSON.parse(
                fs.readFileSync(path.join(tasksDir, "_index.json"), "utf8"),
            );
            const r = repairTaskDir(taskDir, {
                dryRun: false,
                backup: false,
                indexItems: idx.entries,
            });

            expect(r.tokensRepaired).toBe(true);
            expect(r.tokensRecoverySource).toBe("index");
        });

        it("handles missing_history_item gracefully", () => {
            // 019ede5a has no files
            const taskDir = path.join(tasksDir, "019ede5a-9327-70cc-9c54-2d227182e4d1");
            const r = repairTaskDir(taskDir, { dryRun: false, backup: false });

            expect(r.errors.length).toBeGreaterThan(0);
            expect(r.errors[0]).toContain("cannot repair");
        });

        it("creates backup files when backup enabled", () => {
            const taskDir = path.join(tasksDir, "019f0f12-02f9-70df-a35e-2b110efe4107");
            repairTaskDir(taskDir, { dryRun: false, backup: true });

            const files = fs.readdirSync(taskDir);
            const bakFiles = files.filter((f) => /\.\d{8}-\d{6}\.bak\.json$/.test(f));
            expect(bakFiles.length).toBeGreaterThanOrEqual(1);
        });
    });
});
