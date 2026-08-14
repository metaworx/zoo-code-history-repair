#!/usr/bin/env node
/**
 * scripts/scramble-fixture.ts
 *
 * Copies task directories from Zoo Code source storage, scrambles all text
 * content for privacy while preserving JSON structure and corruption patterns,
 * and writes results to tests/fixtures/tasks/.
 *
 * Usage:
 *   npx tsx scripts/scramble-fixture.ts <taskId> [taskId...]
 *   npx tsx scripts/scramble-fixture.ts [--source <path>] <taskId> [taskId...]
 *
 * If the first argument is an existing directory (absolute or relative to cwd),
 * it is used as the source tasks directory. Otherwise, the source is computed
 * as ~/.zoo-code/globalStorage/wecode-ai.zoo-code/tasks.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import * as crypto from "node:crypto"

const FIXTURE_DIR = "tests/fixtures/tasks"
const HASHES_FILE = "tests/fixtures/hashes.json"
const SCRAMBLE_SRC = "tests/fixtures/scramble_mixed.txt"

// ── Parse args ──────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"))

let sourceTasks: string
let taskIds: string[]

// If first arg is an existing directory, use it as source
if (rawArgs.length > 0) {
	const candidate = path.resolve(rawArgs[0])
	try {
		if (fs.statSync(candidate).isDirectory()) {
			sourceTasks = candidate
			taskIds = rawArgs.slice(1)
		} else {
			sourceTasks = defaultSource()
			taskIds = rawArgs
		}
	} catch {
		sourceTasks = defaultSource()
		taskIds = rawArgs
	}
} else {
	console.error("Usage: npx tsx scripts/scramble-fixture.ts [<source-dir>] <taskId> [taskId...]")
	process.exit(1)
}

function defaultSource(): string {
	return path.join(os.homedir(), ".zoo-code", "globalStorage", "wecode-ai.zoo-code", "tasks")
}

if (taskIds.length === 0) {
	console.error("Usage: npx tsx scripts/scramble-fixture.ts [<source-dir>] <taskId> [taskId...]")
	process.exit(1)
}

// ── Load scramble source (lorem replacement text) ───────────────────────────

function loadScrambleSource(): string {
	if (fs.existsSync(SCRAMBLE_SRC)) {
		return fs.readFileSync(SCRAMBLE_SRC, "utf8")
	}
	// Fallback: embedded lorem ipsum (legacy)
	return (
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod " +
		"tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, " +
		"quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. " +
		"Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu " +
		"fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in " +
		"culpa qui officia deserunt mollit anim id est laborum. "
	).repeat(1200)
}

const LOREM_SOURCE = loadScrambleSource()
console.error(`Scramble source: ${Buffer.byteLength(LOREM_SOURCE, "utf8").toLocaleString()} bytes`)

// ── Field classification ────────────────────────────────────────────────────
const UUID_FIELDS = new Set([
	"id",
	"parentTaskId",
	"rootTaskId",
	"delegatedToId",
	"completedByChildId",
	"awaitingChildId",
])
const ENUM_FIELDS = new Set(["mode", "role", "type", "status"])
const UUID_ARRAY_FIELDS = new Set(["childIds"])
const PATH_FIELDS = new Set(["workspace"])
const PROVIDER_FIELDS = new Set(["apiConfigName"])
const PLACEHOLDER_TASK_RE = /^Task\s*#\s*\d+(\s*\(.*\))?$/i
// Value-based UUID preservation: a string that is itself a UUID is kept.
const UUID_VALUE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_ANY_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const TAG_RE = /<\/?[a-z][a-z0-9_]*>/i
// Split/matching variant — preserves XML-ish tags and embedded UUIDs.
const TOKEN_SPLIT_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|<\/?[a-z][a-z0-9_]*>/gi

// ── Path detection ──────────────────────────────────────────────────────────

function looksLikeFilePath(s: string): boolean {
	if (/^[A-Za-z]:[\\/]/.test(s)) return true
	if (/^\\\\[^\\]+\\/.test(s)) return true
	if (/^\/[a-zA-Z]/.test(s) && s.split(/[\\/]/).length >= 2) {
		if (/\.[a-zA-Z]{1,6}(\s|$)/.test(s)) return true
		if (/\/(home|usr|var|etc|opt|tmp|mnt|media|srv|root|Users|Program)/i.test(s)) return true
	}
	return false
}

// ── Scramble helpers ─────────────────────────────────────────────────────────

function genericPath(targetBytes: number): string {
	let result = "/home/user/projects/generic-project/"
	while (Buffer.byteLength(result, "utf8") < targetBytes) {
		const remaining = targetBytes - Buffer.byteLength(result, "utf8")
		if (remaining >= 40) result += "src/lib/subdir/module/"
		else if (remaining >= 10) result += "file.ext/"
		else result += "x"
	}
	const buf = Buffer.from(result, "utf8")
	return buf.slice(0, targetBytes).toString("utf8")
}

function genericProvider(targetBytes: number): string {
	const providers = ["openai", "anthropic", "deepseek", "google", "meta", "mistral"]
	const provider = providers[targetBytes % providers.length]
	let result = provider
	while (Buffer.byteLength(result, "utf8") < targetBytes) result += "-" + provider
	const buf = Buffer.from(result, "utf8")
	return buf.slice(0, targetBytes).toString("utf8")
}

function loremExact(targetBytes: number): string {
	if (targetBytes === 0) return ""
	const buf = Buffer.from(LOREM_SOURCE, "utf8")
	const available = buf.length - targetBytes
	if (available <= 0) {
		// Source too small — repeat it
		const repeated = Buffer.alloc(targetBytes)
		for (let i = 0; i < targetBytes; i++) {
			repeated[i] = buf[i % buf.length]
		}
		return repeated.toString("utf8")
	}
	const offset = (targetBytes * 7 + 13) % Math.max(1, available)
	return buf.slice(offset, offset + targetBytes).toString("utf8")
}

/** Scramble a string while preserving embedded UUIDs and XML-ish tags. */
function scramblePreservingTokens(value: string): string {
	const tokens = value.match(TOKEN_SPLIT_RE) ?? []
	const parts = value.split(TOKEN_SPLIT_RE)
	let out = ""
	for (let i = 0; i < parts.length; i++) {
		if (parts[i]) out += loremExact(Buffer.byteLength(parts[i], "utf8"))
		if (i < tokens.length) out += tokens[i]
	}
	return out
}

