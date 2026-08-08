/**
 * Integration tests: scan against real(istic) scrambled fixture data.
 * Read-only — works directly on tests/fixtures/, no temp copy needed.
 */
import path from "node:path";
import { scanStorage } from "../../scan.js";

const FIXTURE_ROOT = path.resolve("tests/fixtures");

// Expected corruption patterns per task (must match actual fixture data)
const EXPECTED: Record<string, string[]> = {
    "019ede5a-9327-70cc-9c54-2d227182e4d1": [
        "missing_history_item",
        "folder_orphan",
    ],
    "019f0f12-02f9-70df-a35e-2b110efe4107": [
        "placeholder_task_name",
        "interrupted_task",
    ],
    "019fb786-503a-76ca-8708-fee1243c878d": [
        "placeholder_task_name",
        "zero_tokens",
        "interrupted_task",
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

describe("scan against fixtures (integration)", () => {
    const result = scanStorage(FIXTURE_ROOT);

    it("detects all expected corrupt tasks", () => {
        const corruptIds = result.corruptions.map((c) => c.taskId);
        for (const id of Object.keys(EXPECTED)) {
            expect(corruptIds).toContain(id);
        }
    });

    it("reports correct corruption reasons per task", () => {
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

    it("reports zero corruptions for healthy tasks", () => {
        for (const id of HEALTHY) {
            const c = result.corruptions.find((x) => x.taskId === id);
            expect(c, `healthy task ${id} should not appear in corruptions`).toBeUndefined();
        }
    });

    it("has correct index and task dir counts", () => {
        expect(result.indexItems.length).toBe(9); // 10 tasks minus 019fde29 (orphan)
        expect(result.taskDirs.length).toBe(11);
        expect(result.corruptions.length).toBe(7);
    });

    it("folder_orphan tasks have null indexItem", () => {
        const orphans = result.corruptions.filter((c) =>
            c.reasons.some(r => r.reason === "folder_orphan"),
        );
        for (const o of orphans) {
            expect(o.indexItem).toBeNull();
        }
    });
});
