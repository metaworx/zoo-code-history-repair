import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockScanStorage = vi.hoisted(() => vi.fn())
const mockRecoverabilityScore = vi.hoisted(() => vi.fn((c: any) => "75%"))

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
    recoverabilityScore: mockRecoverabilityScore,
}))

import {action} from "../../commands/listCorrupt.js"

describe("listCorrupt command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>
    let exitSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any)
        mockResolveRoot.mockReturnValue("/fake/root")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("no corruptions: no output lines, no exit", () => {
        mockScanStorage.mockReturnValue({
            corruptions: [],
        })

        action({})

        // Only version banner printed
        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("")
        expect(output).toContain("Zoo Code History Repair")
        expect(exitSpy).not.toHaveBeenCalled()
    })

    it("with corruptions, text mode: formatted output with recoverability", () => {
        mockScanStorage.mockReturnValue({
            corruptions: [
                {taskId: "corrupt-1", reasons: [{reason: "zero_size", source: "hi"}]},
            ],
        })

        action({})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("corrupt-1")
        expect(output).toContain("zero_size(hi)")
        expect(mockRecoverabilityScore).toHaveBeenCalled()
        expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it("JSON mode: outputs JSON and exits with corruption count", () => {
        mockScanStorage.mockReturnValue({
            corruptions: [
                {taskId: "c1", reasons: [{reason: "zero_size", source: "hi"}]},
                {taskId: "c2", reasons: [{reason: "index_orphan", source: "idx"}]},
            ],
        })

        action({json: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("")
        const parsed = JSON.parse(output)
        expect(parsed.corruptions).toHaveLength(2)
        expect(parsed.corruptions[0].taskId).toBe("c1")
        expect(parsed.corruptions[0].reasons).toEqual([{reason: "zero_size", source: "hi"}])
        expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it("JSON mode with no corruptions: exit 0", () => {
        mockScanStorage.mockReturnValue({
            corruptions: [],
        })

        action({json: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("")
        const parsed = JSON.parse(output)
        expect(parsed.corruptions).toEqual([])
        expect(exitSpy).not.toHaveBeenCalled()
    })

    it("passes verifyUiSync option to scanStorage", () => {
        mockScanStorage.mockReturnValue({corruptions: []})

        action({verifyUiSync: true})

        expect(mockScanStorage).toHaveBeenCalledWith("/fake/root", {verifyUiSync: true})
    })
})
