/**
 * @file src/lib/__tests__/validate/uiMessages.spec.ts
 */

/// <reference types="vitest" />
import { describe, it, expect } from "vitest"
import { validateUiMessages, validateUiResumeAsk, validateUiTimestamps } from "../../validate/uiMessages.js"

describe("validateUiMessages", () => {
	it("null/undefined → error", () => {
		const r1 = validateUiMessages(null)
		expect(r1.valid).toBe(false)
		expect(r1.issues.some((i) => i.code === "NOT_JSON")).toBe(true)

		const r2 = validateUiMessages(undefined)
		expect(r2.valid).toBe(false)
		expect(r2.issues.some((i) => i.code === "NOT_JSON")).toBe(true)
	})

	it("non-array → error", () => {
		const r = validateUiMessages({ x: 1 })
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "NOT_ARRAY")).toBe(true)
	})

	it("event missing ts → error", () => {
		const r = validateUiMessages([{ type: "say", say: "text", text: "hi" }])
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.field === "[0].ts")).toBe(true)
	})

	it("event invalid type → error", () => {
		const r = validateUiMessages([{ ts: 100, type: "other", say: "text", text: "hi" }])
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.field === "[0].type")).toBe(true)
	})

	it("event invalid say → error", () => {
		const r = validateUiMessages([{ ts: 100, type: "say", say: "unknown", text: "hi" }])
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.field === "[0].say")).toBe(true)
	})

	it("event missing text → valid (text is optional in Zoo schema)", () => {
		const r = validateUiMessages([{ ts: 100, type: "say", say: "text" }])
		expect(r.valid).toBe(true)
	})

	it("valid events → valid", () => {
		const r = validateUiMessages([
			{ ts: 100, type: "say", say: "text", text: "Hello", partial: false },
			{ ts: 200, type: "say", say: "reasoning", text: "Let me think...", partial: false },
			{ ts: 300, type: "say", say: "tool", text: "Tool output", partial: false },
		])
		expect(r.valid).toBe(true)
		expect(r.errorCount).toBe(0)
	})
})

describe("validateUiResumeAsk", () => {
	it("ok for empty or non-array input", () => {
		expect(validateUiResumeAsk([]).valid).toBe(true)
		expect(validateUiResumeAsk(null).valid).toBe(true)
	})

	it("ok when the last event is an ask", () => {
		const r = validateUiResumeAsk([{ ts: 1, type: "ask", ask: "resume_task" }])
		expect(r.valid).toBe(true)
		expect(r.errorCount).toBe(0)
	})

	it("error when the last event is a say", () => {
		const r = validateUiResumeAsk([{ ts: 1, type: "say", say: "text", text: "hi" }])
		expect(r.valid).toBe(false)
		expect(r.issues.some((i) => i.code === "MISSING_RESUME_ASK")).toBe(true)
	})
})

describe("validateUiTimestamps", () => {
	it("ok when empty", () => {
		expect(validateUiTimestamps([]).valid).toBe(true)
	})

	it("ok for plausible epoch timestamps", () => {
		const r = validateUiTimestamps([{ ts: 1786731830900, type: "ask", ask: "resume_task" }])
		expect(r.warningCount).toBe(0)
	})

	it("warns on an implausible timestamp", () => {
		const r = validateUiTimestamps([{ ts: 247, type: "say", say: "error", text: "x" }])
		expect(r.warningCount).toBe(1)
		expect(r.issues.some((i) => i.code === "INVALID_UI_TIMESTAMP")).toBe(true)
	})

	it("ignores events without a numeric ts", () => {
		const r = validateUiTimestamps([{ type: "say", say: "text", text: "no ts" }])
		expect(r.warningCount).toBe(0)
	})
})
