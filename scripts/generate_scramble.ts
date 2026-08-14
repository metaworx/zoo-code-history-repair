#!/usr/bin/env npx tsx
/**
 * @file scripts/generate_scramble.ts
 *
 * Generates scrambled task fixtures.
 */

/**
 * generate_scramble.ts – never-repeating mix of Pride & Prejudice + public code
 * Target size: 523 KiB (535_552 bytes)
 * Max chunk size: 1664
 *
 * Run: npx tsx generate_scramble.ts
 *  or: npm i -D typescript tsx @types/node && npx tsx generate_scramble.ts
 */

import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const TARGET_BYTES = 523 * 1024 // 535_552
const OUT_FILE = resolve("tests/fixtures/scramble_mixed.txt")

// const BOOK_URL = "https://www.gutenberg.org/files/1342/1342-0.txt"; // Pride and Prejudice
const BOOK_URL = "https://www.gutenberg.org/files/2600/2600-0.txt" // War and Peace

// Large public code file (TypeScript compiler)
const CODE_URL = "https://raw.githubusercontent.com/microsoft/TypeScript/main/src/compiler/checker.ts"

const CHUNK_MIN = 40
const CHUNK_MAX = 1664

/** Simple seeded PRNG (mulberry32) so runs can be reproducible */
function mulberry32(seed: number): () => number {
	return () => {
		let t = (seed += 0x6d2b79f5)
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const random = mulberry32(0xc0ffee)

function randInt(min: number, max: number): number {
	return min + Math.floor(random() * (max - min + 1))
}

async function fetchText(url: string): Promise<string> {
	console.log(`Fetching ${url} …`)
	const res = await fetch(url, {
		headers: { "User-Agent": "scramble-gen/1.0" },
	})
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} for ${url}`)
	}
	const buf = Buffer.from(await res.arrayBuffer())
	// best-effort decode
	try {
		return buf.toString("utf8")
	} catch {
		return buf.toString("latin1")
	}
}

function cleanBook(text: string): string {
	let t = text
	const start = t.indexOf("*** START OF")
	const end = t.indexOf("*** END OF")
	if (start !== -1) {
		t = t.slice(start)
		const nl = t.indexOf("\n")
		if (nl !== -1) t = t.slice(nl + 1)
	}
	if (end !== -1) {
		t = t.slice(0, end)
	}
	t = t.replace(/\r\n?/g, "\n")
	t = t.replace(/[ \t]+\n/g, "\n")
	t = t.replace(/\n{3,}/g, "\n\n")
	return t.trim()
}

function chunkText(text: string, minLen: number, maxLen: number): string[] {
	const chunks: string[] = []
	let i = 0
	const n = text.length
	while (i < n) {
		const length = randInt(minLen, maxLen)
		let end = Math.min(i + length, n)
		if (end < n) {
			const searchFrom = i + Math.floor(minLen / 2)
			const searchTo = Math.min(end + 20, n)
			const slice = text.slice(searchFrom, searchTo)
			const spaceRel = slice.lastIndexOf(" ")
			if (spaceRel !== -1) {
				end = searchFrom + spaceRel + 1
			}
		}
		const piece = text.slice(i, end).trim()
		if (piece) chunks.push(piece)
		i = end
	}
	return chunks
}

function shuffle<T>(arr: T[]): void {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1))
		;[arr[i], arr[j]] = [arr[j], arr[i]]
	}
}

function sha1(s: string): string {
	return createHash("sha1").update(s, "utf8").digest("hex")
}

async function main(): Promise<void> {
	const bookRaw = await fetchText(BOOK_URL)
	const codeRaw = await fetchText(CODE_URL)

	const book = cleanBook(bookRaw)
	const code = codeRaw

	console.log(`Book chars : ${book.length.toLocaleString()}`)
	console.log(`Code chars : ${code.length.toLocaleString()}`)

	const bookChunks = chunkText(book, CHUNK_MIN, CHUNK_MAX).map((c) => c + "\n")
	const codeChunks = chunkText(code, CHUNK_MIN, CHUNK_MAX).map((c) => c + "\n")

	const pool = [...bookChunks, ...codeChunks]
	shuffle(pool)

	console.log(`Chunks     : ${pool.length.toLocaleString()} (book=${bookChunks.length}, code=${codeChunks.length})`)

	const out: Buffer[] = []
	let total = 0
	let idx = 0
	const n = pool.length
	const seen = new Set<string>()

	while (total < TARGET_BYTES) {
		let chunk = pool[idx % n]!
		const passNo = Math.floor(idx / n)

		if (passNo > 0) {
			const salt = `/*p${passNo}*/ `
			const trimmed = chunk.trimStart()
			if (/^(function|const|class|if|for|export|import|type|interface)\b/.test(trimmed)) {
				chunk = salt + chunk
			} else {
				chunk = chunk.replace(/\n$/, "") + ` (${passNo})\n`
			}
		}

		const h = sha1(chunk)
		if (seen.has(h) && passNo === 0) {
			idx++
			continue
		}
		seen.add(h)

		let data = Buffer.from(chunk, "utf8")
		const need = TARGET_BYTES - total
		if (data.length > need) {
			data = data.subarray(0, need)
			out.push(data)
			total += data.length
			break
		}
		out.push(data)
		total += data.length
		idx++
	}

	const result = Buffer.concat(out)
	writeFileSync(OUT_FILE, result)
	console.log(`Wrote      : ${OUT_FILE}  (${result.length.toLocaleString()} bytes)`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
