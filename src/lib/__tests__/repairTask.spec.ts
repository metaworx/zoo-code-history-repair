import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { repairTaskDir } from "../repairTask.js"

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
        fs.rmSync(root, { recursive: true, force: true })
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
            {role: "user", content: [{ type: "text", text: "Hello" }], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 0, ts: 1})
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.uiRepaired).toBe(true)
        expect(result.errors).toEqual([])

        const ui = readJson("ui_messages.json") as Array<Record<string, unknown>>
        expect(ui).toHaveLength(1)
        expect(ui[0]).toMatchObject({ say: "text", text: "Hello" })
    })

    it("repairs placeholder task text from ACH", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Fix the login bug</user_message>"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Task #1", size: 100, ts: 1})
        writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.taskRepaired).toBe(true)

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.task).toBe("Fix the login bug")
    })

    it("repairs missing task text from ACH", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{type: "text", text: "<user_message>Implement feature X</user_message>"}], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "", size: 100, ts: 1})
        writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.taskRepaired).toBe(true)

        const hi = readJson("history_item.json") as Record<string, unknown>
        expect(hi.task).toBe("Implement feature X")
    })

    it("recomputes incorrect size", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{ type: "text", text: "Hi" }], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 1, ts: 1})
        writeJson("ui_messages.json", [{ type: "say", say: "text", text: "A" }])
        writeJson("task_metadata.json", { created: 1 })

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

        const result = await repairTaskDir(taskDir, { dryRun: true })
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
            {role: "user", content: [{ type: "text", text: "Hello" }], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Real task", size: 100, ts: 1})
        writeJson("ui_messages.json", [])
        writeJson("task_metadata.json", {})

        await repairTaskDir(taskDir, { backup: true })

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

    it("reports error when task cannot be extracted from ACH", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{ type: "text", text: "No user_message tag here" }], ts: 100},
        ])
        writeJson("history_item.json", {id: "task-abc", task: "Task #1", size: 100, ts: 1})
        writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir)
        expect(result.errors).toContain("could not extract task from api_conversation_history")
    })

    it("handles missing history_item.json gracefully", async () => {
        writeJson("api_conversation_history.json", [
            {role: "user", content: [{ type: "text", text: "Hello" }], ts: 100},
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
        writeJson("ui_messages.json", [{ type: "say", say: "text", text: "hi" }])
        writeJson("task_metadata.json", {})

        const result = await repairTaskDir(taskDir, { backup: false })
        expect(result.apiTruncated).toBe(true)
        expect(result.sizeRepaired).toBe(true)
    })
})