// ── Core scramble logic ──────────────────────────────────────────────────────

const globalReplacements = new Map<string, string>()

function scrambleString(value: string, key: string): string {
	const targetBytes = Buffer.byteLength(value, "utf8")
	if (targetBytes === 0) return ""

	// Apply global replacements as substring replacements (index→ACH sync)
	let result = value
	for (const [orig, repl] of globalReplacements) {
		if (result.includes(orig)) {
			result = result.split(orig).join(repl)
		}
	}
	if (result !== value) return result

	if (globalReplacements.has(value)) return globalReplacements.get(value)!
	if (UUID_FIELDS.has(key)) return value
	if (UUID_ARRAY_FIELDS.has(key)) return value
	if (UUID_VALUE_RE.test(value)) return value
	if (key === "task" && PLACEHOLDER_TASK_RE.test(value)) return value
	if (ENUM_FIELDS.has(key)) return value
	if (PATH_FIELDS.has(key)) return genericPath(targetBytes)
	if (PROVIDER_FIELDS.has(key)) return genericProvider(targetBytes)
	if (looksLikeFilePath(value)) return genericPath(targetBytes)
	if (UUID_ANY_RE.test(value) || TAG_RE.test(value)) {
		return scramblePreservingTokens(value)
	}
	return loremExact(targetBytes)
}

function scrambleValue(value: unknown, key: string): unknown {
	if (typeof value === "string") return scrambleString(value, key)
	if (Array.isArray(value)) {
		if (UUID_ARRAY_FIELDS.has(key)) return value
		return value.map((item, idx) => scrambleValue(item, String(idx)))
	}
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = scrambleValue(v, k)
		}
		return result
	}
	return value
}

// ── Index operations (read once, keep in memory) ─────────────────────────────

let indexRaw: string | null = null

