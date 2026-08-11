import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => `${r}/tasks`))
const mockRepairAllCorrupted = vi.hoisted(() => vi.fn())
const mockFormatRepairParts = vi.hoisted(() => vi.fn((r: any) => {
    const parts: string[] = []
    if (r.uiRepaired) parts.push("ui(ach→uim)")
    if (r.taskRepaired) parts.push("task(ach→hi)")
    return parts
}))
const mockAlignSummary = vi.hoisted(() => vi.fn((label: string, value: string) => `${label.padEnd(19)}${value}`))

vi.mock("../../cliContext.js", () => ({
    setRoot: mockSetRoot,
    setVersion: mockSetVersion,
    getVersionBanner: mockGetVersionBanner,
    resolveRoot: mockResolveRoot,
    ABBREV_HELP: "",
}))

vi.mock("../../paths.js", () => ({
    resolveTasksDir: mockResolveTasksDir,
}))

vi.mock("../../repairAll.js", () => ({
    repairAllCorrupted: mockRepairAllCorrupted,
}))

vi.mock("../../repairTask.js", () => ({
    formatRepairParts: mockFormatRepairParts,
}))

vi.mock("../../scanOutput.js", () => ({
    alignSummary: mockAlignSummary,
}))

vi.mock("../../format.js", () => ({
    c: {red: "red", green: "green", yellow: "yellow"},
    colorize: vi.fn((s: string) => s),
}))

import {action} from "../../commands/repairAll.js"

describe("repairAll command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        mockResolveRoot.mockReturnValue("/fake/root")
        mockResolveTasksDir.mockReturnValue("/fake/root/tasks")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("dry-run: shows [DRY-RUN] prefix and dry-run message", async () => {
        mockRepairAllCorrupted.mockReturnValue({
            total: 1,
            repaired: 1,
            failed: 0,
            unrepairable: 0,
            results: [{taskId: "t1", uiRepaired: true, errors: [], unrepairable: false}],
            indexEntries: 0,
            indexAdded: [],
            indexRemoved: [],
        })

        await action({force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("[DRY-RUN]")
        expect(output).toContain("would repair")
        expect(output).toContain("Dry-run")
    })

    it("force: shows repaired with no [DRY-RUN] prefix", async () => {
        mockRepairAllCorrupted.mockReturnValue({
            total: 1,
            repaired: 1,
            failed: 0,
            unrepairable: 0,
            results: [{taskId: "t1", uiRepaired: true, errors: [], unrepairable: false}],
            indexEntries: 0,
            indexAdded: [],
            indexRemoved: [],
        })

        await action({force: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("repaired")
        expect(output).not.toContain("[DRY-RUN]")
        expect(output).not.toContain("Dry-run")
    })

    it("shows unrepairable tasks", async () => {
        mockRepairAllCorrupted.mockReturnValue({
            total: 1,
            repaired: 0,
            failed: 0,
            unrepairable: 1,
            results: [{taskId: "t1", unrepairable: true, errors: ["missing ACH"], uiRepaired: false}],
            indexEntries: 0,
            indexAdded: [],
            indexRemoved: [],
        })

        await action({force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("UNREPAIRABLE")
        expect(output).toContain("missing ACH")
    })

    it("shows failed tasks", async () => {
        mockRepairAllCorrupted.mockReturnValue({
            total: 1,
            repaired: 0,
            failed: 1,
            unrepairable: 0,
            results: [{taskId: "t1", errors: ["something went wrong"], unrepairable: false, uiRepaired: false}],
            indexEntries: 0,
            indexAdded: [],
            indexRemoved: [],
        })

        await action({force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("FAILED")
        expect(output).toContain("something went wrong")
    })

    it("verbose: shows 'nothing to repair' for no-op tasks", async () => {
        mockRepairAllCorrupted.mockReturnValue({
            total: 1,
            repaired: 0,
            failed: 0,
            unrepairable: 0,
            results: [{taskId: "t1", errors: [], unrepairable: false, uiRepaired: false}],
            indexEntries: 0,
            indexAdded: [],
            indexRemoved: [],
        })

        await action({force: false, verbose: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("nothing to repair")
    })

    it("shows index rebuild summary with added and removed", async () => {
        mockRepairAllCorrupted.mockReturnValue({
            total: 0,
            repaired: 0,
            failed: 0,
            unrepairable: 0,
            results: [],
            indexEntries: 5,
            indexAdded: ["new1"],
            indexRemoved: ["old1"],
        })

        await action({force: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("_index.json rebuilt: 5 entries")
        expect(output).toContain("+1 added: new1")
        expect(output).toContain("−1 removed: old1")
    })

    it("passes options to repairAllCorrupted", async () => {
        mockRepairAllCorrupted.mockReturnValue({
            total: 0, repaired: 0, failed: 0, unrepairable: 0,
            results: [], indexEntries: 0, indexAdded: [], indexRemoved: [],
        })

        await action({force: true, backup: false, fixedInputToken: 1000})

        expect(mockRepairAllCorrupted).toHaveBeenCalledWith("/fake/root", {
            dryRun: false,
            backup: false,
            fixedInputToken: 1000,
        })
    })
})
