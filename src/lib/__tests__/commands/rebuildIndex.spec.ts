import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => `${r}/tasks`))
const mockRepair = vi.hoisted(() => vi.fn())
const mockSave = vi.hoisted(() => vi.fn(() => null))
const mockIndexTransaction = vi.hoisted(() => vi.fn(function (this: any) {
    this.repair = mockRepair
    this.save = mockSave
    return this
}))

vi.mock("../../cliContext.js", () => ({
    setRoot: mockSetRoot,
    setVersion: mockSetVersion,
    getVersionBanner: mockGetVersionBanner,
    resolveRoot: mockResolveRoot,
}))

vi.mock("../../paths.js", () => ({
    resolveTasksDir: mockResolveTasksDir,
}))

vi.mock("../../IndexTransaction.js", () => ({
    IndexTransaction: mockIndexTransaction,
}))

vi.mock("../../format.js", () => ({
    c: {red: "red"},
    colorize: vi.fn((s: string) => s),
}))

import {action} from "../../commands/rebuildIndex.js"

describe("rebuildIndex command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
        })
        mockResolveRoot.mockReturnValue("/fake/root")
        mockResolveTasksDir.mockReturnValue("/fake/root/tasks")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("dry-run: prints item count and dry-run message", () => {
        mockRepair.mockReturnValue({
            items: [{id: "a"}, {id: "b"}, {id: "c"}],
            written: false,
        })

        action({force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Rebuilt index with 3 items")
        expect(output).toContain("Dry-run")
        expect(output).not.toContain("Written:")
    })

    it("force: prints written path", () => {
        mockRepair.mockReturnValue({
            items: [{id: "x"}],
            written: true,
        })

        action({force: true, backup: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Rebuilt index with 1 items")
        expect(output).toContain("Written:")
    })

    it("force: prints output even for empty index", () => {
        mockRepair.mockReturnValue({
            items: [],
            written: true,
        })

        action({force: true, backup: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Rebuilt index with 0 items")
        expect(output).toContain("Written:")
    })

    it("passes dryRun and backup options to repair", () => {
        mockRepair.mockReturnValue({items: [], written: false})

        action({force: false, backup: false})

        expect(mockRepair).toHaveBeenCalledWith(false, undefined, {
            dryRun: true,
            backup: false,
        })
    })
})
