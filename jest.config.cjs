/** @type {import('jest').Config} */
module.exports = {
    preset: "ts-jest/presets/default-esm",
    testEnvironment: "node",
    roots: ["<rootDir>/src"],
    testMatch: ["**/__tests__/**/*.test.ts"],
    extensionsToTreatAsEsm: [".ts"],
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                useESM: true,
                tsconfig: "tsconfig.json",
            },
        ],
    },
    collectCoverageFrom: [
        "src/lib/**/*.ts",
        "!src/**/*.d.ts",
        "!src/cli.ts",
    ],
    coverageDirectory: "coverage",
    clearMocks: true,
}
