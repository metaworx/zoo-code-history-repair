import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { action } from "../../commands/validate.js"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
// path.resolve("/fake/root") on POSIX returns "/fake/root" unchanged
const mockResolveTasksDir = vi.hoisted(() => vi.fn((root: string) => path.join(root, "tasks")))
const mockValidatePath = vi.hoisted(() => vi.fn())

vi.mock("../../cliContext.js", () => ({
	setRoot: mockSetRoot,
	setVersion: mockSetVersion,
	getVersionBanner: mockGetVersionBanner,
	resolveRoot: mockResolveRoot,
}))

vi.mock("../../paths.js", () => ({
	resolveTasksDir: mockResolveTasksDir,
}))

vi.mock("../../validation.js", () => ({
	validatePath: mockValidatePath,
}))

describe("validate command", async () => {
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

	it("all files valid: prints summary with 0 errors", async () => {
		mockValidatePath.mockReturnValue([
			{ file: "f1.json", result: { valid: true, errorCount: 0, warningCount: 0, issues: [] } },
			{ file: "f2.json", result: { valid: true, errorCount: 0, warningCount: 0, issues: [] } },
		])

		await action(undefined, {})

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).toContain("2 files checked")
		expect(output).toContain("2 valid")
		expect(output).toContain("0 errors")
		expect(output).toContain("0 warnings")
		expect(exitSpy).not.toHaveBeenCalled()
	})

	it("with errors: prints errors and warnings by default and exits 1", async () => {
		mockValidatePath.mockReturnValue([
			{
				file: "bad.json",
				result: {
					valid: false,
					errorCount: 2,
					warningCount: 1,
					issues: [
						{ severity: "error", field: "id", message: "missing id field" },
						{ severity: "error", field: "ts", message: "invalid timestamp" },
						{ severity: "warning", field: "size", message: "size is zero" },
					],
				},
			},
		])

		await action(undefined, {})

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).toContain("bad.json:")
		expect(output).toContain("ERROR:")
		expect(output).toContain("missing id field")
		expect(output).toContain("invalid timestamp")
		// warnings shown by default
		expect(output).toContain("WARNING:")
		expect(output).toContain("size is zero")
		expect(output).toContain("1 files checked, 0 valid, 2 errors, 1 warnings")
		expect(exitSpy).toHaveBeenCalledWith(1)
	})

	it("warnings-only file: shows warnings by default", async () => {
		mockValidatePath.mockReturnValue([
			{
				file: "f.json",
				result: {
					valid: true,
					errorCount: 0,
					warningCount: 2,
					issues: [
						{ severity: "warning", field: "task", message: "task is placeholder" },
						{ severity: "warning", field: "size", message: "size mismatch" },
					],
				},
			},
		])

		await action(undefined, {})

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).toContain("WARNING:")
		expect(output).toContain("task is placeholder")
		expect(output).toContain("size mismatch")
		expect(exitSpy).not.toHaveBeenCalled()
	})

	it("--no-warnings: suppresses warning-level issues", async () => {
		mockValidatePath.mockReturnValue([
			{
				file: "f.json",
				result: {
					valid: true,
					errorCount: 0,
					warningCount: 2,
					issues: [
						{ severity: "warning", field: "task", message: "task is placeholder" },
						{ severity: "warning", field: "size", message: "size mismatch" },
					],
				},
			},
		])

		await action(undefined, { warnings: false })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).not.toContain("WARNING:")
		expect(output).not.toContain("task is placeholder")
		expect(output).not.toContain("size mismatch")
		expect(exitSpy).not.toHaveBeenCalled()
	})

	it("JSON mode: outputs structured JSON", async () => {
		mockValidatePath.mockReturnValue([
			{
				file: "f.json",
				result: {
					valid: false,
					errorCount: 1,
					warningCount: 0,
					issues: [{ severity: "error", field: "id", message: "bad" }],
				},
			},
		])

		await action(undefined, { json: true })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("")
		const parsed = JSON.parse(output)
		expect(parsed["f.json"].valid).toBe(false)
		expect(parsed["f.json"].errorCount).toBe(1)
		expect(parsed["f.json"].issues).toHaveLength(1)
	})

	it("error from validatePath: prints error and exits 1", async () => {
		mockValidatePath.mockImplementation(() => {
			throw new Error("path not found")
		})

		await action(undefined, {})

		expect(consoleErrorSpy).toHaveBeenCalled()
		expect(exitSpy).toHaveBeenCalledWith(1)
	})

	it("passes target to validatePath", async () => {
		mockValidatePath.mockReturnValue([])

		await action("/custom/path", {})

		expect(mockValidatePath).toHaveBeenCalledWith("/custom/path")
	})

	it("undefined target: calls validatePath with undefined", async () => {
		mockValidatePath.mockReturnValue([])

		await action(undefined, {})

		expect(mockValidatePath).toHaveBeenCalledWith(undefined)
	})

	it("UUID target: resolves to task directory path", async () => {
		mockValidatePath.mockReturnValue([])
		const taskId = "019fdc9c-a59f-75d9-bf05-4fd3d4fe4913"

		await action(taskId, {})

		const expectedPath = path.join(path.resolve("/fake/root"), "tasks", taskId)
		expect(mockValidatePath).toHaveBeenCalledWith(expectedPath)
	})

	it("non-UUID target: passed through as-is", async () => {
		mockValidatePath.mockReturnValue([])

		await action("some/file.json", {})

		expect(mockValidatePath).toHaveBeenCalledWith("some/file.json")
	})
})
