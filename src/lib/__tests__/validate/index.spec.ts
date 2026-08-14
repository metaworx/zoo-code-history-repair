/**
 * @file src/lib/__tests__/validate/index.spec.ts
 */

/// <reference types="vitest" />
import { describe, it, expect } from "vitest"
import { validateIndex } from "../../validate/index.js"

describe("validateIndex", () => {
	it("null/undefined → error", () => {
		const r1 = validateIndex(null)
		expect(r1.valid).toBe(false)
		expect(r1.issues.some((i) => i.code === "NOT_JSON")).toBe(true)

		const r2 = validateIndex(undefined)
		expect(r2.valid).toBe(false)
		expect(r2.issues.some((i) => i.code === "NOT_JSON")).toBe(true)
	})

	it("non-object → error", () => {
		const r = validateIndex([1, 2, 3])
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "NOT_OBJECT")).toBe(true)
	})

	it("missing version → error", () => {
		const r = validateIndex({ updatedAt: 1, entries: [] })
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "MISSING_VERSION")).toBe(true)
	})

	it("unsupported version → warning", () => {
		const r = validateIndex({ version: 99, updatedAt: 1, entries: [] })
		expect(r.issues.some((i) => i.code === "UNSUPPORTED_VERSION" && i.severity === "warning")).toBe(true)
	})

	it("missing updatedAt → error", () => {
		const r = validateIndex({ version: 1, entries: [] })
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "MISSING_UPDATED_AT")).toBe(true)
	})

	it("missing entries → error", () => {
		const r = validateIndex({ version: 1, updatedAt: 1 })
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "MISSING_ENTRIES")).toBe(true)
	})

	it("entries non-array → error", () => {
		const r = validateIndex({ version: 1, updatedAt: 1, entries: "not-array" })
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "INVALID_ENTRIES")).toBe(true)
	})

	it("valid entries with cross-refs → valid", () => {
		const r = validateIndex({
			version: 1,
			updatedAt: 1700000000000,
			entries: [
				{
					id: "019f0f12-02f9-70df-a35e-2b110efe4107",
					ts: 1700000000000,
					number: 1,
					task: "Parent task",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.01,
					size: 1024,
					workspace: "/workspace",
					mode: "code",
					apiConfigName: "default",
					status: "delegated",
					delegatedToId: "019f726a-0f50-711c-929e-9546e5100546",
					awaitingChildId: "019f726a-0f50-711c-929e-9546e5100546",
					childIds: ["019f726a-0f50-711c-929e-9546e5100546"],
					completedByChildId: "019f726a-0f50-711c-929e-9546e5100546",
					completionResultSummary: "Done",
				},
				{
					id: "019f726a-0f50-711c-929e-9546e5100546",
					ts: 1700000001000,
					number: 2,
					task: "Child task",
					tokensIn: 50,
					tokensOut: 100,
					totalCost: 0.005,
					size: 512,
					workspace: "/workspace",
					mode: "code",
					apiConfigName: "default",
					status: "completed",
					parentTaskId: "019f0f12-02f9-70df-a35e-2b110efe4107",
				},
			],
		})
		expect(r.valid).toBe(true)
		expect(r.errorCount).toBe(0)
	})

	it("dangling cross-reference → error", () => {
		const r = validateIndex({
			version: 1,
			updatedAt: 1700000000000,
			entries: [
				{
					id: "019f0f12-02f9-70df-a35e-2b110efe4107",
					ts: 1700000000000,
					number: 1,
					task: "Some task",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.01,
					size: 1024,
					workspace: "/workspace",
					mode: "code",
					apiConfigName: "default",
					parentTaskId: "019fb786-503a-76ca-8708-fee1243c878d", // doesn't exist
				},
			],
		})
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "DANGLING_REF")).toBe(true)
	})
})
