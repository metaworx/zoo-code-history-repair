/**
 * @file vitest.config.ts
 *
 * Vitest configuration (node environment, globals, coverage).
 */

import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.spec.ts"],
		coverage: {
			provider: "v8",
			include: ["src/lib/**/*.ts"],
			exclude: ["src/**/*.d.ts", "src/cli.ts"],
			reporter: ["text", "lcov"],
			reportsDirectory: "coverage",
		},
		clearMocks: true,
	},
})
