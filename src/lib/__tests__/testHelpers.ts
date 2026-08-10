/**
 * Shared test utilities for zoo-code-history-repair tests.
 *
 * Extracts common patterns for temp directory lifecycle, fixture copying,
 * and JSON read/write helpers used across unit and integration tests.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {expect} from 'vitest';

/** Absolute path to the fixture tasks directory. */
export const FIXTURE_DIR = path.resolve("tests/fixtures/tasks");

export const HASHES_FILE = path.resolve("tests/fixtures/hashes.json");
export const FIXTURE_SCAN_BEFORE_FILE = path.resolve("tests/fixtures/scan.before.json");
export const FIXTURE_SCAN_AFTER_FILE = path.resolve("tests/fixtures/scan.after.json");
export const FIXTURE_LIST_BEFORE_FILE = path.resolve("tests/fixtures/list-corrupt.before.json");
export const FIXTURE_LIST_AFTER_FILE = path.resolve("tests/fixtures/list-corrupt.after.json");

/** Create a temp directory with an optional tasks/ subdirectory. */
export function createTempDir(prefix: string): {
    root: string;
    tasksDir: string;
    cleanup: () => void;
} {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const tasksDir = path.join(root, "tasks");
    fs.mkdirSync(tasksDir);
    return {
        root,
        tasksDir,
        cleanup: () => fs.rmSync(root, {recursive: true, force: true}),
    };

}

/** Recursively copy fixture tasks into a target directory. */
export function copyFixtureTasks(destDir: string): void {
    fs.cpSync(FIXTURE_DIR, destDir, {recursive: true});

}

/** Write a JSON-serializable value to a file path (compact JSON). */
export function writeJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data), "utf8");

}

/** Read and parse a JSON file. Returns null if missing or invalid. */
export function readJson(filePath: string): unknown {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }

}

/** Create a single task subdirectory under tasksDir. Returns full path. */
export function makeTaskDir(tasksDir: string, id: string): string {
    const d = path.join(tasksDir, id);
    fs.mkdirSync(d);
    return d;

}

export function listBackupFiles(dir: string): string[] {
    return fs.readdirSync(dir).filter(f => f.endsWith(".bak.json"));

}

/** Recursively list all .bak.json files under a directory tree. */
export function listAllBackupFiles(dir: string): string[] {
    const result: string[] = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
            result.push(...listAllBackupFiles(p));
        } else if (entry.isFile() && entry.name.endsWith(".bak.json")) {
            result.push(p);
        }
    }
    return result;
}

export function sha1(filePath: string): string {
    return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");

}

export function touch(filePath: string, content: string) {
    fs.writeFileSync(filePath, content, "utf8");
}

export function read(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
}

export interface AssertJsonOptions {
    /** Array of property keys to exclude from the deep comparison at any nesting depth. */
    ignoreProps?: string[];
    /**
     * A map of text/regex patterns to their substitution strings.
     * Applied recursively to all string values before equality checking.
     */
    replacements?: Record<string | RegExp, string>;
    /** Truncate all string values to this length before comparison (matches CLI truncate output). */
    maxLength?: number;
}

/**
 * Pure helper utility to sanitize, sort, and execute regex replacements on JSON objects.
 */
export function normalizeJson(data: any, options: AssertJsonOptions = {}): any {
    const {ignoreProps = [], replacements = {}, maxLength} = options;

    const replacementEntries = Object.entries(replacements).map(([pattern, repl]) => {
        // If the key is already a string representation of a regex from Object.entries,
        // or a string literal, we safely turn it into a global regex.
        const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
        return {regex, repl};
    });

    function process(node: any): any {
        if (typeof node === 'string') {
            let currentStr = node;
            for (const {regex, repl} of replacementEntries) {
                currentStr = currentStr.replace(regex, repl);
            }
            if (maxLength !== undefined && currentStr.length > maxLength) {
                currentStr = currentStr.slice(0, maxLength);
            }
            return currentStr;
        }

        if (node === null || typeof node !== 'object') {
            return node;
        }

        if (Array.isArray(node)) {
            return node.map(process);
        }

        const cleaned: Record<string, any> = {};
        const sortedKeys = Object.keys(node).sort();

        for (const key of sortedKeys) {
            if (ignoreProps.includes(key)) {
                continue;
            }
            cleaned[key] = process(node[key]);
        }

        return cleaned;
    }

    return process(data);
}

/**
 * Standalone assertion function
 */
export function assertJsonEqual(obj1: any, obj2: any, options: AssertJsonOptions = {}): void {
    expect(normalizeJson(obj1, options)).toEqual(normalizeJson(obj2, options));
}

/**
 * Custom Vitest matcher type extensions
 */
export interface CustomMatchers<R = unknown> {
    toDeepEqualJson(expected: any, options?: AssertJsonOptions, message?: string): R;
}

declare module 'vitest' {
    interface Assertion<T = any> extends CustomMatchers<T> {
    }

    interface AsymmetricMatchersContaining extends CustomMatchers {
    }
}

/**
 * Vitest Matcher registration
 */
expect.extend({
    toDeepEqualJson(received: any, expected: any, options: AssertJsonOptions = {}, message?: string) {
        const processedReceived = normalizeJson(received, options);
        const processedExpected = normalizeJson(expected, options);

        const pass = this.equals(processedReceived, processedExpected);

        return {
            pass,
            message: () => {
                const customPrefix = message ? `${message}\n` : '';
                return pass
                    ? `${customPrefix}Expected payloads not to match recursively, but they were identical.`
                    : `${customPrefix}${this.utils.diff(processedExpected, processedReceived)}`;
            },
        };
    },
});

/**
 * Safely escapes special regex characters in a string path.
 * Also normalizes slashes so it matches both Windows (\) and Unix (/) variations.
 */
export function quotePathRegex(basePath: string): string {
    // 1. Escape all standard regex special characters: \ ^ $ * + ? . ( ) | { } [ ]
    let escaped = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 2. Make separators flexible: replace any escaped '\' or '/' with a matcher for either slash
    // This allows a Windows path variable to match a Unix format in your JSON and vice-versa
    return escaped.replace(/\\\\|\//g, '[\\\\/]');
}
