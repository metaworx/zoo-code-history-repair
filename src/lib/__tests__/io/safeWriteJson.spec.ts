import * as fsSyncActual from "fs"
import { Writable } from "stream"
import * as path from "path"
import * as os from "os"

import { safeWriteJson } from "../../io/safeWriteJson.js"

// Capture actual implementations before the vi.mock factory runs,
// so they are never wrapped by vi.fn() — avoids infinite recursion when
// test mockImplementation callbacks delegate to the real implementation.
const fsPromisesActuals = vi.hoisted(() => ({
	rename: undefined as (typeof import("fs/promises"))["rename"] | undefined,
	unlink: undefined as (typeof import("fs/promises"))["unlink"] | undefined,
	writeFile: undefined as (typeof import("fs/promises"))["writeFile"] | undefined,
}))

vi.mock("fs/promises", async () => {
	const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises")
	fsPromisesActuals.rename = actual.rename
	fsPromisesActuals.unlink = actual.unlink
	fsPromisesActuals.writeFile = actual.writeFile
	// Start with all actual implementations.
	const mockedFs = { ...actual }
	// Selectively wrap functions with vi.fn() if they are spied on
	// or have their implementations changed in tests.
	mockedFs.writeFile = vi.fn(actual.writeFile) as any
	mockedFs.readFile = vi.fn(actual.readFile) as any
	mockedFs.rename = vi.fn(actual.rename) as any
	mockedFs.unlink = vi.fn(actual.unlink) as any
	mockedFs.access = vi.fn(actual.access) as any
	mockedFs.mkdtemp = vi.fn(actual.mkdtemp) as any
	mockedFs.rm = vi.fn(actual.rm) as any
	mockedFs.readdir = vi.fn(actual.readdir) as any
	mockedFs.mkdir = vi.fn(actual.mkdir) as any

	return mockedFs
})

// Mock the 'fs' module for fsSync.createWriteStream
vi.mock("fs", async () => {
	const actualFs = await vi.importActual<typeof import("fs")>("fs")
	return {
		...actualFs,
		createWriteStream: vi.fn(actualFs.createWriteStream) as any,
	}
})

import * as fs from "fs/promises" // This will now be the mocked version