function getIndexRaw(): string {
	if (indexRaw !== null) return indexRaw
	const indexPath = path.join(sourceTasks, "_index.json")
	indexRaw = fs.readFileSync(indexPath, "utf8")
	return indexRaw
}

function extractIndexEntry(taskId: string): string | null {
	const raw = getIndexRaw()
	const searchStr = `"id":"${taskId}"`
	const idPos = raw.indexOf(searchStr)
	if (idPos === -1) return null

	let start = idPos
	let depth = 0
	for (let i = idPos; i >= 0; i--) {
		if (raw[i] === "}") depth++
		else if (raw[i] === "{") {
			if (depth === 0) {
				start = i
				break
			}
			depth--
		}
	}

	let end = start
	depth = 0
	let inString = false,
		escape = false
	for (let i = start; i < raw.length; i++) {
		const ch = raw[i]
		if (escape) {
			escape = false
			continue
		}
		if (ch === "\\") {
			escape = true
			continue
		}
		if (ch === '"') {
			inString = !inString
			continue
		}
		if (inString) continue
		if (ch === "{") depth++
		else if (ch === "}") {
			depth--
			if (depth === 0) {
				end = i + 1
				break
			}
		}
	}

	return raw.slice(start, end)
}

function phase1ScrambleIndex(indexExtract: Record<string, unknown>): void {
	const task = indexExtract.task as string | undefined
	if (!task || !task.trim() || PLACEHOLDER_TASK_RE.test(task)) return
	const scrambled = scrambleString(task, "task")
	globalReplacements.set(task, scrambled)
}

// ── File operations ──────────────────────────────────────────────────────────

