/**
 * @file src/lib/__tests__/commands/scan.spec.ts
 *
 * Unit tests for the scan command action (JSON and text output).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
const mockPerFieldRecoverability = vi.hoisted(() =>
	vi.fn(async () => ({
		tokensIn: { source: "none", confidence: "high", estimatedValue: null },
		tokensOut: { source: "none", confidence: "high", estimatedValue: null },
		totalCost: { source: "none", confidence: "high", estimatedValue: null },
		cacheReads: { source: "none", confidence: "high", estimatedValue: null },
		cacheWrites: { source: "none", confidence: "high", estimatedValue: null },
		number: { source: "none", confidence: "high", estimatedValue: null },
		mode: { source: "none", confidence: "high", estimatedValue: null },
		workspace: { source: "none", confidence: "high", estimatedValue: null },
		apiConfigName: { source: "none", confidence: "high", estimatedValue: null },
		task: { source: "none", confidence: "high", estimatedValue: null },
		refs: { source: "none", confidence: "high", estimatedValue: null },
	})),
)
const mockFormatPerFieldSummary = vi.hoisted(() => vi.fn(() => ""))

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
	perFieldRecoverability: mockPerFieldRecoverability,
	formatPerFieldSummary: mockFormatPerFieldSummary,
}))

vi.mock("../../paths.js", () => ({
	DEFAULT_INDEX_BASENAME: "_index",
	DEFAULT_INDEX_NAME: "_index.json",
	HISTORY_ITEM_NAME: "history_item.json",
	API_HISTORY_NAME: "api_conversation_history.json",
	UI_MESSAGES_NAME: "ui_messages.json",
}))

vi.mock("../../format.js", () => ({
	taskMatch: mockTaskMatch,
	truncate: mockTruncate,
}))

import { action } from "../../commands/scan.js"

describe("scan command", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>
	let exitSpy: ReturnType<typeof vi.spyOn>

	const baseResult = {
		storageRoot: "/fake/root",
		tasksDir: "/fake/root/tasks",
		indexPath: "/fake/root/tasks/_index.json",
		indexItems: [{ id: "a" }, { id: "b" }],
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

	it("JSON mode: outputs JSON with corruption details", async () => {
		mockScanStorage.mockReturnValue({
			...baseResult,
			corruptions: [
				{
					taskId: "c1",
					dir: "/fake/root/tasks/c1",
					reasons: [{ reason: "zero_size", source: "hi,idx" }],
					indexItem: null,
					diskItem: { task: "Real", size: 0 },
				},
			],
		})

		await action({ json: true })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("")
		const parsed = JSON.parse(output)
		expect(parsed.corruptions).toHaveLength(1)
		expect(parsed.corruptions[0].taskId).toBe("c1")
		expect(parsed.corruptions[0].reasons).toEqual([{ reason: "zero_size", source: "hi,idx" }])
	})

	it("JSON mode: includes per-field recoverability structure", async () => {
		mockScanStorage.mockReturnValue({
			...baseResult,
			corruptions: [
				{
					taskId: "c1",
					dir: "/fake/root/tasks/c1",
					reasons: [{ reason: "zero_size", source: "hi,idx" }],
					indexItem: null,
					diskItem: { task: "Real", size: 0 },
				},
			],
		})

		await action({ json: true })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("")
		const parsed = JSON.parse(output)
		expect(parsed.corruptions[0].fields.tokensIn.source).toBe("none")
		expect(parsed.corruptions[0].fields.tokensIn.confidence).toBe("high")
		expect(parsed.corruptions[0].fields.refs.source).toBe("none")
	})

	it("JSON mode, no corruptions: no exit", async () => {
		mockScanStorage.mockReturnValue({ ...baseResult, corruptions: [] })

		await action({ json: true })

		expect(exitSpy).not.toHaveBeenCalled()
	})

	it("text mode: prints summary block", async () => {
		mockScanStorage.mockReturnValue({ ...baseResult })

		await action({})

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).toContain("Storage:")
		expect(output).toContain("Tasks:")
		expect(output).toContain("Index:")
		expect(output).toContain("Index entries:")
		expect(output).toContain("Task dirs:")
		expect(output).toContain("Corruptions:")
	})

	it("text mode with corruptions, no quiet: prints per-task details", async () => {
		mockScanStorage.mockReturnValue({
			...baseResult,
			corruptions: [
				{
					taskId: "c1",
					dir: "/fake/root/tasks/c1",
					reasons: [{ reason: "zero_size", source: "hi" }],
					indexItem: null,
					diskItem: null,
				},
			],
		})

		await action({})

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).toContain("c1")
		expect(output).toContain("reasons:")
		expect(output).toContain("recoverability:")
		expect(output).toContain("fields:")
	})

	it("quiet mode: suppresses per-task details but shows summary", async () => {
		mockScanStorage.mockReturnValue({
			...baseResult,
			corruptions: [
				{
					taskId: "c1",
					dir: "/fake/root/tasks/c1",
					reasons: [{ reason: "zero_size", source: "hi" }],
					indexItem: null,
					diskItem: null,
				},
			],
		})

		await action({ quiet: true })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).toContain("Corruptions:")
		expect(output).not.toContain("reasons:")
	})

	it("text mode with corruptions: exits with corruption count", async () => {
		mockScanStorage.mockReturnValue({
			...baseResult,
			corruptions: [
				{ taskId: "c1", reasons: [], indexItem: null, diskItem: null },
				{ taskId: "c2", reasons: [], indexItem: null, diskItem: null },
			],
		})

		await action({ quiet: true })
		expect(exitSpy).toHaveBeenCalledWith(2)
	})

	it("passes verifyUiSync to scanStorage", async () => {
		mockScanStorage.mockReturnValue({ ...baseResult })

		await action({ verifyUiSync: true })

		expect(mockScanStorage).toHaveBeenCalledWith("/fake/root", { verifyUiSync: true, showWarnings: true })
	})
})

describe("scan --short command", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>
	let exitSpy: ReturnType<typeof vi.spyOn>

	const shortResult = {
		filesChecked: 12,
		totalErrorCount: 5,
		totalWarningCount: 2,
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

	it("no corruptions: banner only, no exit", async () => {
		mockScanStorage.mockReturnValue({ ...shortResult, corruptions: [] })

		await action({ short: true })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("")
		expect(output).toContain("Zoo Code History Repair")
		expect(exitSpy).not.toHaveBeenCalled()
	})

	it("text mode: formatted output with recoverability", async () => {
		mockScanStorage.mockReturnValue({
			...shortResult,
			corruptions: [{ taskId: "corrupt-1", reasons: [{ reason: "zero_size", source: "hi" }] }],
		})

		await action({ short: true })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).toContain("corrupt-1")
		expect(output).toContain("zero_size(hi)")
		expect(mockRecoverabilityScore).toHaveBeenCalled()
		expect(exitSpy).toHaveBeenCalledWith(1)
	})

	it("JSON mode: outputs JSON and exits with corruption count", async () => {
		mockScanStorage.mockReturnValue({
			...shortResult,
			corruptions: [
				{ taskId: "c1", reasons: [{ reason: "zero_size", source: "hi" }] },
				{ taskId: "c2", reasons: [{ reason: "index_orphan", source: "idx" }] },
			],
		})

		await action({ short: true, json: true })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("")
		const parsed = JSON.parse(output)
		expect(parsed.corruptions).toHaveLength(2)
		expect(parsed.corruptions[0].taskId).toBe("c1")
		expect(parsed.corruptions[0].reasons).toEqual([{ reason: "zero_size", source: "hi" }])
		expect(exitSpy).toHaveBeenCalledWith(2)
	})

	it("passes verifyUiSync option to scanStorage", async () => {
		mockScanStorage.mockReturnValue({ ...shortResult, corruptions: [] })

		await action({ short: true, verifyUiSync: true })

		expect(mockScanStorage).toHaveBeenCalledWith("/fake/root", { verifyUiSync: true, showWarnings: true })
	})

	it("--no-summary suppresses summary line", async () => {
		mockScanStorage.mockReturnValue({
			...shortResult,
			corruptions: [{ taskId: "c1", reasons: [{ reason: "zero_size", source: "hi" }] }],
		})

		await action({ short: true, summary: false })

		const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
		expect(output).not.toContain("files checked")
		expect(output).toContain("zero_size(hi)")
	})
})
