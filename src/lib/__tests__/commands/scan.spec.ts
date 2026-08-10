import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockScanStorage = vi.hoisted(() => vi.fn())
const mockRecoverabilityScore = vi.hoisted(() => vi.fn(() => "100%"))
const mockAlign = vi.hoisted(() => vi.fn((label: string, value: string) => `  ${label.padEnd(17)}${value}`))
const mockAlignSummary = vi.hoisted(() => vi.fn((label: string, value: string) => `${label.padEnd(19)}${value}`))
const mockCountEntries = vi.hoisted(() => vi.fn(() => 0))
const mockTaskMatch = vi.hoisted(() => vi.fn(() => null))
const mockTruncate = vi.hoisted(() => vi.fn((s: string | undefined) => s ?? ""))

vi.mock("../../cliContext.js", () => ({
    setRoot: mockSetRoot,
    setVersion: mockSetVersion,
    getVersionBanner: mockGetVersionBanner,
    resolveRoot: mockResolveRoot,
    ABBREV_HELP: "",
}))

vi.mock("../../scan.js", () => ({
    scanStorage: mockScanStorage,
}))

vi.mock("../../scanOutput.js", () => ({
    align: mockAlign,
    alignSummary: mockAlignSummary,
    countEntries: mockCountEntries,
    recoverabilityScore: mockRecoverabilityScore,
}))

vi.mock("../../paths.js", () => ({
    API_HISTORY_NAME: "api_conversation_history.json",
    UI_MESSAGES_NAME: "ui_messages.json",
}))

vi.mock("../../format.js", () => ({
    taskMatch: mockTaskMatch,
    truncate: mockTruncate,
}))

import {action} from "../../commands/scan.js"

describe("scan command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>
    let exitSpy: ReturnType<typeof vi.spyOn>

    const baseResult = {
        storageRoot: "/fake/root",
        tasksDir: "/fake/root/tasks",
        indexPath: "/fake/root/tasks/_index.json",
        indexItems: [{id: "a"}, {id: "b"}],
        taskDirs: ["/fake/root/tasks/a", "/fake/root/tasks/b"],
        corruptions: [] as any[],
    }

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any)
        mockResolveRoot.mockReturnValue("/fake/root")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("JSON mode: outputs JSON with corruption details", () => {
        mockScanStorage.mockReturnValue({
            ...baseResult,
            corruptions: [
                {taskId: "c1", dir: "/fake/root/tasks/c1", reasons: [{reason: "zero_size", source: "hi,idx"}], indexItem: null, diskItem: {task: "Real", size: 0}},
            ],
        })

        action({json: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("")
        const parsed = JSON.parse(output)
        expect(parsed.corruptions).toHaveLength(1)
        expect(parsed.corruptions[0].taskId).toBe("c1")
        expect(parsed.corruptions[0].reasons).toEqual([{reason: "zero_size", source: "hi,idx"}])
    })

    it("JSON mode, no corruptions: no exit", () => {
        mockScanStorage.mockReturnValue({...baseResult, corruptions: []})

        action({json: true})

        expect(exitSpy).not.toHaveBeenCalled()
    })

    it("text mode: prints summary block", () => {
        mockScanStorage.mockReturnValue({...baseResult})

        action({})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Storage:")
        expect(output).toContain("Tasks:")
        expect(output).toContain("Index:")
        expect(output).toContain("Index entries:")
        expect(output).toContain("Task dirs:")
        expect(output).toContain("Corruptions:")
    })

    it("text mode with corruptions, no quiet: prints per-task details", () => {
        mockScanStorage.mockReturnValue({
            ...baseResult,
            corruptions: [
                {taskId: "c1", dir: "/fake/root/tasks/c1", reasons: [{reason: "zero_size", source: "hi"}], indexItem: null, diskItem: null},
            ],
        })

        action({})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("c1")
        expect(output).toContain("reasons:")
        expect(output).toContain("recoverability:")
    })

    it("quiet mode: suppresses per-task details but shows summary", () => {
        mockScanStorage.mockReturnValue({
            ...baseResult,
            corruptions: [
                {taskId: "c1", dir: "/fake/root/tasks/c1", reasons: [{reason: "zero_size", source: "hi"}], indexItem: null, diskItem: null},
            ],
        })

        action({quiet: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("Corruptions:")
        expect(output).not.toContain("reasons:")
    })

    it("text mode with corruptions: exits with corruption count", () => {
        mockScanStorage.mockReturnValue({
            ...baseResult,
            corruptions: [
                {taskId: "c1", reasons: [], indexItem: null, diskItem: null},
                {taskId: "c2", reasons: [], indexItem: null, diskItem: null},
            ],
        })

        action({quiet: true})
        expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it("passes verifyUiSync to scanStorage", () => {
        mockScanStorage.mockReturnValue({...baseResult})

        action({verifyUiSync: true})

        expect(mockScanStorage).toHaveBeenCalledWith("/fake/root", {verifyUiSync: true})
    })
})
