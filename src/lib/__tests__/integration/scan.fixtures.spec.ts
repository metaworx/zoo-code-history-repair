/**
 * @file src/lib/__tests__/integration/scan.fixtures.spec.ts
 *
 * Integration tests: scan against real(istic) scrambled fixture data.
 * Read-only — works directly on tests/fixtures/, no temp copy needed.
 */
import path from "node:path";
import {scanStorage} from "../../scan.js";
import {countEntries, recoverabilityScore} from "../../scanOutput.js";
import {API_HISTORY_NAME, UI_MESSAGES_NAME} from "../../paths.js";

const FIXTURE_ROOT = path.resolve("tests/fixtures");
const TASKS_DIR = path.join(FIXTURE_ROOT, "tasks");

// Expected corruption patterns per task (must match actual fixture data)
const EXPECTED: Record<string, string[]> = {
    "019ede5a-9327-70cc-9c54-2d227182e4d1": [
        "missing_history_item",
        "folder_orphan",
    ],
    "019f0f12-02f9-70df-a35e-2b110efe4107": [
        "placeholder_task_name",
        "interrupted_task",
        "missing_task_dir",
    ],
    "019fb786-503a-76ca-8708-fee1243c878d": [
        "placeholder_task_name",
        "zero_tokens",
        "interrupted_task",
        "missing_task_dir",
    ],
    "019fdc9c-a59f-75d9-bf05-4fd3d4fe4913": [
        "placeholder_task_name",
        "zero_size",
        "zero_tokens",
        "empty_ui_messages",
        "interrupted_task",
    ],
    "019fdcf5-64ad-709f-a1d1-00d1a59c6f8e": [
        "zero_tokens",
        "zero_size",
        "interrupted_task",
    ],
    "019fddaa-5136-7106-abef-adac81fd56a3": [
        "zero_tokens",
    ],
    "019fde29-32cc-76c3-a156-e5287fc5fd2c": [
        "folder_orphan",
    ],
};

// Healthy task IDs that should have zero corruption
const HEALTHY = new Set([
    "019f726a-0f50-711c-929e-9546e5100546",
    "019f7283-2ef5-72a9-b5d1-437ee56c9fa9",
    "019f726c-d9c7-7566-a586-4cfd467eaaca",
    "019fdcba-5173-74cd-a9c3-9663d7917aa2",
]);

describe("scan against fixtures (integration)", async () => {
    const result = await scanStorage(FIXTURE_ROOT);

    it("detects all expected corrupt tasks", async () => {
        const corruptIds = result.corruptions.map((c) => c.taskId);
        for (const id of Object.keys(EXPECTED)) {
            expect(corruptIds).toContain(id);
        }
    });

    it("reports correct corruption reasons per task", async () => {
        for (const [id, expectedReasons] of Object.entries(EXPECTED)) {
            const c = result.corruptions.find((x) => x.taskId === id);
            expect(c, `missing corruption entry for ${id}`).toBeDefined();
            const reasonNames = c!.reasons.map(r => r.reason);
            for (const reason of expectedReasons) {
                expect(reasonNames, `${id}: expected ${reason}`).toContain(reason);
            }
            // All reasons should be accounted for
            expect(reasonNames.length, `${id}: unexpected extra reasons: ${reasonNames.join(", ")}`)
                .toBe(expectedReasons.length);
        }
    });

    it("reports zero corruptions for healthy tasks", async () => {
        for (const id of HEALTHY) {
            const c = result.corruptions.find((x) => x.taskId === id);
            expect(c, `healthy task ${id} should not appear in corruptions`).toBeUndefined();
        }
    });

    it("has correct index and task dir counts", async () => {
        expect(result.indexItems.length).toBe(9); // 10 tasks minus 019fde29 (orphan)
        expect(result.taskDirs.length).toBe(11);
        expect(result.corruptions.length).toBe(7);
    });

    it("folder_orphan tasks have null indexItem", async () => {
        const orphans = result.corruptions.filter((c) =>
            c.reasons.some(r => r.reason === "folder_orphan"),
        );
        for (const o of orphans) {
            expect(o.indexItem).toBeNull();
        }
    });
});

