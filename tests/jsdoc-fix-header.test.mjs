#!/usr/bin/env node
/**
 * @file jsdoc-fix-header integration tests
 */

import assert from "node:assert/strict"
import cp from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const scriptPath = path.join(__dirname, "jsdoc-fix-header.mjs")

function makeSandbox() {
	const token = Math.random().toString(36).slice(2, 8)

	const root = path.join(__dirname, `.sandbox.${Date.now()}-${token}`)

	fs.mkdirSync(root, { recursive: true })

	const nodeModulesSrc = path.resolve(__dirname, "..", "node_modules")

	const nodeModulesDst = path.join(root, "node_modules")

	fs.symlinkSync(nodeModulesSrc, nodeModulesDst, "junction")

	const cleanup = () => {
		if (fs.existsSync(root)) {
			fs.rmSync(root, {
				recursive: true,
				force: true,
			})
		}
	}

	process.on("exit", cleanup)

	return {
		root,
		writeTest: (relPath, content) => {
			const abs = path.join(root, relPath)

			fs.mkdirSync(path.dirname(abs), { recursive: true })
			fs.writeFileSync(abs, content, "utf8")
		},
		cleanup,
	}
}

function stripAnsi(str) {
	return str.replace(new RegExp("\x1b[0-9;]*m", "g"), "")
}

function runNode(args, options = {}) {
	const res = cp.spawnSync(process.execPath, args, {
		...options,
		encoding: "utf8",
	})

	res.combined = (res.stdout || "") + (res.stderr || "")
	res.combinedAnsi = stripAnsi(res.combined)

	return res
}

function testHeader(content, expectedRelPath) {
	const expectedHeader = "/**\n * @file " + expectedRelPath + "\n */\n"

	assert(content.startsWith(expectedHeader), "header added correctly")
}

function checkSummary(res, expected) {
	const ansi = res.combinedAnsi

	assert(ansi.includes(`Files scanned:      ${expected.scanned}`))
	assert(ansi.includes(`Headers added:      ${expected.added}`))
	assert(ansi.includes(`Headers moved:      ${expected.moved}`))
	assert(ansi.includes(`Changed total:      ${expected.changed}`))
	assert(ansi.includes(`Still missing:      ${expected.stillMissing}`))
	assert(ansi.includes(`Still misplaced:    ${expected.stillMisplaced}`))
	assert(ansi.includes(`Total erroneous:    ${expected.erroneous}`))
}

const noHeader = `// no jsdoc header

console.log( 1 );
`

const shebangMisplaced = `#!/usr/bin/env node

console.log( 1 );

/**
 * @file wrong position
 */
`

const noHeaderShebang = `#!/usr/bin/env node

console.log( 1 );

`

const misplacedNoShebang = `import fs from 'node:fs';

 

/**
 * @file test-no-shebang.mjs
 */

 

import path from 'node:path';

 

console.log( 1 );

`

