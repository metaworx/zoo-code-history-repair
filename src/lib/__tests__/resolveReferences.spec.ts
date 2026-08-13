import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {reconcileStatus, resolveReferences} from "../resolveReferences.js"
import type {ReferenceContext} from "../resolveReferences.js"

const GRAND = "aaaaaaaa-1111-4111-8111-111111111111"
const PARENT = "bbbbbbbb-2222-4222-8222-222222222222"
const CHILD = "cccccccc-3333-4333-8333-333333333333"

function ctxFor(entries: Array<Record<string, unknown>>, ach: unknown[] | null = null): ReferenceContext {
    const fullIndex = new Map(entries.map(e => [e.id as string, e]))
    return {fullIndex, taskIds: new Set(fullIndex.keys()), ach}
}

function childEntry(): Record<string, unknown> {
    return {id: CHILD, parentTaskId: PARENT}
}

/** ACH containing a single known task UUID (the child) in free text. */
function achWith(childId: string): unknown[] {
    return [{role: "user", content: [{type: "tool_result", tool_use_id: "t1", content: [{type: "text", text: `subtask ${childId} completed`}]}]}]
}

describe("resolveReferences", () => {
    it("recovers completedByChildId from own ACH", () => {
        const entry: Record<string, unknown> = {id: PARENT, completedByChildId: "scrambled-text"}
        const res = resolveReferences(entry, ctxFor([entry, childEntry()], achWith(CHILD)))

        expect(res.changed).toBe(true)
        expect(entry.completedByChildId).toBe(CHILD)
        expect(res.recovered).toContainEqual({field: "completedByChildId", source: "ach"})
    })

    it("recovers childIds from own ACH", () => {
        const entry: Record<string, unknown> = {id: PARENT, childIds: ["not-a-uuid"]}
        const res = resolveReferences(entry, ctxFor([entry, childEntry()], achWith(CHILD)))

        expect(res.changed).toBe(true)
        expect(entry.childIds).toEqual([CHILD])
        expect(res.recovered).toContainEqual({field: "childIds", source: "ach"})
    })

    it("recovers childIds from cross-task index when ACH has no candidates", () => {
        const entry: Record<string, unknown> = {id: PARENT, childIds: ["not-a-uuid"]}
        const res = resolveReferences(entry, ctxFor([entry, childEntry()], null))

        expect(res.changed).toBe(true)
        expect(entry.childIds).toEqual([CHILD])
        expect(res.recovered).toContainEqual({field: "childIds", source: "index"})
    })

    it("recovers delegatedToId from own ACH", () => {
        const entry: Record<string, unknown> = {id: PARENT, delegatedToId: "scrambled-text"}
        const res = resolveReferences(entry, ctxFor([entry, childEntry()], achWith(CHILD)))

        expect(res.changed).toBe(true)
        expect(entry.delegatedToId).toBe(CHILD)
        expect(res.recovered).toContainEqual({field: "delegatedToId", source: "ach"})
    })

    it("recovers parentTaskId from cross-task index", () => {
        const parentEntry: Record<string, unknown> = {id: PARENT, childIds: [CHILD]}
        const entry: Record<string, unknown> = {id: CHILD, parentTaskId: "scrambled-text"}
        const res = resolveReferences(entry, ctxFor([entry, parentEntry], null))

        expect(res.changed).toBe(true)
        expect(entry.parentTaskId).toBe(PARENT)
        expect(res.recovered).toContainEqual({field: "parentTaskId", source: "index"})
    })

    it("recovers rootTaskId by walking the recovered parent chain", () => {
        const grandEntry: Record<string, unknown> = {id: GRAND}
        const parentEntry: Record<string, unknown> = {id: PARENT, parentTaskId: GRAND, childIds: [CHILD]}
        const entry: Record<string, unknown> = {id: CHILD, parentTaskId: PARENT, rootTaskId: "scrambled-text"}
        const res = resolveReferences(entry, ctxFor([entry, parentEntry, grandEntry], null))

        expect(res.changed).toBe(true)
        expect(entry.rootTaskId).toBe(GRAND)
        expect(res.recovered).toContainEqual({field: "rootTaskId", source: "index"})
    })

    it("unsets rootTaskId when no parent chain exists", () => {
        const entry: Record<string, unknown> = {id: CHILD, rootTaskId: "scrambled-text"}
        const res = resolveReferences(entry, ctxFor([entry], null))

        expect(res.changed).toBe(true)
        expect(entry.rootTaskId).toBeUndefined()
    })

    it("unsets awaitingChildId when corrupted", () => {
        const entry: Record<string, unknown> = {id: PARENT, status: "active", awaitingChildId: "scrambled-text"}
        const res = resolveReferences(entry, ctxFor([entry], null))

        expect(res.changed).toBe(true)
        expect(entry.awaitingChildId).toBeUndefined()
        expect(res.recovered).toEqual([])
    })

    it("leaves valid references untouched", () => {
        const entry: Record<string, unknown> = {
            id: PARENT,
            status: "delegated",
            delegatedToId: CHILD,
            awaitingChildId: CHILD,
            childIds: [CHILD],
            completedByChildId: CHILD,
            completionResultSummary: "done",
        }
        const res = resolveReferences(entry, ctxFor([entry, childEntry()], null))

        expect(res.changed).toBe(false)
        expect(res.recovered).toEqual([])
        expect(entry.status).toBe("delegated")
    })

    it("recovers parentTaskId from a backup file", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-resolve-refs-"))
        const backupPath = path.join(dir, "history_item.json.20260813-000000.bak.json")
        fs.writeFileSync(backupPath, JSON.stringify({id: PARENT, childIds: [CHILD]}), "utf8")

        try {
            const entry: Record<string, unknown> = {id: CHILD, parentTaskId: "scrambled-text"}
            const res = resolveReferences(entry, {
                fullIndex: new Map([[CHILD, entry]]),
                taskIds: new Set([CHILD]),
                ach: null,
                backups: [backupPath],
            })

            expect(res.changed).toBe(true)
            expect(entry.parentTaskId).toBe(PARENT)
            expect(res.recovered).toContainEqual({field: "parentTaskId", source: "backup"})
        } finally {
            fs.rmSync(dir, {recursive: true, force: true})
        }
    })

    it("reconciles a delegated task with a corrupt awaitingChildId to interrupted", () => {
        const entry: Record<string, unknown> = {
            id: PARENT,
            status: "delegated",
            delegatedToId: CHILD,
            awaitingChildId: "scrambled-text",
            childIds: [CHILD],
            completedByChildId: CHILD,
            completionResultSummary: "done",
        }
        const res = resolveReferences(entry, ctxFor([entry, childEntry()], null))

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
        const entry: Record<string, unknown> = {id: PARENT, status: "active", awaitingChildId: CHILD}
        const changed = reconcileStatus(entry)

        expect(changed).toBe(true)
        expect(entry.awaitingChildId).toBeUndefined()
        expect(entry.status).toBe("active")
    })

    it("leaves completed tasks untouched", () => {
        const entry: Record<string, unknown> = {id: CHILD, status: "completed", parentTaskId: PARENT}
        expect(reconcileStatus(entry)).toBe(false)
        expect(entry.status).toBe("completed")
    })
})
