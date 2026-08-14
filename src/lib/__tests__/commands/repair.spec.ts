/**
 * @file src/lib/__tests__/commands/repair.spec.ts
 *
 * Tests for the unified repair command (--index / --all / <taskId> modes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => `${r}/tasks`))

const mockRepair = vi.hoisted(() => vi.fn())
const mockGetEntries = vi.hoisted(() => vi.fn(() => []))
const mockGetFullIndex = vi.hoisted(() => vi.fn(() => new Map()))
const mockGetKnownTaskIds = vi.hoisted(() => vi.fn(() => new Set()))
const mockReplaceId = vi.hoisted(() => vi.fn(() => null))
const mockIndexTransaction = vi.hoisted(() =>
	vi.fn(function (this: any, _readOnly?: boolean) {
		this.repair = mockRepair
		this.getEntries = mockGetEntries
		this.getFullIndex = mockGetFullIndex
		this.getKnownTaskIds = mockGetKnownTaskIds
		this.replaceId = mockReplaceId
		return this
	}),
)

const mockTransactionRead = vi.hoisted(() => vi.fn(() => []))
const mockTransactionGetData = vi.hoisted(() => vi.fn(() => mockTransactionRead()))
const mockTransactionLoad = vi.hoisted(() =>
	vi.fn(function (this: any) {
		return this
	}),
)
const mockJsonFileTransaction = vi.hoisted(() =>
	vi.fn(function (this: any, _path: string) {
		this.load = mockTransactionLoad
		this.getData = mockTransactionGetData
		return this
	}),
)

const mockRepairTaskDir = vi.hoisted(() => vi.fn())
const mockFormatRepairParts = vi.hoisted(() =>
	vi.fn((r: any) => {
		const parts: string[] = []
		if (r.uiRepaired) parts.push("ui(ach→uim)")
		if (r.taskRepaired) parts.push("task(ach→hi)")
		return parts
	}),
)
const mockRepairAllCorrupted = vi.hoisted(() => vi.fn())
const mockAlignSummary = vi.hoisted(() => vi.fn((label: string, value: string) => `${label.padEnd(19)}${value}`))

vi.mock("../../cliContext.js", () => ({
	getVersionBanner: mockGetVersionBanner,
	resolveRoot: mockResolveRoot,
	ABBREV_HELP: "",
}))

vi.mock("../../paths.js", () => ({
	resolveTasksDir: mockResolveTasksDir,
	DEFAULT_INDEX_NAME: "_index.json",
	HISTORY_ITEM_NAME: "history_item.json",
	UI_MESSAGES_NAME: "ui_messages.json",
}))

vi.mock("../../IndexTransaction.js", () => ({
	IndexTransaction: mockIndexTransaction,
}))

vi.mock("../../file.js", () => ({
	backupTimestamp: "20260814-000000",
	JsonFileTransaction: mockJsonFileTransaction,
}))

vi.mock("../../repairTask.js", () => ({
	repairTaskDir: mockRepairTaskDir,
	formatRepairParts: mockFormatRepairParts,
}))

vi.mock("../../repairAll.js", () => ({
	repairAllCorrupted: mockRepairAllCorrupted,
}))

vi.mock("../../scanOutput.js", () => ({
	alignSummary: mockAlignSummary,
}))

vi.mock("../../format.js", () => ({
	c: { red: "red" },
	colorize: vi.fn((s: string) => s),
}))

import { action } from "../../commands/repair.js"

describe("repair command", () => {
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

	describe("dispatch validation", () => {
		it("errors + exits when no mode is given", async () => {
			await action(undefined, {})

			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("exactly one of"))
			expect(exitSpy).toHaveBeenCalledWith(1)
		})

		it("errors + exits when --index and --all are combined", async () => {
			await action(undefined, { index: true, all: true })

			expect(exitSpy).toHaveBeenCalledWith(1)
		})

		it("errors + exits when --index and taskId are combined", async () => {
			await action("t1", { index: true })

			expect(exitSpy).toHaveBeenCalledWith(1)
		})
	})

	describe("--index mode", () => {
		it("dry-run: prints item count and dry-run message", async () => {
			mockRepair.mockReturnValue({ items: [{ id: "a" }, { id: "b" }], written: false })

			await action(undefined, { index: true, force: false })

			const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
			expect(output).toContain("Rebuilt index with 2 items")
			expect(output).toContain("Dry-run")
			expect(output).not.toContain("Written:")
		})

		it("force: prints written + backup path", async () => {
			mockRepair.mockReturnValue({
				items: [{ id: "x" }],
				written: true,
				backupPath: "/fake/root/tasks/_index.json.20260814-000000.bak.json",
			})

			await action(undefined, { index: true, force: true, backup: true })

			const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
			expect(output).toContain("Rebuilt index with 1 items")
			expect(output).not.toContain("Dry-run")
			expect(output).toContain("Backup:  /fake/root/tasks/_index.json.20260814-000000.bak.json")
		})

		it("passes dryRun/backup/verifyUiSync to repair", async () => {
			mockRepair.mockReturnValue({ items: [], written: false, uiSyncMismatches: [] })

			await action(undefined, { index: true, force: false, backup: false, verifyUiSync: true })

			expect(mockRepair).toHaveBeenCalledWith(undefined, {
				dryRun: true,
				backup: false,
				verifyUiSync: true,
			})
		})

		it("prints UI-sync mismatch report when present", async () => {
			mockRepair.mockReturnValue({
				items: [],
				written: false,
				uiSyncMismatches: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
			})

			await action(undefined, { index: true, verifyUiSync: true })

			const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
			expect(output).toContain("UI-sync mismatch")
			expect(output).toContain("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
		})
	})

	describe("taskId mode", () => {
		it("dry-run: shows [DRY-RUN] would repair", async () => {
			mockRepairTaskDir.mockReturnValue({
				taskId: "t1",
				uiRepaired: true,
				taskRepaired: false,
				sizeRepaired: false,
				tokensRepaired: false,
				errors: [],
				backups: [],
			})

			await action("t1", { force: false })

			const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
			expect(output).toContain("[DRY-RUN]")
			expect(output).toContain("would repair")
			expect(output).toContain("ui(ach→uim)")
		})

		it("force: shows repaired without [DRY-RUN]", async () => {
			mockRepairTaskDir.mockReturnValue({
				taskId: "t1",
				uiRepaired: true,
				taskRepaired: true,
				sizeRepaired: false,
				tokensRepaired: false,
				errors: [],
				backups: [],
			})

			await action("t1", { force: true })

			const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
			expect(output).not.toContain("[DRY-RUN]")
			expect(output).toContain("repaired")
		})

		it("errors path: shows errors and backups", async () => {
			mockRepairTaskDir.mockReturnValue({
				taskId: "t1",
				uiRepaired: false,
				taskRepaired: false,
				sizeRepaired: false,
				tokensRepaired: false,
				errors: ["missing ACH"],
				backups: ["/fake/root/tasks/t1/history_item.json.bak"],
			})

			await action("t1", { force: false })

			const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
			expect(output).toContain("errors:")
			expect(output).toContain("missing ACH")
			expect(output).toContain("Backups:")
		})

		it("passes options to repairTaskDir including indexItems", async () => {
			mockGetEntries.mockReturnValue([{ id: "t1", tokensIn: 500, tokensOut: 300 }])
			mockGetFullIndex.mockReturnValue(new Map([["t1", { id: "t1", tokensIn: 500, tokensOut: 300 }]]))
			mockGetKnownTaskIds.mockReturnValue(new Set())
			mockRepairTaskDir.mockReturnValue({
				taskId: "t1",
				uiRepaired: false,
				taskRepaired: false,
				sizeRepaired: false,
				tokensRepaired: false,
				errors: [],
				backups: [],
			})

			await action("t1", { force: true, backup: false, forceUim: true, fixedInputToken: 2000 })

			expect(mockRepairTaskDir).toHaveBeenCalledWith("/fake/root/tasks/t1", {
				dryRun: false,
				backup: false,
				forceUim: true,
				fixedInputToken: 2000,
				forceRebuildHi: undefined,
				indexItems: [{ id: "t1", tokensIn: 500, tokensOut: 300 }],
				fullIndex: new Map([["t1", { id: "t1", tokensIn: 500, tokensOut: 300 }]]),
				taskIds: new Set(),
			})
		})
	})

	describe("--all mode", () => {
		it("dry-run: shows [DRY-RUN] prefix and dry-run message", async () => {
			mockRepairAllCorrupted.mockReturnValue({
				total: 1,
				repaired: 1,
				failed: 0,
				unrepairable: 0,
				results: [{ taskId: "t1", uiRepaired: true, errors: [], unrepairable: false }],
				indexEntries: 0,
				indexAdded: [],
				indexRemoved: [],
			})

			await action(undefined, { all: true, force: false })

			const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
			expect(output).toContain("[DRY-RUN]")
			expect(output).toContain("would repair")
			expect(output).toContain("Dry-run")
		})

		it("force: shows repaired with no [DRY-RUN]", async () => {
			mockRepairAllCorrupted.mockReturnValue({
				total: 1,
				repaired: 1,
				failed: 0,
				unrepairable: 0,
				results: [{ taskId: "t1", uiRepaired: true, errors: [], unrepairable: false }],
				indexEntries: 0,
				indexAdded: [],
				indexRemoved: [],
			})

			await action(undefined, { all: true, force: true })

			const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n")
			expect(output).toContain("repaired")
			expect(output).not.toContain("[DRY-RUN]")
			expect(output).not.toContain("Dry-run")
		})

		it("passes options to repairAllCorrupted", async () => {
			mockRepairAllCorrupted.mockReturnValue({
				total: 0,
				repaired: 0,
				failed: 0,
				unrepairable: 0,
				results: [],
				indexEntries: 0,
				indexAdded: [],
				indexRemoved: [],
			})

			await action(undefined, {
				all: true,
				force: true,
				backup: false,
				fixedInputToken: 1000,
				verifyUiSync: true,
				forceRebuildHi: true,
			})

			expect(mockRepairAllCorrupted).toHaveBeenCalledWith("/fake/root", {
				dryRun: false,
				backup: false,
				fixedInputToken: 1000,
				verifyUiSync: true,
				forceRebuildHi: true,
			})
		})
	})
})
