/**
 * @file src/lib/__tests__/integration/rebuildUiMessages.fixtures.spec.ts
 *
 * Round-trip smoke tests: rebuild ui_messages from the scrambled
 * ground-truth fixtures and assert structural fidelity against the
 * corresponding ui_messages.json. Fixtures are copied from
 * tests/fixtures/ground_truth into a temp dir before each test.
 */

import fs from "node:fs"
import path from "node:path"
import { rebuildUiMessages } from "../../rebuildUiMessages.js"
import { copyGroundTruthFixtures, createTempDir } from "../testHelpers.js"

function readJson(file: string): unknown {
	return JSON.parse(fs.readFileSync(file, "utf8"))
}

describe("rebuildUiMessages against ground-truth fixtures", () => {
	let fixturesDir: string
	let cleanup: () => void

	beforeEach(() => {
		const tmp = createTempDir("zoo-uim-gt-")
		fixturesDir = path.join(tmp.root, "ground_truth")
		copyGroundTruthFixtures(fixturesDir)
		cleanup = tmp.cleanup
	})

	afterEach(() => {
		cleanup()
	})

	it("reconstructs the 01a00183 first user message as a say:text event", () => {
		const dir = path.join(fixturesDir, "01a00183-6850-72ea-9330-6c996575aece")
		const ach = readJson(path.join(dir, "api_conversation_history.json")) as Array<Record<string, unknown>>
		const hi = readJson(path.join(dir, "history_item.json")) as Record<string, unknown>

		const events = rebuildUiMessages(ach, { workspaceRoot: hi.workspace as string | undefined })
		expect(events.length).toBeGreaterThan(0)
		expect(events[0]).toMatchObject({ type: "say", say: "text" })
		expect((events[0] as { text?: string }).text).toBeTruthy()
	})

	it("maps the 01a00183 first read_file tool_use to ask:tool readFile", () => {
		const dir = path.join(fixturesDir, "01a00183-6850-72ea-9330-6c996575aece")
		const ach = readJson(path.join(dir, "api_conversation_history.json")) as Array<Record<string, unknown>>
		const hi = readJson(path.join(dir, "history_item.json")) as Record<string, unknown>

		const events = rebuildUiMessages(ach, { workspaceRoot: hi.workspace as string | undefined })
		const readAsk = events.find((e) => e.type === "ask" && e.ask === "tool")
		expect(readAsk).toBeDefined()
		const descriptor = JSON.parse((readAsk as { text?: string }).text ?? "{}")
		expect(descriptor).toMatchObject({ tool: "readFile" })
	})

	it("reconstructs the parent new_task + subtask_result and child completion_result", () => {
		const parent = path.join(fixturesDir, "01a00269-e570-7738-8569-e56c7a9752d4")
		const parentAch = readJson(path.join(parent, "api_conversation_history.json")) as Array<Record<string, unknown>>
		const parentHi = readJson(path.join(parent, "history_item.json")) as Record<string, unknown>
		const parentEvents = rebuildUiMessages(parentAch, { workspaceRoot: parentHi.workspace as string | undefined })

		const newTask = parentEvents.find(
			(e) => e.type === "ask" && e.ask === "tool" && String(e.text).includes("newTask"),
		)
		expect(newTask).toBeDefined()
		const newTaskDesc = JSON.parse((newTask as { text?: string }).text ?? "{}")
		expect(newTaskDesc).toMatchObject({ tool: "newTask", mode: "❓ Ask" })
		expect(String(newTaskDesc.content)).toMatch(/^Just say hello\. This subtask/)

		const subtaskResult = parentEvents.find((e) => e.type === "say" && e.say === "subtask_result")
		expect(subtaskResult).toBeDefined()
		expect((subtaskResult as { text?: string }).text).toMatch(/I have greeted the user/)

		const child = path.join(fixturesDir, "01a0026a-0487-74ed-9746-904e57017726")
		const childAch = readJson(path.join(child, "api_conversation_history.json")) as Array<Record<string, unknown>>
		const childEvents = rebuildUiMessages(childAch)
		const completion = childEvents.find((e) => e.type === "say" && e.say === "completion_result")
		expect(completion).toBeDefined()
		const finishAsk = childEvents.find((e) => e.type === "ask" && e.ask === "tool")
		expect(JSON.parse((finishAsk as { text?: string }).text ?? "{}")).toMatchObject({ tool: "finishTask" })
	})
})
