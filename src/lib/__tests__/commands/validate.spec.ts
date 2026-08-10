import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockValidatePath = vi.hoisted(() => vi.fn())

vi.mock("../../cliContext.js", () => ({
    setRoot: mockSetRoot,
    setVersion: mockSetVersion,
    getVersionBanner: mockGetVersionBanner,
    resolveRoot: mockResolveRoot,
}))

vi.mock("../../validation.js", () => ({
    validatePath: mockValidatePath,
}))

import {action} from "../../commands/validate.js"

describe("validate command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>
    let exitSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any)
        mockResolveRoot.mockReturnValue("/fake/root")
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("all files valid: prints summary with 0 errors", () => {
        mockValidatePath.mockReturnValue([
            {file: "f1.json", result: {valid: true, errorCount: 0, warningCount: 0, issues: []}},
            {file: "f2.json", result: {valid: true, errorCount: 0, warningCount: 0, issues: []}},
        ])

        action(undefined, {})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("2 files checked")
        expect(output).toContain("2 valid")
        expect(output).toContain("0 errors")
        expect(output).toContain("0 warnings")
        expect(exitSpy).not.toHaveBeenCalled()
    })

    it("with errors: prints errors and exits 1", () => {
        mockValidatePath.mockReturnValue([
            {file: "bad.json", result: {
                valid: false,
                errorCount: 2,
                warningCount: 1,
                issues: [
                    {severity: "error", field: "id", message: "missing id field"},
                    {severity: "error", field: "ts", message: "invalid timestamp"},
                    {severity: "warning", field: "size", message: "size is zero"},
                ],
            }},
        ])

        action(undefined, {})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("bad.json:")
        expect(output).toContain("ERROR:")
        expect(output).toContain("missing id field")
        expect(output).toContain("invalid timestamp")
        // warnings suppressed without --warnings flag
        expect(output).not.toContain("size is zero")
        expect(output).toContain("1 files checked, 0 valid, 2 errors, 1 warnings")
        expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it("--warnings flag: shows warnings alongside errors", () => {
        mockValidatePath.mockReturnValue([
            {file: "f.json", result: {
                valid: true,
                errorCount: 0,
                warningCount: 2,
                issues: [
                    {severity: "warning", field: "task", message: "task is placeholder"},
                    {severity: "warning", field: "size", message: "size mismatch"},
                ],
            }},
        ])

        action(undefined, {warnings: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("WARNING:")
        expect(output).toContain("task is placeholder")
        expect(output).toContain("size mismatch")
        expect(exitSpy).not.toHaveBeenCalled()
    })

    it("JSON mode: outputs structured JSON", () => {
        mockValidatePath.mockReturnValue([
            {file: "f.json", result: {valid: false, errorCount: 1, warningCount: 0, issues: [{severity: "error", field: "id", message: "bad"}]}},
        ])

        action(undefined, {json: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("")
        const parsed = JSON.parse(output)
        expect(parsed["f.json"].valid).toBe(false)
        expect(parsed["f.json"].errorCount).toBe(1)
        expect(parsed["f.json"].issues).toHaveLength(1)
    })

    it("error from validatePath: prints error and exits 1", () => {
        mockValidatePath.mockImplementation(() => {
            throw new Error("path not found")
        })

        action(undefined, {})

        expect(consoleErrorSpy).toHaveBeenCalled()
        expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it("passes target to validatePath", () => {
        mockValidatePath.mockReturnValue([])

        action("/custom/path", {})

        expect(mockValidatePath).toHaveBeenCalledWith("/custom/path")
    })

    it("undefined target: calls validatePath with undefined", () => {
        mockValidatePath.mockReturnValue([])

        action(undefined, {})

        expect(mockValidatePath).toHaveBeenCalledWith(undefined)
    })
})
