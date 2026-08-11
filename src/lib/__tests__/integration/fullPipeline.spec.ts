// noinspection SqlNoDataSourceInspection

/**
 * Integration test: full repair pipeline (scan → repair → validate → idempotency).
 *
 * Exercises the complete cycle using CLI commands (for output parsing) and library
 * functions (for hash/backup verification), matching the pattern established in
 * repairTask.indexUpdate.spec.ts.
 *
 * Pipeline: list-corrupt → validate → repair-all → list-corrupt → validate
 *           → repair-all → list-corrupt → validate
 *
 * The second repair pass verifies idempotency (no new repairs needed).
 * The third list-corrupt/validate pass verifies stability.
 */
import {afterEach, beforeEach, describe, it, vi} from "vitest";
import {copyFixtureTasks, createTempDir} from "../testHelpers.js";
import repairAll from './fullPipeline.repairAll.js'
import repairTask from './fullPipeline.repairTask.js'
import deleteTask from './fullPipeline.delete.js'
import rebuildIndex from './fullPipeline.rebuildIndex.js'

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
    truncate: vi.fn((s: string | null | undefined, _max: number) => s ?? ""),
    taskMatch: vi.fn(() => null),
}));


describe("full pipeline (integration)", () => {
    let tmpRoot: string;
    let tasksDir: string;
    let cleanup: () => void;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        const td = createTempDir("zoo-full-pl-");
        tmpRoot = td.root;
        tasksDir = td.tasksDir;
        cleanup = td.cleanup;
        copyFixtureTasks(tasksDir);
        mockResolveRoot.mockReturnValue(tmpRoot);
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
        });
        exitSpy = vi.spyOn(process, "exit" as any).mockImplementation(() => undefined) as any;
    });

    afterEach(async () => {
        await new Promise(r => setTimeout(r, 150));
        vi.clearAllMocks();
        cleanup();
    });

    it("scan→repair→validate cycle reduces corruption and is idempotent", () => repairAll(tmpRoot, tasksDir, consoleLogSpy)());
    it("repair-task → index update (preserves all index entries after targeted repair)", () => repairTask(tasksDir, consoleLogSpy)());
    it("delete unrepairable task removes it from list-corrupt and is idempotent", () => deleteTask(tasksDir, consoleLogSpy)());
    it("rebuild-index removes index_orphans and adds folder_orphans from disk", () => rebuildIndex(tasksDir, consoleLogSpy, tmpRoot)());

});
