/**
 * @file src/lib/__tests__/validate/apiConversationHistory.spec.ts
 */

/// <reference types="vitest" />
import { describe, it, expect } from "vitest"
import { validateApiConversationHistory } from "../../validate/apiConversationHistory.js"

describe("validateApiConversationHistory", () => {
	it("null/undefined → error", () => {
		const r1 = validateApiConversationHistory(null)
		expect(r1.valid).toBe(false)
		expect(r1.issues.some((i) => i.code === "NOT_JSON")).toBe(true)

		const r2 = validateApiConversationHistory(undefined)
		expect(r2.valid).toBe(false)
		expect(r2.issues.some((i) => i.code === "NOT_JSON")).toBe(true)
	})

	it("non-array → error", () => {
		const r = validateApiConversationHistory({ some: "object" })
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "NOT_ARRAY")).toBe(true)
	})

	it("valid empty array → valid", () => {
		const r = validateApiConversationHistory([])
		expect(r.valid).toBe(true)
		expect(r.errorCount).toBe(0)
	})

	it("turn missing role → error", () => {
		const r = validateApiConversationHistory([{ content: [] }])
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.field === "[0].role")).toBe(true)
	})

	it("turn invalid role → error", () => {
		const r = validateApiConversationHistory([{ role: "system", content: [] }])
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.field === "[0].role")).toBe(true)
	})

	it("turn missing content array → error", () => {
		const r = validateApiConversationHistory([{ role: "user" }])
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.field === "[0].content")).toBe(true)
	})

	it("block missing type → error", () => {
		const r = validateApiConversationHistory([{ role: "user", content: [{}] }])
		expect(r.valid).toBe(false)
		expect(r.issues.length).toBeGreaterThan(0)
	})

	it("valid ACH with multiple turns → valid", () => {
		const r = validateApiConversationHistory([
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "Hi there" }] },
		])
		expect(r.valid).toBe(true)
		expect(r.errorCount).toBe(0)
	})
})