function fileSizeStr(filePath: string): string {
	const bytes = fs.statSync(filePath).size
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
	if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}KB`
	return `${bytes}B`
}

function applyGlobalReplacements(raw: string): string {
	let result = raw
	for (const [orig, repl] of globalReplacements) {
		result = result.split(orig).join(repl)
	}
	return result
}

function scrambleJsonFile(filePath: string): void {
	const raw = fs.readFileSync(filePath, "utf8")
	const data = JSON.parse(raw)
	// Apply global replacements during value walk, not on raw text
	const scrambled = scrambleValue(data, "__root__")
	fs.writeFileSync(filePath, JSON.stringify(scrambled), "utf8")
}

function scrambleTextFile(filePath: string): void {
	const raw = fs.readFileSync(filePath, "utf8")
	const targetBytes = Buffer.byteLength(raw, "utf8")
	if (targetBytes === 0) return
	// Try JSON first — some .txt files are actually JSON
	try {
		const data = JSON.parse(raw)
		const scrambled = scrambleValue(data, "__root__")
		fs.writeFileSync(filePath, JSON.stringify(scrambled), "utf8")
		return
	} catch {
		// Not JSON, scramble as plain text
	}
	let content = applyGlobalReplacements(raw)
	content = loremExact(targetBytes)
	fs.writeFileSync(filePath, content, "utf8")
}

function scrambleDir(dirPath: string): void {
	const entries = fs.readdirSync(dirPath, { withFileTypes: true })
	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name)
		if (entry.isDirectory()) {
			process.stdout.write(".")
			scrambleDir(fullPath)
		} else if (entry.name.endsWith(".json")) {
			process.stdout.write(".")
			scrambleJsonFile(fullPath)
		} else if (entry.name.endsWith(".txt")) {
			process.stdout.write(".")
			scrambleTextFile(fullPath)
		}
	}
}

// ── SHA1 hashes ──────────────────────────────────────────────────────────────

function sha1File(filePath: string): string {
	const content = fs.readFileSync(filePath)
	return crypto.createHash("sha1").update(content).digest("hex")
}

function computeHashes(allTaskIds: string[]): Record<string, string> {
	const hashes: Record<string, string> = {}
	function walk(dir: string, prefix: string) {
		const entries = fs.readdirSync(dir, { withFileTypes: true })
		for (const e of entries) {
			const full = path.join(dir, e.name)
			const rel = prefix + e.name
			if (e.isFile()) {
				hashes[rel] = sha1File(full)
			} else if (e.isDirectory()) {
				walk(full, rel + "/")
			}
		}
	}
	for (const id of allTaskIds) {
		const taskDir = path.join(FIXTURE_DIR, id)
		if (fs.existsSync(taskDir)) walk(taskDir, id + "/")
	}
	const indexPath = path.join(FIXTURE_DIR, "_index.json")
	if (fs.existsSync(indexPath)) hashes["_index.json"] = sha1File(indexPath)
	return hashes
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.error(`Source: ${sourceTasks}`)
console.error(`Target: ${FIXTURE_DIR}`)

fs.mkdirSync(FIXTURE_DIR, { recursive: true })

// Pre-load index into memory (read once)
getIndexRaw()

const indexExtracts: string[] = []

for (const taskId of taskIds) {
	globalReplacements.clear()
	const srcDir = path.join(sourceTasks, taskId)
	const dstDir = path.join(FIXTURE_DIR, taskId)

	console.error(`\n=== ${taskId} ===`)
	fs.mkdirSync(dstDir, { recursive: true })

	if (!fs.existsSync(srcDir)) {
		console.error("  (empty dir — no source files)")
		continue
	}

	// Phase 1: extract index, scramble task, register global replacements
	const rawExtract = extractIndexEntry(taskId)
	let indexParsed: Record<string, unknown> | null = null
	if (rawExtract) {
		indexParsed = JSON.parse(rawExtract) as Record<string, unknown>
		phase1ScrambleIndex(indexParsed)
	}

	// Copy all files from source (files first, then directories)
	const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true })
	let copiedCount = 0
	for (const entry of srcEntries) {
		const srcPath = path.join(srcDir, entry.name)
		const dstPath = path.join(dstDir, entry.name)
		if (entry.isFile()) {
			fs.copyFileSync(srcPath, dstPath)
			console.error(`  copied: ${entry.name}  [${fileSizeStr(srcPath)}]`)
			copiedCount++
		} else if (entry.isDirectory()) {
			fs.cpSync(srcPath, dstPath, { recursive: true })
			// Count files inside
			const countFiles = (d: string): number => {
				let n = 0
				for (const e of fs.readdirSync(d, { withFileTypes: true })) {
					if (e.isFile()) n++
					else if (e.isDirectory()) n += countFiles(path.join(d, e.name))
				}
				return n
			}
			const n = countFiles(dstPath)
			console.error(`  copied dir: ${entry.name}/ (${n} files)`)
			copiedCount++
		}
	}

	if (copiedCount === 0) continue

	// Phase 2: scramble all files
	if (globalReplacements.size > 0) {
		console.error(`  index→ACH sync: ${globalReplacements.size} replacement(s) registered`)
	}
	process.stdout.write("  scrambling:")
	scrambleDir(dstDir)
	console.log(" done")

	// Write scrambled index extract
	if (indexParsed) {
		const scrambledIndex = scrambleValue(indexParsed, "__root__")
		const extractPath = path.join(dstDir, "._index.extract.json")
		fs.writeFileSync(extractPath, JSON.stringify(scrambledIndex), "utf8")
		console.error(`  stored: ._index.extract.json  [${fileSizeStr(extractPath)}]`)
		indexExtracts.push(JSON.stringify(scrambledIndex))
	} else {
		console.error("  (not found in source _index.json)")
	}
}

// Build _index.json
console.error("\n=== Building _index.json ===")
const versionMatch = getIndexRaw().match(/"version"\s*:\s*(\d+)/)
const version = versionMatch ? Number(versionMatch[1]) : 1

const indexPath = path.join(FIXTURE_DIR, "_index.json")
const indexContent = JSON.stringify({
	version,
	updatedAt: Date.now(),
	entries: indexExtracts.map((s) => JSON.parse(s) as unknown),
})
fs.writeFileSync(indexPath, indexContent, "utf8")
console.error(`  wrote ${indexExtracts.length} entries  [${fileSizeStr(indexPath)}]`)

// Compute SHA1 hashes
console.error("\n=== Computing SHA1 hashes ===")
const hashes = computeHashes(taskIds)
fs.writeFileSync(HASHES_FILE, JSON.stringify(hashes, null, 2), "utf8")
console.error(`  wrote ${Object.keys(hashes).length} entries → ${HASHES_FILE}`)

console.error("\nDone.")
