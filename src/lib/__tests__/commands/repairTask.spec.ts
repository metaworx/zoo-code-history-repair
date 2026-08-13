import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"

const mockSetRoot = vi.hoisted(() => vi.fn())
const mockSetVersion = vi.hoisted(() => vi.fn())
const mockGetVersionBanner = vi.hoisted(() => vi.fn(() => "Zoo Code History Repair, v0.0.0-test\n"))
const mockResolveRoot = vi.hoisted(() => vi.fn(() => "/fake/root"))
const mockResolveTasksDir = vi.hoisted(() => vi.fn((r: string) => `${r}/tasks`))
const mockResolveIndexPath = vi.hoisted(() => vi.fn((td: string) => `${td}/_index.json`))
const mockRepairTaskDir = vi.hoisted(() => vi.fn())
const mockFormatRepairParts = vi.hoisted(() => vi.fn((r: any) => {
    const parts: string[] = []
    if (r.uiRepaired) parts.push("ui(ach→uim)")
    if (r.taskRepaired) parts.push("task(ach→hi)")
    return parts
}))

const mockTransactionRead = vi.hoisted(() => vi.fn())
const mockTransactionGetData = vi.hoisted(() => vi.fn(() => mockTransactionRead()))
const mockTransactionLoad = vi.hoisted(() => vi.fn(function (this: any) {
    return this
}))
const mockJsonFileTransaction = vi.hoisted(() => vi.fn(function (this: any, _path: string) {
    this.read = mockTransactionRead
    this.load = mockTransactionLoad
    this.getData = mockTransactionGetData
    return this
}))

vi.mock("../../cliContext.js", () => ({
    setRoot: mockSetRoot,
    setVersion: mockSetVersion,
    getVersionBanner: mockGetVersionBanner,
    resolveRoot: mockResolveRoot,
    ABBREV_HELP: "",
}))

vi.mock("../../paths.js", () => ({
    resolveTasksDir: mockResolveTasksDir,
    resolveIndexPath: mockResolveIndexPath,
    HISTORY_ITEM_NAME: "history_item.json",
    UI_MESSAGES_NAME: "ui_messages.json",
}))

vi.mock("../../repairTask.js", () => ({
    repairTaskDir: mockRepairTaskDir,
    formatRepairParts: mockFormatRepairParts,
}))

vi.mock("../../file.js", () => ({
    JsonFileTransaction: mockJsonFileTransaction,
}))

const mockIdxGetEntries = vi.hoisted(() => vi.fn(() => []))
const mockIdxGetFullIndex = vi.hoisted(() => vi.fn(() => new Map()))
const mockIdxGetKnownTaskIds = vi.hoisted(() => vi.fn(() => new Set()))
vi.mock("../../IndexTransaction.js", () => ({
    IndexTransaction: vi.fn(function (this: any, _readOnly?: boolean) {
        this.getEntries = mockIdxGetEntries
        this.getFullIndex = mockIdxGetFullIndex
        this.getKnownTaskIds = mockIdxGetKnownTaskIds
        this.replaceId = vi.fn()
        return this
    }),
}))

vi.mock("../../format.js", () => ({
    c: {red: "red"},
    colorize: vi.fn((s: string) => s),
}))

import {action} from "../../commands/repairTask.js"

describe("repairTask command", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
        })
        mockResolveRoot.mockReturnValue("/fake/root")
        mockResolveTasksDir.mockReturnValue("/fake/root/tasks")
        mockResolveIndexPath.mockReturnValue("/fake/root/tasks/_index.json")
        mockTransactionRead.mockReturnValue([])
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it("dry-run, successful repair: shows [DRY-RUN] would repair", async () => {
        mockRepairTaskDir.mockReturnValue({
            taskId: "t1",
            uiRepaired: true,
            taskRepaired: false,
            sizeRepaired: false,
            tokensRepaired: false,
            errors: [],
            backups: [],
        })

        await action("t1", {force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("[DRY-RUN]")
        expect(output).toContain("would repair")
        expect(output).toContain("ui(ach→uim)")
    })

    it("force, successful repair: shows repaired without [DRY-RUN]", async () => {
        mockRepairTaskDir.mockReturnValue({
            taskId: "t1",
            uiRepaired: true,
            taskRepaired: true,
            sizeRepaired: false,
            tokensRepaired: false,
            errors: [],
            backups: [],
        })

        await action("t1", {force: true})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
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
            errors: ["missing ACH", "corrupt JSON"],
            backups: ["/fake/root/tasks/t1/history_item.json.bak"],
        })

        await action("t1", {force: false})

        const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n")
        expect(output).toContain("errors:")
        expect(output).toContain("missing ACH")
        expect(output).toContain("corrupt JSON")
        expect(output).toContain("Backups:")
    })

    it("passes options to repairTaskDir including indexItems", async () => {
        mockIdxGetEntries.mockReturnValue([
            {id: "t1", tokensIn: 500, tokensOut: 300},
        ])
        mockIdxGetFullIndex.mockReturnValue(new Map([["t1", {id: "t1", tokensIn: 500, tokensOut: 300}]]))
        mockIdxGetKnownTaskIds.mockReturnValue(new Set())
        mockRepairTaskDir.mockReturnValue({
            taskId: "t1", uiRepaired: false, taskRepaired: false,
            sizeRepaired: false, tokensRepaired: false,
            errors: [], backups: [],
        })

        await action("t1", {force: true, backup: false, forceUim: true, fixedInputToken: 2000})

        expect(mockRepairTaskDir).toHaveBeenCalledWith("/fake/root/tasks/t1", {
            dryRun: false,
            backup: false,
            forceUim: true,
            fixedInputToken: 2000,
            indexItems: [{id: "t1", tokensIn: 500, tokensOut: 300}],
            fullIndex: new Map([["t1", {id: "t1", tokensIn: 500, tokensOut: 300}]]),
            taskIds: new Set(),
        })
    })

    it("passes indexItems from {entries} format", async () => {
        mockIdxGetEntries.mockReturnValue([{id: "t1", tokensIn: 100}])
        mockRepairTaskDir.mockReturnValue({
            taskId: "t1", uiRepaired: false, taskRepaired: false,
            sizeRepaired: false, tokensRepaired: false,
            errors: [], backups: [],
        })

        await action("t1", {force: false})

        expect(mockRepairTaskDir).toHaveBeenCalledWith("/fake/root/tasks/t1", expect.objectContaining({
            indexItems: [{id: "t1", tokensIn: 100}],
        }))
    })
})
