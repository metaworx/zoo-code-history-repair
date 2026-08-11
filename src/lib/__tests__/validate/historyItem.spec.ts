/// <reference types="vitest" />
import {describe, it, expect} from "vitest"
import {validateHistoryItem} from "../../validate/historyItem.js"

describe("validateHistoryItem", () => {
    const makeValidEntry = (overrides: Record<string, unknown> = {}) => ({
        id: "019f0f12-02f9-70df-a35e-2b110efe4107",
        ts: 1700000000000,
        number: 1,
        task: "Implement feature",
        tokensIn: 100,
        tokensOut: 200,
        totalCost: 0.01,
        size: 1024,
        workspace: "/workspace",
        mode: "code",
        apiConfigName: "default",
        ...overrides,
    })

    it("null/undefined → error", () => {
        const r1 = validateHistoryItem(null)
        expect(r1.valid).toBe(false)
        expect(r1.issues.some(i => i.code === "NOT_OBJECT")).toBe(true)

        const r2 = validateHistoryItem(undefined)
        expect(r2.valid).toBe(false)
        expect(r2.issues.some(i => i.code === "NOT_OBJECT")).toBe(true)
    })

    it("non-object → error", () => {
        const r = validateHistoryItem([1, 2, 3])
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "NOT_OBJECT")).toBe(true)
    })

    it("missing id → error", () => {
        const r = validateHistoryItem(makeValidEntry({id: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "id")).toBe(true)
    })

    it("invalid UUID → error", () => {
        const r = validateHistoryItem(makeValidEntry({id: "not-a-uuid"}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "INVALID_UUID")).toBe(true)
    })

    it("missing ts → error", () => {
        const r = validateHistoryItem(makeValidEntry({ts: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "ts")).toBe(true)
    })

    it("missing number → error", () => {
        const r = validateHistoryItem(makeValidEntry({number: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "number")).toBe(true)
    })

    it("number ≤ 0 → error", () => {
        const r = validateHistoryItem(makeValidEntry({number: 0}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "INVALID_NUMBER")).toBe(true)
    })

    it("missing task → error", () => {
        const r = validateHistoryItem(makeValidEntry({task: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "task")).toBe(true)
    })

    it("placeholder task → error", () => {
        const r = validateHistoryItem(makeValidEntry({task: "Task #42"}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "PLACEHOLDER_TASK")).toBe(true)
    })

    it("tokensIn 0 → warning (not error)", () => {
        const r = validateHistoryItem(makeValidEntry({tokensIn: 0}))
        expect(r.issues.some(i => i.code === "ZERO_TOKENS_IN" && i.severity === "warning")).toBe(true)
        expect(r.issues.filter(i => i.severity === "error").some(i => i.code === "ZERO_TOKENS_IN")).toBe(false)
    })

    it("tokensOut 0 → warning", () => {
        const r = validateHistoryItem(makeValidEntry({tokensOut: 0}))
        expect(r.issues.some(i => i.code === "ZERO_TOKENS_OUT" && i.severity === "warning")).toBe(true)
    })

    it("totalCost 0 → warning", () => {
        const r = validateHistoryItem(makeValidEntry({totalCost: 0}))
        expect(r.issues.some(i => i.code === "ZERO_TOTAL_COST" && i.severity === "warning")).toBe(true)
    })

    it("missing size → error", () => {
        const r = validateHistoryItem(makeValidEntry({size: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "size")).toBe(true)
    })

    it("missing workspace → error", () => {
        const r = validateHistoryItem(makeValidEntry({workspace: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "workspace")).toBe(true)
    })

    it("missing mode → error", () => {
        const r = validateHistoryItem(makeValidEntry({mode: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "mode")).toBe(true)
    })

    it("missing apiConfigName → error", () => {
        const r = validateHistoryItem(makeValidEntry({apiConfigName: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "apiConfigName")).toBe(true)
    })

    it("invalid status → error", () => {
        const r = validateHistoryItem(makeValidEntry({status: "unknown_status"}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.field === "status")).toBe(true)
    })

    it("missing status → valid (normal)", () => {
        const r = validateHistoryItem(makeValidEntry({status: undefined}))
        expect(r.valid).toBe(true)
    })

    it("status=delegated without delegatedToId → error", () => {
        const r = validateHistoryItem(makeValidEntry({
            status: "delegated",
            awaitingChildId: "019f726a-0f50-711c-929e-9546e5100546",
            childIds: ["019f726a-0f50-711c-929e-9546e5100546"],
            completedByChildId: "019f726a-0f50-711c-929e-9546e5100546",
            completionResultSummary: "Done",
            delegatedToId: undefined,
        }))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "STATUS_DELEGATED_MISSING" && i.field.includes("delegatedToId"))).toBe(true)
    })

    it("status=completed without parentTaskId → error", () => {
        const r = validateHistoryItem(makeValidEntry({status: "completed", parentTaskId: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "STATUS_COMPLETED_MISSING")).toBe(true)
    })

    it("status=interrupted without parentTaskId → error", () => {
        const r = validateHistoryItem(makeValidEntry({status: "interrupted", parentTaskId: undefined}))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "STATUS_INTERRUPTED_MISSING")).toBe(true)
    })

    it("status=active with awaitingChildId → error", () => {
        const r = validateHistoryItem(makeValidEntry({
            status: "active",
            awaitingChildId: "019f726a-0f50-711c-929e-9546e5100546",
        }))
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "STATUS_ACTIVE_FORBIDDEN")).toBe(true)
    })

    it("cross-ref with fullIndex → dangling ref → error", () => {
        const fullIndex = new Map([
            ["019f0f12-02f9-70df-a35e-2b110efe4107", makeValidEntry()],
        ])
        const r = validateHistoryItem(makeValidEntry({
            parentTaskId: "019fb786-503a-76ca-8708-fee1243c878d", // not in index
        }), fullIndex)
        expect(r.valid).toBe(false)
        expect(r.issues.some(i => i.code === "DANGLING_REF")).toBe(true)
    })

    it("valid complete entry → valid", () => {
        const r = validateHistoryItem(makeValidEntry())
        expect(r.valid).toBe(true)
        expect(r.errorCount).toBe(0)
    })
})
