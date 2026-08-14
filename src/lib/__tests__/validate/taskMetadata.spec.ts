/**
 * @file src/lib/__tests__/validate/taskMetadata.spec.ts
 */

/// <reference types="vitest" />
import { describe, it, expect } from "vitest"
import { validateTaskMetadata } from "../../validate/taskMetadata.js"

describe("validateTaskMetadata", () => {
	it("null/undefined → valid (no required fields)", () => {
		const r1 = validateTaskMetadata(null)
		expect(r1.valid).toBe(true)

		const r2 = validateTaskMetadata(undefined)
		expect(r2.valid).toBe(true)
	})

	it("array → error", () => {
		const r = validateTaskMetadata([1, 2, 3])
		expect(r.valid).toBe(false)
		expect(r.issues.length).toBeGreaterThan(0)
	})

	it("object → valid", () => {
		const r = validateTaskMetadata({ foo: "bar", num: 42 })
		expect(r.valid).toBe(true)
		expect(r.errorCount).toBe(0)
	})

	it("primitive → error", () => {
		const r = validateTaskMetadata("just a string")
		expect(r.valid).toBe(false)
		expect(r.issues.length).toBeGreaterThan(0)
	})
})
