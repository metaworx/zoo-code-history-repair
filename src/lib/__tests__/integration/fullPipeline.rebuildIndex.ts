/**
 * Integration test: rebuild-index → list-corrupt reduces index_orphans, adds folder_orphans.
 *
 * rebuild-index reads task directories from disk and rebuilds _index.json.
 * This removes index_orphans (entries without folders) and adds folder_orphans
 * (folders without entries).
 */
import path from "node:path";
import {expect, vi} from "vitest";
import {action as listCorruptAction} from "../../commands/listCorrupt.js";
import {action as rebuildIndexAction} from "../../commands/rebuildIndex.js";
import {getJsonOutput, quotePathRegex, readJson} from "../testHelpers.js";
import {DEFAULT_INDEX_NAME} from "../../paths.js";

export default (tasksDir: string, consoleLogSpy: ReturnType<typeof vi.spyOn>, tmpRoot: string) => () => {
    // ── Phase 1: list-corrupt --json before rebuild ──
    consoleLogSpy.mockClear();
    listCorruptAction({json: true});
    const lcJson1 = getJsonOutput(consoleLogSpy) as Record<string, unknown>;
    const corruptions1 = lcJson1.corruptions as Array<Record<string, unknown>>;
    expect(corruptions1.length).toBe(7);

    // ── Phase 2: rebuild-index dry-run ──
    consoleLogSpy.mockClear();
    rebuildIndexAction({force: false});
    const dryOut = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
    expect(dryOut).toContain("Rebuilt index with 6 items");
    expect(dryOut).toContain("Dry-run — nothing written");

    // ── Phase 3: rebuild-index --force ──
    consoleLogSpy.mockClear();
    rebuildIndexAction({force: true, backup: true});
    const forceOut = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
    expect(forceOut).toContain("Rebuilt index with 6 items");
    expect(forceOut).toContain("Written:");
    expect(forceOut).toContain("_index.json");
    expect(forceOut).toContain("Backup:");

    // ── Phase 4: list-corrupt --json after rebuild (folder_orphans added) ──
    consoleLogSpy.mockClear();
    listCorruptAction({json: true});
    const lcJson2 = getJsonOutput(consoleLogSpy) as Record<string, unknown>;
    const corruptions2 = lcJson2.corruptions as Array<Array<Record<string, unknown>>>;
    // After rebuild-index, previously-indexed tasks that had folders become folder_orphans
    // The 019fde29 was already a folder_orphan. The 019ede5a is still missing_history_item + folder_orphan.
    // All tasks should still appear (some now with folder_orphan added)
    expect(corruptions2.length).toBe(7);

    // 019f0f12 should now also have folder_orphan (was previously in index, now rebuilt from disk only)
    const f0f12 = corruptions2.find((c: any) => c.taskId === "019f0f12-02f9-70df-a35e-2b110efe4107");
    expect(f0f12).toBeDefined();
    const f0f12Reasons = (f0f12 as any).reasons.map((r: any) => r.reason);
    expect(f0f12Reasons).toContain("folder_orphan");

    // ── Phase 5: rebuild-index --force again (idempotent) ──
    consoleLogSpy.mockClear();
    rebuildIndexAction({force: true, backup: true});
    const idemOut = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
    expect(idemOut).toContain("Rebuilt index with 6 items");
    expect(idemOut).toContain("Written:");
    expect(idemOut).toContain("_index.json");

    expect(readJson(path.join(tasksDir, DEFAULT_INDEX_NAME))).toDeepEqualJson(readJson('tests/fixtures/_index.rebuilt.json'), {
        ignoreProps: ['version', 'taskMatch', 'storageRoot'],
        replacements: {
            [`^${quotePathRegex(tmpRoot)}` as any]: "",
            [`^${quotePathRegex("tests/fixtures")}` as any]: "",
        },
        maxLength: 200,
    }, "scan json output before")

    // ── Phase 6: list-corrupt --json stable after idempotent rebuild ──
    consoleLogSpy.mockClear();
    listCorruptAction({json: true});
    const lcJson3 = getJsonOutput(consoleLogSpy) as Record<string, unknown>;
    const corruptions3 = lcJson3.corruptions as Array<Record<string, unknown>>;
    expect(corruptions3.length).toBe(corruptions2.length);
};