test("help", () => {
	const sb = makeSandbox()

	const res = runNode([scriptPath, "--help"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.combined.includes("v1.1.2"))
	assert(res.stdout.includes("Usage: "))
	assert(res.stdout.includes("--fix-test"))
	assert(res.stdout.includes("**/*.test.{ts,tsx,mjs,cjs}"))
	// Enhanced option checks
	assert(res.stdout.includes("--fix-missing"))
	assert(res.stdout.includes("-M"))
	assert(res.stdout.includes("--fix-position"))
	assert(res.stdout.includes("-p"))
	assert(res.stdout.includes("--fix"))
	assert(res.stdout.includes("-f"))
	assert(res.stdout.includes("--fix-all"))
	assert(res.stdout.includes("-F"))
	assert(res.stdout.includes("--report"))
	assert(res.stdout.includes("-r"))
	assert(res.stdout.includes("--quiet"))

	sb.cleanup()
})

test("scanDefault", (t) => {
	const sb = makeSandbox()

	sb.writeTest("app.mjs", noHeader)
	sb.writeTest("test.test.mjs", noHeader)

	const res = runNode([scriptPath], { cwd: sb.root })

	assert.strictEqual(res.status, 2)
	assert(res.stdout.includes("err: m - app.mjs"))
	assert(res.stdout.includes("err: m - test.test.mjs"))
	assert(res.combinedAnsi.includes("Still missing:      2"))
	checkSummary(res, {
		scanned: 2,
		added: 0,
		moved: 0,
		changed: 0,
		stillMissing: 2,
		stillMisplaced: 0,
		erroneous: 2,
	})

	sb.cleanup()
})

test("fixPosition", (t) => {
	const sb = makeSandbox()

	sb.writeTest("app.mjs", shebangMisplaced)

	const res = runNode([scriptPath, "--fix-position"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.stdout.includes("fix: p s app.mjs"))
	assert(res.combinedAnsi.includes("Headers moved:      1"))

	const content = fs.readFileSync(path.join(sb.root, "app.mjs"), "utf8")

	assert(
		content.startsWith("#!/usr/bin/env node\n/**\n * @file wrong position\n */\n\n"),
		"header moved after shebang",
	)
	checkSummary(res, {
		scanned: 1,
		added: 0,
		moved: 1,
		changed: 1,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})

test("fixMissingAll", (t) => {
	const sb = makeSandbox()

	sb.writeTest("app.mjs", noHeader)
	sb.writeTest("test.test.mjs", noHeader)

	const res = runNode([scriptPath, "--fix-missing"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.stdout.includes("fix: m - app.mjs"))
	assert(res.stdout.includes("fix: m - test.test.mjs"))
	assert(res.combinedAnsi.includes("Headers added:      2"))

	const appContent = fs.readFileSync(path.join(sb.root, "app.mjs"), "utf8")

	testHeader(appContent, "app.mjs")

	const testContent = fs.readFileSync(path.join(sb.root, "test.test.mjs"), "utf8")

	testHeader(testContent, "test.test.mjs")
	checkSummary(res, {
		scanned: 2,
		added: 2,
		moved: 0,
		changed: 2,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})

test("fixPositionDefaultT", (t) => {
	const sb = makeSandbox()

	sb.writeTest("app.mjs", noHeader)
	sb.writeTest("test.test.mjs", noHeader)

	const res = runNode([scriptPath, "--fix-position", "-T"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.stdout.includes("fix: m - test.test.mjs"))
	assert(!res.stdout.includes("fix: m - app.mjs"))
	assert(res.combinedAnsi.includes("Headers added:      1"))

	const testContent = fs.readFileSync(path.join(sb.root, "test.test.mjs"), "utf8")

	testHeader(testContent, "test.test.mjs")

	const appExpectedHeader = "/**\n * @file app.mjs\n */\n"

	const appContent = fs.readFileSync(path.join(sb.root, "app.mjs"), "utf8")

	assert(!appContent.startsWith(appExpectedHeader), "no header added to app (no match)")
	checkSummary(res, {
		scanned: 2,
		added: 1,
		moved: 0,
		changed: 1,
		stillMissing: 1,
		stillMisplaced: 0,
		erroneous: 1,
	})

	sb.cleanup()
})

test("fixPositionCustomT", (t) => {
	const sb = makeSandbox()

	sb.writeTest("app.mjs", noHeader)
	sb.writeTest("test.test.mjs", noHeader)

	const res = runNode([scriptPath, "--fix-position", "-T", "**/app.mjs"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.stdout.includes("fix: m - app.mjs"))
	assert(!res.stdout.includes("fix: m - test.test.mjs"))
	assert(res.combinedAnsi.includes("Headers added:      1"))

	const appContent = fs.readFileSync(path.join(sb.root, "app.mjs"), "utf8")

	testHeader(appContent, "app.mjs")

	const testExpectedHeader = "/**\n * @file test.test.mjs\n */\n"

	const testContent = fs.readFileSync(path.join(sb.root, "test.test.mjs"), "utf8")

	assert(!testContent.startsWith(testExpectedHeader), "no header added to test (no match)")
	checkSummary(res, {
		scanned: 2,
		added: 1,
		moved: 0,
		changed: 1,
		stillMissing: 1,
		stillMisplaced: 0,
		erroneous: 1,
	})

	sb.cleanup()
})

test("fixDefault", (t) => {
	const sb = makeSandbox()

	sb.writeTest("test.test.mjs", noHeader)
	sb.writeTest("app.mjs", shebangMisplaced)

	const res = runNode([scriptPath, "--fix"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.combined.includes("Test:   **/*.spec.{ts,tsx,mjs,cjs}, **/*.test.{ts,tsx,mjs,cjs}"))
	assert(res.stdout.includes("fix: m - test.test.mjs"))
	assert(res.stdout.includes("fix: p s app.mjs"))

	const testContent = fs.readFileSync(path.join(sb.root, "test.test.mjs"), "utf8")

	testHeader(testContent, "test.test.mjs")

	const appContent = fs.readFileSync(path.join(sb.root, "app.mjs"), "utf8")

	assert(appContent.startsWith("#!/usr/bin/env node\n/**\n * @file wrong position\n */\n\n"), "header moved")
	checkSummary(res, {
		scanned: 2,
		added: 1,
		moved: 1,
		changed: 2,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})

test("quiet", (t) => {
	const sb = makeSandbox()

	sb.writeTest("test.test.mjs", noHeader)

	const res = runNode([scriptPath, "--fix", "--quiet"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(!res.stdout.includes("fix:"))
	assert(res.combined.includes("QUIET (no per-file fix messages)"))
	checkSummary(res, {
		scanned: 1,
		added: 1,
		moved: 0,
		changed: 1,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})

test("noFiles", () => {
	const sb = makeSandbox()

	const res = runNode([scriptPath, "*.noexist"], { cwd: sb.root })

	assert.strictEqual(res.status, 99)
	assert(res.combined.includes("no files matched"))

	sb.cleanup()
})

test("customGlobSingle", (t) => {
	const sb = makeSandbox()

	sb.writeTest("sub/app.mjs", noHeader)

	const res = runNode([scriptPath, "sub/*.mjs", "--fix-missing"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.stdout.includes("fix: m - sub/app.mjs"))
	assert(res.combinedAnsi.includes("Headers added:      1"))

	const content = fs.readFileSync(path.join(sb.root, "sub/app.mjs"), "utf8")

	testHeader(content, "sub/app.mjs")
	checkSummary(res, {
		scanned: 1,
		added: 1,
		moved: 0,
		changed: 1,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})

test("multiGlobsPositional", (t) => {
	const sb = makeSandbox()

	sb.writeTest("sub/app.mjs", noHeader)
	sb.writeTest("test.test.mjs", noHeader)

	const res = runNode([scriptPath, "sub/*.mjs", "*.test.mjs", "--fix-missing"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.combinedAnsi.includes("Headers added:      2"))
	checkSummary(res, {
		scanned: 2,
		added: 2,
		moved: 0,
		changed: 2,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})

test("optionsFirstMultiGlobs", (t) => {
	const sb = makeSandbox()

	sb.writeTest("sub/app.mjs", noHeader)
	sb.writeTest("test.test.mjs", noHeader)

	const res = runNode([scriptPath, "--fix-missing", "sub/*.mjs", "*.test.mjs"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.combinedAnsi.includes("Headers added:      2"))
	checkSummary(res, {
		scanned: 2,
		added: 2,
		moved: 0,
		changed: 2,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})

test("misplacedNoShebang", (t) => {
	const sb = makeSandbox()

	sb.writeTest("test-no-shebang.mjs", misplacedNoShebang)

	const res = runNode([scriptPath, "--fix-position"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.stdout.includes("fix: p - test-no-shebang.mjs"))

	const content = fs.readFileSync(path.join(sb.root, "test-no-shebang.mjs"), "utf8")

	const expectedHeader = "/**\n * @file test-no-shebang.mjs\n */\n"

	assert(content.startsWith(expectedHeader), "header moved to top")
	checkSummary(res, {
		scanned: 1,
		added: 0,
		moved: 1,
		changed: 1,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})

test("noHeaderShebang", (t) => {
	const sb = makeSandbox()

	sb.writeTest("test-shebang.mjs", noHeaderShebang)

	const res = runNode([scriptPath, "--fix-missing"], { cwd: sb.root })

	assert.strictEqual(res.status, 0)
	assert(res.stdout.includes("fix: m s test-shebang.mjs"))

	const content = fs.readFileSync(path.join(sb.root, "test-shebang.mjs"), "utf8")

	const expected = "#!/usr/bin/env node\n/**\n * @file test-shebang.mjs\n */\n\nconsole.log( 1 );\n"

	assert(content.startsWith(expected), "header added after shebang")
	checkSummary(res, {
		scanned: 1,
		added: 1,
		moved: 0,
		changed: 1,
		stillMissing: 0,
		stillMisplaced: 0,
		erroneous: 0,
	})

	sb.cleanup()
})
