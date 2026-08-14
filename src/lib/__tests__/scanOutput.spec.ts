/**
 * @file src/lib/__tests__/scanOutput.spec.ts
 *
 * Unit tests for perFieldRecoverability and formatPerFieldSummary.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from "vitest"
import {
    formatPerFieldSummary,
    perFieldRecoverability,
    type PerFieldRecoverability,
} from "../scanOutput.js"
import type {TaskCorruption} from "../../types.js"

const API_HISTORY_NAME = "api_conversation_history.json"
const CHILD = "cccccccc-3333-4333-8333-333333333333"
const PARENT = "bbbbbbbb-2222-4222-8222-222222222222"

describe("perFieldRecoverability", () => {
    let root: string
    let dir: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-scanout-"))
        dir = path.join(root, "tasks", "task-1")
        fs.mkdirSync(dir, {recursive: true})
    })

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    })

    function writeAch(ach: unknown[]): void {
        fs.writeFileSync(path.join(dir, API_HISTORY_NAME), JSON.stringify(ach), "utf8")
    }

    function corruption(
        diskItem: Record<string, unknown> | null,
        indexItem: Record<string, unknown> | null = null,
    ): TaskCorruption {
        return {
            taskId: "task-1",
            dir,
            reasons: [],
            indexItem: indexItem as unknown as TaskCorruption["indexItem"],
            diskItem: diskItem as unknown as TaskCorruption["diskItem"],
            errorCount: 0,
            warningCount: 0,
        }
    }

    it("recovers token and scalar fields from the index with high confidence", async () => {
        const c = corruption(
            {id: "task-1", tokensIn: 0, tokensOut: 0, totalCost: 0},
            {
                id: "task-1",
                tokensIn: 500,
                tokensOut: 300,
                totalCost: 0.001,
                cacheReads: 480,
                cacheWrites: 10,
                number: 3,
                mode: "code",
                workspace: "/ws",
                apiConfigName: "deepseek",
            },
        )
        const r = await perFieldRecoverability(c)

        expect(r.tokensIn).toEqual({source: "index", confidence: "high", estimatedValue: 500})
        expect(r.tokensOut).toEqual({source: "index", confidence: "high", estimatedValue: 300})
        expect(r.totalCost).toEqual({source: "index", confidence: "high", estimatedValue: 0.001})
        expect(r.cacheReads).toEqual({source: "index", confidence: "high", estimatedValue: 480})
        expect(r.cacheWrites).toEqual({source: "index", confidence: "high", estimatedValue: 10})
        expect(r.number).toEqual({source: "index", confidence: "high", estimatedValue: 3})
        expect(r.mode).toEqual({source: "index", confidence: "high", estimatedValue: "code"})
        expect(r.workspace).toEqual({source: "index", confidence: "high", estimatedValue: "/ws"})
        expect(r.apiConfigName).toEqual({source: "index", confidence: "high", estimatedValue: "deepseek"})
    })

    it("estimates token fields from ACH with medium confidence and extracts the task", async () => {
        writeAch([
            {
                role: "user",
                content: [{type: "text", text: "<user_message>Fix the bug</user_message> please fix the bug now"}],
            },
            {
                role: "assistant",
                content: [{type: "text", text: "I will investigate and fix the bug for you right away"}],
            },
        ])
        const c = corruption(
            {id: "task-1", tokensIn: 0, tokensOut: 0, totalCost: 0, apiConfigName: "deepseek"},
        )
        const r = await perFieldRecoverability(c)

        expect(r.tokensIn.source).toBe("ach")
        expect(r.tokensIn.confidence).toBe("medium")
        expect(typeof r.tokensIn.estimatedValue).toBe("number")
        expect(r.tokensIn.estimatedValue).toBeGreaterThan(0)

        expect(r.tokensOut.source).toBe("ach")
        expect(r.tokensOut.confidence).toBe("medium")
        expect(r.totalCost.source).toBe("ach")
        expect(r.totalCost.confidence).toBe("medium")
        expect(r.cacheReads.source).toBe("ach")
        expect(r.cacheReads.confidence).toBe("medium")
        expect(r.cacheWrites).toEqual({source: "default", confidence: "low", estimatedValue: 0})

        expect(r.number).toEqual({source: "default", confidence: "low", estimatedValue: 1})
        expect(r.task).toEqual({source: "ach", confidence: "high", estimatedValue: "Fix the bug"})
    })

    it("reports already-valid fields with none/high", async () => {
        const c = corruption({
            id: "task-1",
            tokensIn: 42,
            tokensOut: 21,
            totalCost: 0.002,
            cacheReads: 40,
            cacheWrites: 2,
            number: 7,
            mode: "code",
            workspace: "/existing",
            apiConfigName: "deepseek",
            task: "Real task",
        })
        const r = await perFieldRecoverability(c)

        expect(r.tokensIn).toEqual({source: "none", confidence: "high", estimatedValue: 42})
        expect(r.mode).toEqual({source: "none", confidence: "high", estimatedValue: "code"})
        expect(r.task).toEqual({source: "none", confidence: "high", estimatedValue: "Real task"})
        expect(r.number).toEqual({source: "none", confidence: "high", estimatedValue: 7})
    })

    it("reports unrecoverable fields with none/low and applies defaults", async () => {
        const c = corruption({id: "task-1", tokensIn: 0, tokensOut: 0, totalCost: 0, task: ""})
        const r = await perFieldRecoverability(c)

        expect(r.tokensIn).toEqual({source: "none", confidence: "low", estimatedValue: null})
        expect(r.task).toEqual({source: "none", confidence: "low", estimatedValue: null})
        expect(r.mode.source).toBe("default")
        expect(r.mode.confidence).toBe("low")
        expect(r.number).toEqual({source: "default", confidence: "low", estimatedValue: 1})
    })

    it("recovers reference fields from the index", async () => {
        const c = corruption(
            {id: CHILD, parentTaskId: "scrambled-text"},
            {id: CHILD, parentTaskId: "scrambled-text"},
        )
        const fullIndex = new Map<string, Record<string, unknown>>([
            [CHILD, {id: CHILD}],
            [PARENT, {id: PARENT, childIds: [CHILD]}],
        ])
        const r = await perFieldRecoverability(c, fullIndex)

        expect(r.refs.source).toBe("index")
        expect(r.refs.confidence).toBe("high")
        expect(r.refs.estimatedValue).toEqual({parentTaskId: PARENT})
    })

    it("reports refs as none/low when no reference fields exist", async () => {
        const c = corruption({id: CHILD, task: "standalone task"})
        const r = await perFieldRecoverability(c)

        expect(r.refs).toEqual({source: "none", confidence: "low", estimatedValue: null})
    })

    it("formats a compact summary line", () => {
        const r: PerFieldRecoverability = {
            tokensIn: {source: "index", confidence: "high", estimatedValue: 500},
            tokensOut: {source: "ach", confidence: "medium", estimatedValue: 300},
            totalCost: {source: "ach", confidence: "medium", estimatedValue: 0.001},
            cacheReads: {source: "index", confidence: "high", estimatedValue: 480},
            cacheWrites: {source: "default", confidence: "low", estimatedValue: 0},
            number: {source: "default", confidence: "low", estimatedValue: 1},
            mode: {source: "none", confidence: "high", estimatedValue: "code"},
            workspace: {source: "none", confidence: "high", estimatedValue: "/ws"},
            apiConfigName: {source: "none", confidence: "high", estimatedValue: "deepseek"},
            task: {source: "ach", confidence: "high", estimatedValue: "Fix it"},
            refs: {source: "none", confidence: "low", estimatedValue: null},
        }
        const summary = formatPerFieldSummary(r)
        expect(summary).toContain("tokensIn(idx,high)")
        expect(summary).toContain("tokensOut(ach,med)")
        expect(summary).toContain("number(def,low)")
        expect(summary).toContain("mode(—,high)")
    })
})
