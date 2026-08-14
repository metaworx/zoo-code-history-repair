/**
 * @file src/lib/__tests__/format.spec.ts
 */

import { describe, expect, it } from "vitest"
import { taskMatch, truncate } from "../format.js"

describe("truncate", () => {
	it("returns the string unchanged when shorter than maxLen", () => {
		expect(truncate("hello", 200)).toBe("hello")
	})

	it("returns the string unchanged when exactly maxLen", () => {
		const s = "a".repeat(200)
		expect(truncate(s, 200)).toBe(s)
	})

	it("truncates and appends ... when longer than maxLen", () => {
		const s = "a".repeat(250)
		const result = truncate(s, 200)
		expect(result).toBe("a".repeat(200) + "...")
		expect(result.length).toBe(203)
	})

	it("returns empty string for undefined", () => {
		expect(truncate(undefined, 200)).toBe("")
	})

	it("returns empty string for null", () => {
		expect(truncate(null, 200)).toBe("")
	})

	it("returns empty string for empty string", () => {
		expect(truncate("", 200)).toBe("")
	})
})

describe("taskMatch", () => {
	it('returns "YES" when both match exactly', () => {
		expect(taskMatch("hello", "hello")).toBe("YES")
	})

	it('returns "YES" when both match after trimming', () => {
		expect(taskMatch("  hello  ", "hello")).toBe("YES")
	})

	it('returns "NO" when strings differ', () => {
		expect(taskMatch("hello", "world")).toBe("NO")
	})

	it('returns "NO" when strings differ only in case', () => {
		expect(taskMatch("Hello", "hello")).toBe("NO")
	})

	it("returns null when indexTask is undefined", () => {
		expect(taskMatch(undefined, "hello")).toBeNull()
	})

	it("returns null when diskTask is undefined", () => {
		expect(taskMatch("hello", undefined)).toBeNull()
	})

	it("returns null when both are undefined", () => {
		expect(taskMatch(undefined, undefined)).toBeNull()
	})

	it("returns null when both are null", () => {
		expect(taskMatch(null, null)).toBeNull()
	})

	it("returns null when indexTask is empty string", () => {
		expect(taskMatch("", "hello")).toBeNull()
	})

	it("returns null when diskTask is empty string", () => {
		expect(taskMatch("hello", "")).toBeNull()
	})

	it("returns null when both are whitespace-only", () => {
		expect(taskMatch("   ", "  ")).toBeNull()
	})
})
