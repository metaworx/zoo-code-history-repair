import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function readJson(p: string): Record<string, unknown> {
	return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
}

describe("dependency parity (N3)", () => {
	it("package.json declares a zod version", () => {
		const pkg = readJson(path.join(projectRoot, "package.json"))
		const deps = (pkg.dependencies ?? {}) as Record<string, unknown>
		expect(deps.zod, "package.json must declare zod in dependencies").toBeTypeOf("string")
		expect((deps.zod as string).trim(), "declared zod version must not be empty").not.toBe("")
	})

	it("declared zod version matches @roo-code/types (no drift)", () => {
		const pkg = readJson(path.join(projectRoot, "package.json"))
		const declared = ((pkg.dependencies ?? {}) as Record<string, unknown>).zod as string

		const typesPkgPath = path.join(projectRoot, "node_modules/@roo-code/types/package.json")
		const typesPkg = readJson(typesPkgPath)
		const typesZod = ((typesPkg.dependencies ?? {}) as Record<string, unknown>).zod as string | undefined
		expect(typesZod, "@roo-code/types must declare a zod dependency").toBeTypeOf("string")

		// Resolve the installed zod package as seen from @roo-code/types
		// (hoisted or nested — whichever @roo-code/types actually resolves to).
		const requireFromTypes = createRequire(typesPkgPath)
		const zodPkgPath = requireFromTypes.resolve("zod/package.json")
		const installedZod = readJson(zodPkgPath).version as string
		expect(installedZod, "installed zod package must expose a version").toBeTypeOf("string")

		// If @roo-code/types pins an exact version, the project must match verbatim.
		if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(typesZod as string)) {
			expect(
				declared,
				`drift: package.json declares zod ${declared} but @roo-code/types declares ${typesZod}`,
			).toBe(typesZod)
		}

		// Regardless of range vs pin, the declared version must equal the installed one.
		expect(
			declared,
			`drift: package.json declares zod ${declared} but the installed transitive version is ${installedZod}`,
		).toBe(installedZod)
	})
})
