import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => `${r}/tasks`))
const mockResolveIndexPath = vi.hoisted(() => vi.fn((td: string) => `${td}/_index.json`))
const mockBackupFile = vi.hoisted(() => vi.fn((p: string) => `${p}.bak`))
const mockWriteJsonCompact = vi.hoisted(() => vi.fn())

const mockTransactionRead = vi.hoisted(() => vi.fn())
const mockJsonFileTransaction = vi.hoisted(() => vi.fn(function (this: {read: typeof mockTransactionRead}, path: string, create: boolean, defaultVal: unknown) {
    this.read = mockTransactionRead
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
    resolveIndexPath: mockResolveIndexPath,
}))

vi.mock("../../file.js", () => ({
    backupFile: mockBackupFile,
    writeJsonCompact: mockWriteJsonCompact,
    JsonFileTransaction: mockJsonFileTransaction,
}))

vi.mock("../../format.js", () => ({
    c: {red: "red"},
    colorize: vi.fn((s: string) => s),
}))

import {action} from "../../commands/delete.js"

describe("delete command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>
    let exitSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any)
        mockResolveRoot.mockReturnValue("/fake/root")
        mockResolveTasksDir.mockReturnValue("/fake/root/tasks")
        mockResolveIndexPath.mockReturnValue("/fake/root/tasks/_index.json")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("dry-run: prints would-delete messages and returns without modifying", () => {
        action("task-123", {force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Would delete:")
        expect(output).toContain("task-123")
        expect(output).toContain("Would remove _index entry")
        expect(mockBackupFile).not.toHaveBeenCalled()
        expect(mockWriteJsonCompact).not.toHaveBeenCalled()
        expect(exitSpy).not.toHaveBeenCalled()
    })

    it("force: dir not found prints message and checks index", () => {
        mockTransactionRead.mockReturnValue(null)

        action("ghost", {force: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Directory not found:")
        expect(output).toContain("ghost")
        expect(output).toContain("Index not found")
    })

    it("force: strips array-format index entry with backup", () => {
        mockTransactionRead.mockReturnValue([
            {id: "task-1"}, {id: "task-2"}, {id: "task-3"},
        ])

        action("task-2", {force: true, backup: true})

        expect(mockBackupFile).toHaveBeenCalled()
        expect(mockWriteJsonCompact).toHaveBeenCalledWith(
            "/fake/root/tasks/_index.json",
            [{id: "task-1"}, {id: "task-3"}],
        )
        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("3 → 2 entries")
    })

    it("force: strips entries-format index entry with backup disabled", () => {
        mockTransactionRead.mockReturnValue({
            entries: [{id: "a"}, {id: "b"}],
        })

        action("a", {force: true, backup: false})

        expect(mockBackupFile).not.toHaveBeenCalled()
        expect(mockWriteJsonCompact).toHaveBeenCalledWith(
            "/fake/root/tasks/_index.json",
            {entries: [{id: "b"}]},
        )
        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("2 → 1 entries")
    })
})
