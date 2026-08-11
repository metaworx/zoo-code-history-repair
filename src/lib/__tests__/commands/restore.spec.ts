import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => `${r}/tasks`))
const mockListBackups = vi.hoisted(() => vi.fn())
const mockRestoreFromBackups = vi.hoisted(() => vi.fn())
const mockDeleteBackups = vi.hoisted(() => vi.fn())

vi.mock("../../cliContext.js", () => ({
    setRoot: mockSetRoot,
    setVersion: mockSetVersion,
    getVersionBanner: mockGetVersionBanner,
    resolveRoot: mockResolveRoot,
}))

vi.mock("../../paths.js", () => ({
    resolveTasksDir: mockResolveTasksDir,
}))

vi.mock("../../restore.js", () => ({
    listBackups: mockListBackups,
    restoreFromBackups: mockRestoreFromBackups,
    deleteBackups: mockDeleteBackups,
}))

vi.mock("../../format.js", () => ({
    c: {red: "red"},
    colorize: vi.fn((s: string) => s),
}))

import {action} from "../../commands/restore.js"

describe("restore command", async () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>
    let exitSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any)
        mockResolveRoot.mockReturnValue("/fake/root")
        mockResolveTasksDir.mockReturnValue("/fake/root/tasks")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("list mode: no backups found", async () => {
        mockListBackups.mockReturnValue([])

        await action(undefined, undefined, {})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("No backup files found")
    })

    it("list mode: groups backups by task and timestamp", async () => {
        mockListBackups.mockReturnValue([
            {taskId: "t1", timestamp: "20260101-120000", bakPath: "/t1/x.bak", baseName: "history_item.json", basePath: "/t1/history_item.json"},
            {taskId: "t1", timestamp: "20260101-120000", bakPath: "/t1/y.bak", baseName: "ui_messages.json", basePath: "/t1/ui_messages.json"},
            {taskId: "t2", timestamp: "20260102-130000", bakPath: "/t2/z.bak", baseName: "history_item.json", basePath: "/t2/history_item.json"},
        ])

        await action(undefined, undefined, {})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("t1:")
        expect(output).toContain("t2:")
        expect(output).toContain("history_item.json")
        expect(output).toContain("ui_messages.json")
    })

    it("restore mode, dry-run: shows 'Would restore'", async () => {
        mockRestoreFromBackups.mockReturnValue({
            restored: [{taskId: "t1", timestamp: "20260101-120000", bakPath: "/t1/x.bak", baseName: "history_item.json", basePath: "/t1/history_item.json"}],
            skipped: [],
        })

        await action("t1", undefined, {force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Would restore")
        expect(output).not.toContain("Restored:")
    })

    it("restore mode, force: shows 'Restored'", async () => {
        mockRestoreFromBackups.mockReturnValue({
            restored: [{taskId: "t1", timestamp: "20260101-120000", bakPath: "/t1/x.bak", baseName: "history_item.json", basePath: "/t1/history_item.json"}],
            skipped: [],
        })

        await action("t1", undefined, {force: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Restored:")
    })

    it("restore mode: no matching backups", async () => {
        mockRestoreFromBackups.mockReturnValue({restored: [], skipped: []})

        await action("t1", "20260101-120000", {force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("No matching backups found")
    })

    it("restore mode: shows skipped items", async () => {
        mockRestoreFromBackups.mockReturnValue({
            restored: [],
            skipped: ["/t1/history_item.json (already matches backup)"],
        })

        await action("t1", undefined, {force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Skipped:")
    })

    it("delete mode, dry-run: shows 'Would delete'", async () => {
        mockDeleteBackups.mockReturnValue({
            deleted: ["/t1/history_item.json.bak"],
            skipped: [],
        })

        await action("t1", undefined, {delete: true, force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Would delete")
    })

    it("delete mode, force: shows 'Deleted'", async () => {
        mockDeleteBackups.mockReturnValue({
            deleted: ["/t1/history_item.json.bak"],
            skipped: [],
        })

        await action("t1", undefined, {delete: true, force: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Deleted:")
    })

    it("delete mode, no matching backups", async () => {
        mockDeleteBackups.mockReturnValue({deleted: [], skipped: []})

        await action("t1", undefined, {delete: true, force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("No matching backups found")
    })

    it("delete without taskId or timestamp: error and exit 1", async () => {
        await action(undefined, undefined, {delete: true})

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--delete requires"))
        expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it("passes options to restoreFromBackups", async () => {
        mockRestoreFromBackups.mockReturnValue({restored: [], skipped: []})

        await action("t1", "20260101-120000", {force: false})

        expect(mockRestoreFromBackups).toHaveBeenCalledWith("/fake/root/tasks", {
            taskId: "t1",
            timestamp: "20260101-120000",
            dryRun: true,
        })
    })

    it("passes options to deleteBackups", async () => {
        mockDeleteBackups.mockReturnValue({deleted: [], skipped: []})

        await action("t1", "20260101-120000", {delete: true, force: true})

        expect(mockDeleteBackups).toHaveBeenCalledWith("/fake/root/tasks", {
            taskId: "t1",
            timestamp: "20260101-120000",
            dryRun: false,
        })
    })
})
