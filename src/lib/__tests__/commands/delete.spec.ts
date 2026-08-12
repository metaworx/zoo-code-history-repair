import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => `${r}/tasks`))
const mockResolveIndexPath = vi.hoisted(() => vi.fn((td: string) => `${td}/_index.json`))
const mockIdxSave = vi.hoisted(() => vi.fn())
const mockIdxSetData = vi.hoisted(() => vi.fn())
const mockIdxGetEntries = vi.hoisted(() => vi.fn(() => [] as Array<{ id: string }>))
const mockIdxRemoveById = vi.hoisted(() => vi.fn((id: string) => {
    const arr = mockIdxGetEntries()
    const idx = arr.findIndex((e: any) => e.id === id)
    if (idx === -1) return false
    arr.splice(idx, 1)
    return true
}))
const mockIdxConstructor = vi.hoisted(() => vi.fn(function (this: any) {
    this.getEntries = mockIdxGetEntries
    this.removeById = mockIdxRemoveById
    this.setData = mockIdxSetData
    this.save = mockIdxSave
    this.filePath = "/fake/root/tasks/_index.json"
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
    DEFAULT_INDEX_NAME: "_index.json",
}))

vi.mock("../../IndexTransaction.js", () => ({
    IndexTransaction: mockIdxConstructor,
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
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
        })
        exitSpy = vi.spyOn(process, "exit" as any).mockImplementation(() => undefined) as any
        mockResolveRoot.mockReturnValue("/fake/root")
        mockResolveTasksDir.mockReturnValue("/fake/root/tasks")
        mockResolveIndexPath.mockReturnValue("/fake/root/tasks/_index.json")
        mockIdxGetEntries.mockReturnValue([])
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("dry-run: prints would-delete messages and returns without modifying", async () => {
        await action("task-123", {force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Would delete:")
        expect(output).toContain("task-123")
        expect(output).toContain("Would remove _index entry")
        expect(mockIdxSave).not.toHaveBeenCalled()
        expect(exitSpy).not.toHaveBeenCalled()
    })

    it("force: dir not found prints message and still strips index", async () => {
        await action("ghost", {force: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Directory not found:")
        expect(output).toContain("ghost")
        expect(output).toContain("Stripped ghost from _index.json")
    })

    it("force: strips array-format index entry with backup", async () => {
        mockIdxGetEntries.mockReturnValue([
            {id: "task-1"}, {id: "task-2"}, {id: "task-3"},
        ])

        await action("task-2", {force: true, backup: true})

        expect(mockIdxSave).toHaveBeenCalledWith(false, true)
        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("3 → 2 entries")
    })

    it("force: strips index entry with backup disabled", async () => {
        mockIdxGetEntries.mockReturnValue([
            {id: "a"}, {id: "b"},
        ])

        await action("a", {force: true, backup: false})

        expect(mockIdxSave).toHaveBeenCalledWith(false, false)
        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("2 → 1 entries")
    })
})
