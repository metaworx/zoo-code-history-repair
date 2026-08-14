import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { reconcileStatus, recoverFields, resolveReferences } from "../resolveReferences.js"
import type { ReferenceContext } from "../resolveReferences.js"

const GRAND = "aaaaaaaa-1111-4111-8111-111111111111"
const PARENT = "bbbbbbbb-2222-4222-8222-222222222222"
const CHILD = "cccccccc-3333-4333-8333-333333333333"

function ctxFor(entries: Array<Record<string, unknown>>, ach: unknown[] | null = null): ReferenceContext {
	const fullIndex = new Map(entries.map((e) => [e.id as string, e]))
	return { fullIndex, taskIds: new Set(fullIndex.keys()), ach }
}

function childEntry(): Record<string, unknown> {
	return { id: CHILD, parentTaskId: PARENT }
}

/** ACH containing a single known task UUID (the child) in free text. */
function achWith(childId: string): unknown[] {
	return [
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "t1",
					content: [{ type: "text", text: `subtask ${childId} completed` }],
				},
			],
		},
	]
}

describe("resolveReferences", () => {
	it("recovers completedByChildId from own ACH", async () => {
		const entry: Record<string, unknown> = { id: PARENT, completedByChildId: "scrambled-text" }
		const res = await resolveReferences(entry, ctxFor([entry, childEntry()], achWith(CHILD)))

		expect(res.changed).toBe(true)
		expect(entry.completedByChildId).toBe(CHILD)
		expect(res.recovered).toContainEqual({ field: "completedByChildId", source: "ach" })
	})

	it("recovers childIds from own ACH", async () => {
		const entry: Record<string, unknown> = { id: PARENT, childIds: ["not-a-uuid"] }
		const res = await resolveReferences(entry, ctxFor([entry, childEntry()], achWith(CHILD)))

		expect(res.changed).toBe(true)
		expect(entry.childIds).toEqual([CHILD])
		expect(res.recovered).toContainEqual({ field: "childIds", source: "ach" })
	})

	it("recovers childIds from cross-task index when ACH has no candidates", async () => {
		const entry: Record<string, unknown> = { id: PARENT, childIds: ["not-a-uuid"] }
		const res = await resolveReferences(entry, ctxFor([entry, childEntry()], null))

		expect(res.changed).toBe(true)
		expect(entry.childIds).toEqual([CHILD])
		expect(res.recovered).toContainEqual({ field: "childIds", source: "index" })
	})

	it("recovers delegatedToId from own ACH", async () => {
		const entry: Record<string, unknown> = { id: PARENT, delegatedToId: "scrambled-text" }
		const res = await resolveReferences(entry, ctxFor([entry, childEntry()], achWith(CHILD)))

		expect(res.changed).toBe(true)
		expect(entry.delegatedToId).toBe(CHILD)
		expect(res.recovered).toContainEqual({ field: "delegatedToId", source: "ach" })
	})

	it("recovers parentTaskId from cross-task index", async () => {
		const parentEntry: Record<string, unknown> = { id: PARENT, childIds: [CHILD] }
		const entry: Record<string, unknown> = { id: CHILD, parentTaskId: "scrambled-text" }
		const res = await resolveReferences(entry, ctxFor([entry, parentEntry], null))

		expect(res.changed).toBe(true)
		expect(entry.parentTaskId).toBe(PARENT)
		expect(res.recovered).toContainEqual({ field: "parentTaskId", source: "index" })
	})

	it("recovers rootTaskId by walking the recovered parent chain", async () => {
		const grandEntry: Record<string, unknown> = { id: GRAND }
		const parentEntry: Record<string, unknown> = { id: PARENT, parentTaskId: GRAND, childIds: [CHILD] }
		const entry: Record<string, unknown> = { id: CHILD, parentTaskId: PARENT, rootTaskId: "scrambled-text" }
		const res = await resolveReferences(entry, ctxFor([entry, parentEntry, grandEntry], null))

		expect(res.changed).toBe(true)
		expect(entry.rootTaskId).toBe(GRAND)
		expect(res.recovered).toContainEqual({ field: "rootTaskId", source: "index" })
	})

	it("unsets rootTaskId when no parent chain exists", async () => {
		const entry: Record<string, unknown> = { id: CHILD, rootTaskId: "scrambled-text" }
		const res = await resolveReferences(entry, ctxFor([entry], null))

		expect(res.changed).toBe(true)
		expect(entry.rootTaskId).toBeUndefined()
	})

	it("unsets awaitingChildId when corrupted", async () => {
		const entry: Record<string, unknown> = { id: PARENT, status: "active", awaitingChildId: "scrambled-text" }
		const res = await resolveReferences(entry, ctxFor([entry], null))

		expect(res.changed).toBe(true)
		expect(entry.awaitingChildId).toBeUndefined()
		expect(res.recovered).toEqual([])
	})

	it("leaves valid references untouched", async () => {
		const entry: Record<string, unknown> = {
			id: PARENT,
			status: "delegated",
			delegatedToId: CHILD,
			awaitingChildId: CHILD,
			childIds: [CHILD],
			completedByChildId: CHILD,
			completionResultSummary: "done",
		}
		const res = await resolveReferences(entry, ctxFor([entry, childEntry()], null))

		expect(res.changed).toBe(false)
		expect(res.recovered).toEqual([])
		expect(entry.status).toBe("delegated")
	})

	it("recovers parentTaskId from a backup file", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-resolve-refs-"))
		const backupPath = path.join(dir, "history_item.json.20260813-000000.bak.json")
		fs.writeFileSync(backupPath, JSON.stringify({ id: PARENT, childIds: [CHILD] }), "utf8")

		try {
			const entry: Record<string, unknown> = { id: CHILD, parentTaskId: "scrambled-text" }
			const res = await resolveReferences(entry, {
				fullIndex: new Map([[CHILD, entry]]),
				taskIds: new Set([CHILD]),
				ach: null,
				backups: [backupPath],
			})

			expect(res.changed).toBe(true)
			expect(entry.parentTaskId).toBe(PARENT)
			expect(res.recovered).toContainEqual({ field: "parentTaskId", source: "backup" })
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it("reconciles a delegated task with a corrupt awaitingChildId to interrupted", async () => {
		const entry: Record<string, unknown> = {
			id: PARENT,
			status: "delegated",
			delegatedToId: CHILD,
			awaitingChildId: "scrambled-text",
			childIds: [CHILD],
			completedByChildId: CHILD,
			completionResultSummary: "done",
		}
		const res = await resolveReferences(entry, ctxFor([entry, childEntry()], null))

		expect(res.changed).toBe(true)
		expect(entry.status).toBe("interrupted")
		expect(entry.delegatedToId).toBeUndefined()
		expect(entry.awaitingChildId).toBeUndefined()
	})
})

describe("reconcileStatus", () => {
	it("marks delegated as interrupted when completionResultSummary is missing", () => {
		const entry: Record<string, unknown> = {
			id: PARENT,
			status: "delegated",
			delegatedToId: CHILD,
			awaitingChildId: CHILD,
			childIds: [CHILD],
			completedByChildId: CHILD,
		}
		const changed = reconcileStatus(entry)

		expect(changed).toBe(true)
		expect(entry.status).toBe("interrupted")
		expect(entry.delegatedToId).toBeUndefined()
		expect(entry.awaitingChildId).toBeUndefined()
	})

	it("leaves a complete delegated task untouched", () => {
		const entry: Record<string, unknown> = {
			id: PARENT,
			status: "delegated",
			delegatedToId: CHILD,
			awaitingChildId: CHILD,
			childIds: [CHILD],
			completedByChildId: CHILD,
			completionResultSummary: "done",
		}
		expect(reconcileStatus(entry)).toBe(false)
		expect(entry.status).toBe("delegated")
	})

	it("unsets awaitingChildId on an active task", () => {
		const entry: Record<string, unknown> = { id: PARENT, status: "active", awaitingChildId: CHILD }
		const changed = reconcileStatus(entry)

		expect(changed).toBe(true)
		expect(entry.awaitingChildId).toBeUndefined()
		expect(entry.status).toBe("active")
	})

	it("leaves completed tasks untouched", () => {
		const entry: Record<string, unknown> = { id: CHILD, status: "completed", parentTaskId: PARENT }
		expect(reconcileStatus(entry)).toBe(false)
		expect(entry.status).toBe("completed")
	})
})

describe("recoverFields", () => {
	it("recovers numeric fields from the index entry", () => {
		const entry: Record<string, unknown> = {
			id: CHILD,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cacheReads: 0,
			cacheWrites: 0,
			number: 0,
		}
		const res = recoverFields(entry, {
			indexEntry: {
				id: CHILD,
				tokensIn: 500,
				tokensOut: 300,
				totalCost: 0.001,
				cacheReads: 480,
				cacheWrites: 10,
				number: 3,
			},
		})

		expect(entry.tokensIn).toBe(500)
		expect(entry.tokensOut).toBe(300)
		expect(entry.totalCost).toBe(0.001)
		expect(entry.cacheReads).toBe(480)
		expect(entry.cacheWrites).toBe(10)
		expect(entry.number).toBe(3)
		expect(res.recovered).toContainEqual({ field: "tokensIn", source: "index" })
		expect(res.recovered).toContainEqual({ field: "number", source: "index" })
	})

	it("recovers numeric fields from task backups when the index lacks values", () => {
		const entry: Record<string, unknown> = { id: CHILD, tokensIn: 0, tokensOut: 0, number: 0 }
		const res = recoverFields(entry, {
			taskBackups: [{ id: CHILD, tokensIn: 750, tokensOut: 400, number: 5 }],
		})

		expect(entry.tokensIn).toBe(750)
		expect(entry.tokensOut).toBe(400)
		expect(entry.number).toBe(5)
		expect(res.recovered).toContainEqual({ field: "tokensIn", source: "backup" })
	})

	it("takes the highest non-zero value across sources", () => {
		const entry: Record<string, unknown> = { id: CHILD, tokensIn: 0 }
		const res = recoverFields(entry, {
			indexEntry: { id: CHILD, tokensIn: 100 },
			taskBackups: [{ id: CHILD, tokensIn: 900 }],
			indexBackups: [{ id: CHILD, tokensIn: 400 }],
		})

		expect(entry.tokensIn).toBe(900)
		expect(res.recovered).toContainEqual({ field: "tokensIn", source: "backup" })
	})

	it("prefers the index value for numeric fields when it is the highest", () => {
		const entry: Record<string, unknown> = { id: CHILD, tokensIn: 0 }
		const res = recoverFields(entry, {
			indexEntry: { id: CHILD, tokensIn: 900 },
			taskBackups: [{ id: CHILD, tokensIn: 100 }],
		})

		expect(entry.tokensIn).toBe(900)
		expect(res.recovered).toContainEqual({ field: "tokensIn", source: "index" })
	})

	it("defaults number to 1 when no source provides a positive number", () => {
		const entry: Record<string, unknown> = { id: CHILD, number: 0 }
		const res = recoverFields(entry, { taskBackups: [{ id: CHILD, number: 0 }] })

		expect(entry.number).toBe(1)
		expect(res.recovered).toContainEqual({ field: "number", source: "default" })
	})

	it("recovers scalar strings from the index entry (first non-empty)", () => {
		const entry: Record<string, unknown> = { id: CHILD, mode: "", workspace: "", apiConfigName: "" }
		const res = recoverFields(entry, {
			indexEntry: { id: CHILD, mode: "plan", workspace: "/ws", apiConfigName: "deepseek" },
		})

		expect(entry.mode).toBe("plan")
		expect(entry.workspace).toBe("/ws")
		expect(entry.apiConfigName).toBe("deepseek")
		expect(res.recovered).toContainEqual({ field: "mode", source: "index" })
	})

	it("recovers scalar strings from backups when the index lacks them", () => {
		const entry: Record<string, unknown> = { id: CHILD }
		const res = recoverFields(entry, {
			taskBackups: [{ id: CHILD, mode: "code", workspace: "/backup-ws", apiConfigName: "openai" }],
		})

		expect(entry.mode).toBe("code")
		expect(entry.workspace).toBe("/backup-ws")
		expect(entry.apiConfigName).toBe("openai")
		expect(res.recovered).toContainEqual({ field: "workspace", source: "backup" })
	})

	it("applies scalar defaults when no source has a non-empty value", () => {
		const entry: Record<string, unknown> = { id: CHILD }
		const res = recoverFields(entry, {})

		expect(entry.mode).toBe("unknown")
		expect(entry.workspace).toBe(os.homedir())
		expect(entry.apiConfigName).toBe("unknown")
		expect(res.recovered).toContainEqual({ field: "mode", source: "default" })
		expect(res.recovered).toContainEqual({ field: "workspace", source: "default" })
		expect(res.recovered).toContainEqual({ field: "apiConfigName", source: "default" })
	})

	it("leaves already-set fields untouched", () => {
		const entry: Record<string, unknown> = {
			id: CHILD,
			tokensIn: 42,
			mode: "existing",
			workspace: "/existing",
			apiConfigName: "existing",
			number: 7,
		}
		const res = recoverFields(entry, {
			indexEntry: {
				id: CHILD,
				tokensIn: 999,
				mode: "other",
				workspace: "/other",
				apiConfigName: "other",
				number: 9,
			},
		})

		expect(entry.tokensIn).toBe(42)
		expect(entry.mode).toBe("existing")
		expect(entry.workspace).toBe("/existing")
		expect(entry.apiConfigName).toBe("existing")
		expect(entry.number).toBe(7)
		expect(res.changed).toBe(false)
		expect(res.recovered).toEqual([])
	})
})
