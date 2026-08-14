/**
 * @file src/lib/__tests__/size.spec.ts
 */

import { compactSizeBytes, computeTaskSize } from "../size.js"
import type { HistoryItem } from "../../types.js"

describe("compactSizeBytes", () => {
	it("returns correct byte length for a number", () => {
		const len = compactSizeBytes(42)
		expect(len).toBe(2) // "42"
	})

	it("returns correct byte length for a string", () => {
		const len = compactSizeBytes("hello")
		expect(len).toBe(7) // '"hello"'
	})

	it("returns correct byte length for an object", () => {
		const len = compactSizeBytes({ a: 1, b: "x" })
		expect(len).toBe(Buffer.byteLength('{"a":1,"b":"x"}', "utf8"))
	})

	it("returns correct byte length for an array", () => {
		const len = compactSizeBytes([1, 2, 3])
		expect(len).toBe(Buffer.byteLength("[1,2,3]", "utf8"))
	})

	it("returns 4 for null", () => {
		expect(compactSizeBytes(null)).toBe(4) // "null"
	})
})

describe("computeTaskSize", () => {
	const item: HistoryItem = {
		id: "test-1",
		task: "Test task",
		ts: 1234567890,
		tokensIn: 100,
		tokensOut: 200,
		totalCost: 0.05,
	}

	it("equals sum of compact sizes of all four inputs", () => {
		const ui = [{ type: "say", say: "text", text: "hello" }]
		const api = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
		const tm = { created: 123 }

		const total = computeTaskSize(ui, api, item, tm)
		const expected = compactSizeBytes(ui) + compactSizeBytes(api) + compactSizeBytes(item) + compactSizeBytes(tm)

		expect(total).toBe(expected)
	})

	it("handles empty inputs", () => {
		const total = computeTaskSize([], [], item, {})
		const expected = compactSizeBytes([]) + compactSizeBytes([]) + compactSizeBytes(item) + compactSizeBytes({})

		expect(total).toBe(expected)
	})

	it("returns non-zero for typical task data", () => {
		const total = computeTaskSize(
			[{ type: "say", say: "text", text: "A" }],
			[{ role: "user", content: [] }],
			item,
			null,
		)
		expect(total).toBeGreaterThan(0)
	})

	it("is deterministic (same inputs → same size)", () => {
		const ui = [{ x: 1 }]
		const api = [{ y: 2 }]
		const a = computeTaskSize(ui, api, item, {})
		const b = computeTaskSize(ui, api, item, {})
		expect(a).toBe(b)
	})
})