describe("scan output helpers against fixtures (integration)", async () => {
    const result = await scanStorage(FIXTURE_ROOT);

    // Expected entry counts per corrupt task (matching CLI output)
    const ENTRY_COUNTS: Record<string, { ach: number; uim: number }> = {
        "019ede5a-9327-70cc-9c54-2d227182e4d1": {ach: 0, uim: 0},
        "019f0f12-02f9-70df-a35e-2b110efe4107": {ach: 256, uim: 113},
        "019fb786-503a-76ca-8708-fee1243c878d": {ach: 516, uim: 1},
        "019fdc9c-a59f-75d9-bf05-4fd3d4fe4913": {ach: 142, uim: 0},
        "019fdcf5-64ad-709f-a1d1-00d1a59c6f8e": {ach: 178, uim: 438},
        "019fddaa-5136-7106-abef-adac81fd56a3": {ach: 1, uim: 3},
        "019fde29-32cc-76c3-a156-e5287fc5fd2c": {ach: 84, uim: 188},
    };

    it("countEntries returns correct ACH/UIM counts for all corrupt tasks", async () => {
        for (const c of result.corruptions) {
            const expected = ENTRY_COUNTS[c.taskId];
            expect(expected, `no expected counts for ${c.taskId}`).toBeDefined();
            const ach = await countEntries(c.dir, API_HISTORY_NAME);
            const uim = await countEntries(c.dir, UI_MESSAGES_NAME);
            expect(ach, `${c.taskId}: ACH entries`).toBe(expected.ach);
            expect(uim, `${c.taskId}: UIM entries`).toBe(expected.uim);
        }
    });

    it("countEntries does not throw on corrupt ui_messages.json (regression)", async () => {
        // Task 019f0f12-02f9-70df-a35e-2b110efe4107 has scrambled say/type fields
        // that triggered the validation crash before the fix.
        const taskDir = path.join(TASKS_DIR, "019f0f12-02f9-70df-a35e-2b110efe4107");
        const uimCount = await countEntries(taskDir, UI_MESSAGES_NAME);
        expect(uimCount).toBe(113);
        const achCount = await countEntries(taskDir, API_HISTORY_NAME);
        expect(achCount).toBe(256);
    });

    it("countEntries returns 0 for missing file", async () => {
        const taskDir = path.join(TASKS_DIR, "019ede5a-9327-70cc-9c54-2d227182e4d1");
        const count = await countEntries(taskDir, UI_MESSAGES_NAME);
        expect(count).toBe(0);
    });

    it("countEntries returns 0 for undefined dir", async () => {
        expect(await countEntries(undefined, UI_MESSAGES_NAME)).toBe(0);
    });

    it("recoverabilityScore matches expected values", async () => {
        const EXPECTED_SCORES: Record<string, string> = {
            "019ede5a-9327-70cc-9c54-2d227182e4d1": "0%",
            "019f0f12-02f9-70df-a35e-2b110efe4107": "33%",
            "019fb786-503a-76ca-8708-fee1243c878d": "50%",
            "019fdc9c-a59f-75d9-bf05-4fd3d4fe4913": "70%",
            "019fdcf5-64ad-709f-a1d1-00d1a59c6f8e": "50%",
            "019fddaa-5136-7106-abef-adac81fd56a3": "50%",
            "019fde29-32cc-76c3-a156-e5287fc5fd2c": "0%",
        };
        for (const c of result.corruptions) {
            const expected = EXPECTED_SCORES[c.taskId];
            expect(expected, `no expected score for ${c.taskId}`).toBeDefined();
            expect(await recoverabilityScore(c), `${c.taskId} score`).toBe(expected);
        }
    });
});