describe("safeWriteJson", () => {
	let originalConsoleError: typeof console.error

	beforeAll(() => {
		originalConsoleError = console.error
		console.error = () => {}
	})

	afterAll(() => {
		console.error = originalConsoleError
	})

	let tempDir: string
	let currentTestFilePath: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "safeWriteJson-test-"))
		currentTestFilePath = path.join(tempDir, "test-file.json")
		// Pre-create the file with initial content to ensure it exists
		await fs.writeFile(currentTestFilePath, JSON.stringify({ initial: "content" }))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	async function readFileContent(filePath: string): Promise<any> {
		const readContent = await fs.readFile(filePath, "utf-8")
		return JSON.parse(readContent)
	}

	async function fileExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath)
			return true
		} catch {
			return false
		}
	}

	// === Zoo-Code original tests (adapted) ===

	test("should successfully write a new file (overwriting initial content from beforeEach)", async () => {
		const data = { message: "Hello, new world!" }
		await safeWriteJson(currentTestFilePath, data)
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(data)
	})

	test("should successfully overwrite an existing file", async () => {
		const initialData = { message: "Initial content" }
		const newData = { message: "Updated content" }
		await fsPromisesActuals.writeFile!(currentTestFilePath, JSON.stringify(initialData))
		await safeWriteJson(currentTestFilePath, newData)
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(newData)
	})

	test("should handle failure when writing to tempNewFilePath", async () => {
		const data = { message: "test write failure" }
		const mockErrorStream = new Writable() as any
		mockErrorStream._write = (_chunk: any, _encoding: any, callback: any) => {
			callback(new Error("Write stream error"))
		}
		mockErrorStream.close = vi.fn()
		mockErrorStream.bytesWritten = 0
		mockErrorStream.path = ""
		mockErrorStream.pending = false
		;(fsSyncActual.createWriteStream as any).mockImplementationOnce((_path: any, _options: any) => {
			return mockErrorStream
		})
		await expect(safeWriteJson(currentTestFilePath, data)).rejects.toThrow("Write stream error")
		const exists = await fileExists(currentTestFilePath)
		expect(exists).toBe(true)
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual({ initial: "content" })
	})

	test("should handle failure when renaming filePath to tempBackupFilePath", async () => {
		const initialData = { message: "Initial content, should remain" }
		const newData = { message: "New content, should not be written" }
		await fsPromisesActuals.writeFile!(currentTestFilePath, JSON.stringify(initialData))
		vi.mocked(fs.rename).mockImplementationOnce(async () => {
			throw new Error("Rename to backup failed")
		})
		await expect(safeWriteJson(currentTestFilePath, newData)).rejects.toThrow("Rename to backup failed")
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(initialData)
	})

	test("should handle failure when renaming tempNewFilePath to filePath (backup succeeded, rollback)", async () => {
		const initialData = { message: "Initial content, should be restored" }
		const newData = { message: "New content" }
		await fsPromisesActuals.writeFile!(currentTestFilePath, JSON.stringify(initialData))
		let renameCallCount = 0
		vi.mocked(fs.rename).mockImplementation(async (oldPath, newPath) => {
			renameCallCount++
			if (renameCallCount === 1) {
				return fsPromisesActuals.rename!(oldPath, newPath)
			} else if (renameCallCount === 2) {
				throw new Error("Rename from temp to final failed")
			} else if (renameCallCount === 3) {
				return fsPromisesActuals.rename!(oldPath, newPath)
			}
			return fsPromisesActuals.rename!(oldPath, newPath)
		})
		await expect(safeWriteJson(currentTestFilePath, newData)).rejects.toThrow("Rename from temp to final failed")
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(initialData)
	})

	test("should create parent directory if it doesn't exist", async () => {
		const subDir = path.join(tempDir, "new-subdir")
		const filePath = path.join(subDir, "file.json")
		const data = { test: "directory creation" }
		await expect(fs.access(subDir)).rejects.toThrow()
		await safeWriteJson(filePath, data)
		await expect(fs.access(subDir)).resolves.toBeUndefined()
		const content = await readFileContent(filePath)
		expect(content).toEqual(data)
	})

	test("should handle multi-level directory creation", async () => {
		const deepDir = path.join(tempDir, "level1", "level2", "level3")
		const filePath = path.join(deepDir, "deep-file.json")
		const data = { nested: "deeply" }
		await expect(fs.access(path.join(tempDir, "level1"))).rejects.toThrow()
		await safeWriteJson(filePath, data)
		await expect(fs.access(path.join(tempDir, "level1"))).resolves.toBeUndefined()
		await expect(fs.access(path.join(tempDir, "level1", "level2"))).resolves.toBeUndefined()
		await expect(fs.access(deepDir)).resolves.toBeUndefined()
		const content = await readFileContent(filePath)
		expect(content).toEqual(data)
	})

	test("should handle directory creation permission errors", async () => {
		vi.mocked(fs.mkdir).mockImplementationOnce(async () => {
			const error = new Error("EACCES: permission denied") as any
			error.code = "EACCES"
			throw error
		})
		const subDir = path.join(tempDir, "forbidden-dir")
		const filePath = path.join(subDir, "file.json")
		const data = { test: "permission error" }
		await expect(safeWriteJson(filePath, data)).rejects.toThrow("EACCES: permission denied")
		await expect(fs.access(subDir)).rejects.toThrow()
	})

	test("should successfully write to a non-existent file in an existing directory", async () => {
		const subDir = path.join(tempDir, "existing-dir")
		await fs.mkdir(subDir)
		const filePath = path.join(subDir, "new-file.json")
		const data = { fresh: "file" }
		await expect(fs.access(filePath)).rejects.toThrow()
		await safeWriteJson(filePath, data)
		const content = await readFileContent(filePath)
		expect(content).toEqual(data)
	})

	test("should handle failure when deleting tempBackupFilePath", async () => {
		const initialData = { message: "Initial content" }
		const newData = { message: "Successfully written new content" }
		await fsPromisesActuals.writeFile!(currentTestFilePath, JSON.stringify(initialData))
		vi.mocked(fs.unlink).mockImplementationOnce(async () => {
			throw new Error("Failed to delete backup file")
		})
		await safeWriteJson(currentTestFilePath, newData)
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(newData)
	})

	test("should throw an error if an inter-process lock is already held", async () => {
		vi.resetModules()
		const data = { message: "test lock failure" }
		const lockTestFilePath = path.join(tempDir, "lock-test-file.json")
		await fs.writeFile(lockTestFilePath, JSON.stringify({ initial: "lock test content" }))
		vi.doMock("proper-lockfile", () => ({
			...vi.importActual("proper-lockfile"),
			lock: vi.fn().mockRejectedValueOnce(new Error("Failed to get lock.")),
		}))
		const { safeWriteJson: mockedSafeWriteJson } = await import("../../io/safeWriteJson.js")
		await expect(mockedSafeWriteJson(lockTestFilePath, data)).rejects.toThrow("Failed to get lock.")
		await fs.unlink(lockTestFilePath).catch(() => {})
		vi.unmock("proper-lockfile")
	})

	test("should release lock even if an error occurs mid-operation", async () => {
		const data = { message: "test lock release on error" }
		const createWriteStreamSpy = vi.spyOn(fsSyncActual, "createWriteStream")
		createWriteStreamSpy.mockImplementationOnce((_path: any, _options: any) => {
			const errorStream = new Writable() as any
			errorStream._write = (_chunk: any, _encoding: any, callback: any) => {
				callback(new Error("Stream write error"))
			}
			errorStream.close = vi.fn()
			errorStream.bytesWritten = 0
			errorStream.path = _path
			errorStream.pending = false
			return errorStream
		})
		await expect(safeWriteJson(currentTestFilePath, data)).rejects.toThrow("Stream write error")
		createWriteStreamSpy.mockRestore()
		await expect(safeWriteJson(currentTestFilePath, data)).resolves.toBeDefined()
	})

	// === New tests for extension features ===

	test("stringify=false: writes raw string verbatim", async () => {
		const rawString = "just a string, not JSON"
		await safeWriteJson(currentTestFilePath, rawString, { stringify: false })
		const content = await fs.readFile(currentTestFilePath, "utf-8")
		expect(content).toBe(rawString)
	})

	test("stringify=true (default): JSON-serializes object", async () => {
		const data = { x: 1, y: [2, 3] }
		await safeWriteJson(currentTestFilePath, data, { stringify: true })
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(data)
	})

	test("backupPath: returns backup path on overwrite, file exists at path", async () => {
		const initialData = { message: "Initial" }
		const newData = { message: "New" }
		await fsPromisesActuals.writeFile!(currentTestFilePath, JSON.stringify(initialData))
		const result = await safeWriteJson(currentTestFilePath, newData, { keepBackup: true })
		expect(result.backupPath).toBeTruthy()
		expect(result.backupPath).toMatch(/\.bak_.*\.tmp$/)
		expect(fsSyncActual.existsSync(result.backupPath!)).toBe(true)
		const backupContent = JSON.parse(fsSyncActual.readFileSync(result.backupPath!, "utf-8"))
		expect(backupContent).toEqual(initialData)
		// Caller cleans up
		fsSyncActual.unlinkSync(result.backupPath!)
	})

	test("backupPath: null for new file (no pre-existing target)", async () => {
		const newFilePath = path.join(tempDir, "brand-new.json")
		const data = { fresh: "start" }
		const result = await safeWriteJson(newFilePath, data)
		expect(result.backupPath).toBeNull()
		const content = await readFileContent(newFilePath)
		expect(content).toEqual(data)
	})
})
