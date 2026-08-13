import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    formatRepairParts,
    repairTaskDir
} from "../repairTask.js"

describe("repairTaskDir", () => {
    let root: string
    let taskDir: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-repair-task-"))
        taskDir = path.join(root, "task-abc")
        fs.mkdirSync(taskDir)
    })

    afterEach(async () => {
        await new Promise(r => setTimeout(r, 150))
        fs.rmSync(root, {recursive: true, force: true})
    })

    function writeJson(name: string, data: unknown) {
        fs.writeFileSync(path.join(taskDir, name), JSON.stringify(data), "utf8")
    }

    function readJson(name: string): unknown {
        const p = path.join(taskDir, name)
        if (!fs.existsSync(p)) return null
        return JSON.parse(fs.readFileSync(p, "utf8"))
    }

    it("returns error when api_conversation_history.json is missing", async () => {
        const result = await repairTaskDir(taskDir)
        expect(result.errors).toContain(
            "missing or invalid api_conversation_history.json — cannot repair",
        )
        expect(result.uiRepaired).toBe(false)
        expect(result.taskRepaired).toBe(false)
        expect(result.sizeRepaired).toBe(false)
    })

    it("returns error when api_conversation_history.json is empty array", async () => {
        writeJson("api_conversation_history.json", [])
        const result = await repairTaskDir(taskDir)
        expect(result.errors).toContain("missing history_item.json — cannot repair task or size")
    })

    it("rebuilds empty ui_messages.json from ACH", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "Hello"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 0, ts: 1})
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.uiRepaired).toBe(true)
        expect(result.errors).toEqual([])

        const ui = readJson("ui_messages.json") as Array<Record<string, unknown>>
        expect(ui).toHaveLength(1)
        expect(ui[0]).toMatchObject({say: "text", text: "Hello"})
    })

    it("repairs placeholder task text from ACH", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Fix the login bug</user_message>"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Task #1", size: 100, ts: 1})
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.taskRepaired).toBe(true)

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.task).toBe("Fix the login bug")
    })

    it("repairs missing task text from ACH", async () => {
        writeJson("api_conversation_history.json", [
            {
                role: "user",
                content: [{type: "text", text: "<user_message>Implement feature X</user_message>"}],
                ts: 100
            },
        ])
        writeJson("history_item.json", {id: "task-abc", task: "", size: 100, ts: 1})
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.taskRepaired).toBe(true)

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.task).toBe("Implement feature X")
    })

    it("recomputes incorrect size", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "Hi"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 1, ts: 1})
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "A"}])
        writeJson("task_metadata.json", {created: 1})

        const result = await repairTaskDir(taskDir)
        expect(result.sizeRepaired).toBe(true)

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.size).not.toBe(1)
        expect(typeof hi.size).toBe("number")
        expect(hi.size).toBeGreaterThan(0)
    })

    it("does not write in dry-run mode", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Dry task</user_message>"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Task #1", size: 1, ts: 1})
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir, {dryRun: true})
        expect(result.uiRepaired).toBe(true)
        expect(result.taskRepaired).toBe(true)
        expect(result.sizeRepaired).toBe(true)

        const ui = readJson("ui_messages.json") as Array<unknown>
        expect(ui).toEqual([])

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.task).toBe("Task #1")
    })

    it("creates backup files when backup is enabled", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "Hello"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 100, ts: 1})
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})

        await repairTaskDir(taskDir, {backup: true})

        const files = fs.readdirSync(taskDir)
        const bakFiles = files.filter((f) => /\.\d{8}-\d{6}\.bak\.json$/.test(f))
        expect(bakFiles.length).toBeGreaterThanOrEqual(1)
        const ui = readJson("ui_messages.json") as Array<unknown>
        expect(ui).toHaveLength(1)
    })

    it("handles all three repairs combined", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Complete redesign</user_message>"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Task #99", size: 0, ts: 1})
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.uiRepaired).toBe(true)
        expect(result.taskRepaired).toBe(true)
        expect(result.sizeRepaired).toBe(true)
        expect(result.errors).toEqual([])

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.task).toBe("Complete redesign")
        expect(hi.size).toBeGreaterThan(0)

        const ui = readJson("ui_messages.json") as Array<unknown>
        expect(ui).toHaveLength(1)
    })

    it("appends a synthetic failed tool_result for interrupted tasks", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Interrupted task</user_message>"}], ts: 100},
            {
                role: "assistant",
                content: [{type: "tool_use", name: "read_file", id: "toolu_1", input: {path: "/x"}}],
                ts: 200
            },
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 100, ts: 1})
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir, {backup: false})
        expect(result.interruptedRepaired).toBe(true)
        expect(formatRepairParts(result)).toContain("ach(interrupted→ach)")

        const ach = readJson("api_conversation_history.json") as Array<Record<string, unknown>>
        const lastTurn = ach[ach.length - 1] as Record<string, unknown>
        expect(lastTurn.role).toBe("user")
        const lastContent = lastTurn.content as Array<Record<string, unknown>>
        expect(lastContent[0]).toMatchObject({
            type: "tool_result",
            tool_use_id: "toolu_1",
            is_error: true,
            content: "Task was interrupted before completion.",
        })
    })

    it("reports error when task cannot be extracted from ACH", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "No user_message tag here"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Task #1", size: 100, ts: 1})
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.errors).toContain("could not extract task from api_conversation_history")
    })

    it("handles missing history_item.json gracefully", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "Hello"}], ts: 100},
        ])
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.errors).toContain("missing history_item.json — cannot repair task or size")
        expect(result.uiRepaired).toBe(true)
    })

    it("handles partial ACH recovery with truncated flag", async () => {
        const achPath = path.join(taskDir, "api_conversation_history.json")
        fs.writeFileSync(achPath, '[{"role":"user","content":[{"type":"text","text":"Hello"}],"ts":100}', "utf8")

        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 100, ts: 1})
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir, {backup: false})
        expect(result.apiTruncated).toBe(true)
        expect(result.sizeRepaired).toBe(true)
    })

    it("recovers a corrupted parentTaskId from a backup file", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Child task</user_message>"}], ts: 100},
        ])
        writeJson("history_item.json", {
            id: "child-id",
            task: "Child task",
            size: 100,
            ts: 1,
            parentTaskId: "scrambled-text"
        })
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("task_metadata.json", {})

        // A removed-index-entry backup still carries the parent-child relationship.
        fs.writeFileSync(
            path.join(taskDir, "history_item.json.20260813-000000.bak.json"),
            JSON.stringify({id: "parent-id", childIds: ["child-id"]}),
            "utf8",
        )

        const fullIndex = new Map([["child-id", {id: "child-id", parentTaskId: "scrambled-text"}]])
        const taskIds = new Set(["child-id", "parent-id"])

        const result = await repairTaskDir(taskDir, {backup: false, fullIndex, taskIds})

        expect(result.refsRepaired).toBe(true)
        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.parentTaskId).toBe("parent-id")
    })

    it("recovers missing scalar/number fields from a history_item backup (L2/L3)", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Recover fields</user_message>"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 100, ts: 1})
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("task_metadata.json", {})

        fs.writeFileSync(
            path.join(taskDir, "history_item.json.20260813-000000.bak.json"),
            JSON.stringify({id: "task-abc", mode: "plan", workspace: "/ws", apiConfigName: "deepseek", number: 4}),
            "utf8",
        )

        const result = await repairTaskDir(taskDir, {backup: false})
        expect(result.fieldsRepaired).toBe(true)

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.mode).toBe("plan")
        expect(hi.workspace).toBe("/ws")
        expect(hi.apiConfigName).toBe("deepseek")
        expect(hi.number).toBe(4)
    })

    it("applies scalar defaults when no backup source carries values (L3)", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Defaults task</user_message>"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 100, ts: 1})
        writeJson("ui_messages.json", [{type: "say", say: "text", text: "hi"}])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir, {backup: false})
        expect(result.fieldsRepaired).toBe(true)

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.mode).toBe("unknown")
        expect(hi.workspace).toBe(os.homedir())
        expect(hi.apiConfigName).toBe("unknown")
        expect(hi.number).toBe(1)
    })

    it("rebuilds a missing history_item.json with --force-rebuild-hi (L1)", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Rebuild me</user_message>"}], ts: 123456},
        ])
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})
        // history_item.json intentionally absent

        const result = await repairTaskDir(taskDir, {forceRebuildHi: true, backup: false})
        expect(result.hiRebuilt).toBe(true)
        expect(result.unrepairable).toBe(false)
        expect(result.errors).toEqual([])

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.id).toBe("task-abc")
        expect(hi.task).toBe("Rebuild me")
        expect(hi.ts).toBe(123456)
        expect(hi.mode).toBe("unknown")
        expect(hi.workspace).toBe(os.homedir())
        expect(hi.apiConfigName).toBe("unknown")
        expect(hi.number).toBe(1)
        expect(typeof hi.size).toBe("number")
        expect(hi.size).toBeGreaterThan(0)
    })

    it("--force-rebuild-hi recovers numeric fields from a backup", async () => {
        writeJson("api_conversation_history.json", [
            {
                role: "user",
                content: [{type: "text", text: "<user_message>Rebuild with backup</user_message>"}],
                ts: 100
            },
        ])
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})
        fs.writeFileSync(
            path.join(taskDir, "history_item.json.20260813-000000.bak.json"),
            JSON.stringify({id: "task-abc", tokensIn: 321, tokensOut: 123, totalCost: 0.002, number: 9}),
            "utf8",
        )

        const result = await repairTaskDir(taskDir, {forceRebuildHi: true, backup: false})
        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.tokensIn).toBe(321)
        expect(hi.tokensOut).toBe(123)
        expect(hi.totalCost).toBe(0.002)
        expect(hi.number).toBe(9)
        expect(result.fieldsRepaired).toBe(true)
    })

    it("--force-rebuild-hi without an extractable task stays unrepairable", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "no user_message tag"}], ts: 100},
        ])
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir, {forceRebuildHi: true, backup: false})
        expect(result.unrepairable).toBe(true)
        expect(result.errors).toContain("missing history_item.json and no task extractable from api_conversation_history.json — cannot rebuild")
    })
})
