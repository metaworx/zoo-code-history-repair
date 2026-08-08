import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
    API_HISTORY_NAME,
    DEFAULT_INDEX_NAME,
    HISTORY_ITEM_NAME,
    TASK_METADATA_NAME,
    UI_MESSAGES_NAME,
    listTaskDirs,
    resolveIndexPath,
    resolveTasksDir,
} from "../paths.js"

describe("constants", () => {
    it("DEFAULT_INDEX_NAME is _index.json", () => {
        expect(DEFAULT_INDEX_NAME).toBe("_index.json")
    })

    it("HISTORY_ITEM_NAME is history_item.json", () => {
        expect(HISTORY_ITEM_NAME).toBe("history_item.json")
    })

    it("UI_MESSAGES_NAME is ui_messages.json", () => {
        expect(UI_MESSAGES_NAME).toBe("ui_messages.json")
    })

    it("API_HISTORY_NAME is api_conversation_history.json", () => {
        expect(API_HISTORY_NAME).toBe("api_conversation_history.json")
    })

    it("TASK_METADATA_NAME is task_metadata.json", () => {
        expect(TASK_METADATA_NAME).toBe("task_metadata.json")
    })
})

describe("resolveTasksDir", () => {
    let root: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-paths-"))
    })

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    })

    it("returns tasks/ subdirectory when it exists", () => {
        const tasksDir = path.join(root, "tasks")
        fs.mkdirSync(tasksDir)
        expect(resolveTasksDir(root)).toBe(tasksDir)
    })

    it("returns storageRoot itself when tasks/ does not exist", () => {
        expect(resolveTasksDir(root)).toBe(root)
    })
})

describe("resolveIndexPath", () => {
    it("returns tasksDir/_index.json", () => {
        expect(resolveIndexPath("/foo/tasks")).toBe(
            path.join("/foo/tasks", "_index.json"),
        )
    })

    it("works with Windows-style paths", () => {
        const result = resolveIndexPath("C:\\data\\tasks")
        expect(result).toBe(path.join("C:\\data\\tasks", "_index.json"))
    })
})

describe("listTaskDirs", () => {
    let root: string

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-list-"))
    })

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true})
    })

    it("returns empty array for non-existent directory", () => {
        expect(listTaskDirs(path.join(root, "nope"))).toEqual([])
    })

    it("returns empty array for empty directory", () => {
        expect(listTaskDirs(root)).toEqual([])
    })

    it("returns only subdirectories, not files", () => {
        fs.writeFileSync(path.join(root, "file.txt"), "x")
        fs.mkdirSync(path.join(root, "task-abc"))
        fs.mkdirSync(path.join(root, "task-def"))

        const dirs = listTaskDirs(root)
        expect(dirs).toHaveLength(2)
        expect(dirs).toContain(path.join(root, "task-abc"))
        expect(dirs).toContain(path.join(root, "task-def"))
    })

    it("excludes dot-prefixed directories", () => {
        fs.mkdirSync(path.join(root, ".hidden"))
        fs.mkdirSync(path.join(root, "visible"))

        const dirs = listTaskDirs(root)
        expect(dirs).toHaveLength(1)
        expect(dirs[0]).toBe(path.join(root, "visible"))
    })
})
