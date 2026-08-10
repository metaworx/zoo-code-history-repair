import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => `${r}/tasks`))
const mockRebuildIndexFromDisk = vi.hoisted(() => vi.fn())

vi.mock("../../cliContext.js", () => ({
    setRoot: mockSetRoot,
    setVersion: mockSetVersion,
    getVersionBanner: mockGetVersionBanner,
    resolveRoot: mockResolveRoot,
}))

vi.mock("../../paths.js", () => ({
    resolveTasksDir: mockResolveTasksDir,
}))

vi.mock("../../rebuildIndex.js", () => ({
    rebuildIndexFromDisk: mockRebuildIndexFromDisk,
}))

vi.mock("../../format.js", () => ({
    c: {red: "red"},
    colorize: vi.fn((s: string) => s),
}))

import {action} from "../../commands/rebuildIndex.js"

describe("rebuildIndex command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        mockResolveRoot.mockReturnValue("/fake/root")
        mockResolveTasksDir.mockReturnValue("/fake/root/tasks")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("dry-run: prints item count and dry-run message", () => {
        mockRebuildIndexFromDisk.mockReturnValue({
            items: [{id: "a"}, {id: "b"}, {id: "c"}],
            backupPath: null,
        })

        action({force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Rebuilt index with 3 items")
        expect(output).toContain("Dry-run")
        expect(output).not.toContain("Written:")
    })

    it("force with backup: prints written path and backup path", () => {
        mockRebuildIndexFromDisk.mockReturnValue({
            items: [{id: "x"}],
            backupPath: "/fake/root/tasks/_index.json.bak",
        })

        action({force: true, backup: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Rebuilt index with 1 items")
        expect(output).toContain("Written:")
        expect(output).toContain("Backup:")
    })

    it("force without backup: no backup path displayed", () => {
        mockRebuildIndexFromDisk.mockReturnValue({
            items: [],
            backupPath: null,
        })

        action({force: true, backup: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Rebuilt index with 0 items")
        expect(output).toContain("Written:")
        expect(output).not.toContain("Backup:")
    })

    it("passes dryRun and backup options to rebuildIndexFromDisk", () => {
        mockRebuildIndexFromDisk.mockReturnValue({items: [], backupPath: null})

        action({force: false, backup: false})

        expect(mockRebuildIndexFromDisk).toHaveBeenCalledWith("/fake/root", {
            dryRun: true,
            backup: false,
        })
    })
})
