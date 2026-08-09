import path from "node:path"
import type {HistoryItem} from "../types.js"
import {
    API_HISTORY_NAME,
    HISTORY_ITEM_NAME,
    TASK_METADATA_NAME,
    UI_MESSAGES_NAME,
} from "./paths.js"
import {backupFile, readJsonFile, writeJsonCompact} from "./file.js";
import {readPartialJsonArray} from "./readJson.js"
import {rebuildUiMessages} from "./rebuildUiMessages.js"
import {extractTaskFromApiHistory} from "./rebuildTaskField.js"
import {computeTaskSize} from "./size.js"
import {
    estimateCacheReads,
    estimateTokensIn,
    estimateTokensOut,
    estimateTotalCost,
} from "./estimateTokens.js"

export interface RepairResult {
    taskId: string
    uiRepaired: boolean
    taskRepaired: boolean
    sizeRepaired: boolean
    tokensRepaired: boolean
    tokensRecoverySource?: "index" | "estimate" | "user_override"
    apiTruncated: boolean
    errors: string[]
    touchedFiles: string[]
    backups: string[]
}

/**
 * Fully repair a single task directory:
 *  1. Rebuild ui_messages.json from api_conversation_history.json
 *  2. Rebuild history_item.json task field from ACH
 *  3. Recompute history_item.json size field
 *
 * All writes are compact JSON. Backups are created before overwriting.
 */
export interface RepairTaskOptions {
    dryRun?: boolean
    backup?: boolean
    /** Force ui_messages.json rebuild even when not corrupt. */
    forceUim?: boolean
    /** User-supplied tokensIn override. 0 = disable estimation (keep zeros). */
    fixedInputToken?: number
    /** Index entries for token recovery lookup. */
    indexItems?: Array<{ id: string; tokensIn?: number; tokensOut?: number; totalCost?: number; cacheReads?: number; cacheWrites?: number }>
}

export function repairTaskDir(
    taskDir: string,
    options: RepairTaskOptions = {},
): RepairResult {
    const taskId = path.basename(taskDir)
    const result: RepairResult = {
        taskId,
        uiRepaired: false,
        taskRepaired: false,
        sizeRepaired: false,
        tokensRepaired: false,
        apiTruncated: false,
        errors: [],
        touchedFiles: [],
        backups: [],
    }

    const uiPath = path.join(taskDir, UI_MESSAGES_NAME)
    const hiPath = path.join(taskDir, HISTORY_ITEM_NAME)
    const apiPath = path.join(taskDir, API_HISTORY_NAME)
    const tmPath = path.join(taskDir, TASK_METADATA_NAME)

    // Read existing files — try normal parse first, then partial recovery
    let apiHistory = readJsonFile<unknown[]>(apiPath)
    const historyItem = readJsonFile<HistoryItem>(hiPath)
    const taskMetadata = readJsonFile<unknown>(tmPath)

    if (!apiHistory || !Array.isArray(apiHistory)) {
        const partial = readPartialJsonArray(apiPath)
        if (partial && partial.data.length > 0) {
            apiHistory = partial.data
            if (partial.truncated) {
                result.apiTruncated = true
            }
        }
    }

    if (!apiHistory || !Array.isArray(apiHistory)) {
        result.errors.push("missing or invalid api_conversation_history.json — cannot repair")
        return result
    }

    // --- 1. Rebuild ui_messages.json ---
    const existingUi = readJsonFile<unknown[]>(uiPath)
    const existingIsEmpty = !Array.isArray(existingUi) || existingUi.length === 0
    const shouldRebuildUi = existingIsEmpty || options.forceUim

    if (shouldRebuildUi) {
        const newUi = rebuildUiMessages(apiHistory as Parameters<typeof rebuildUiMessages>[0])
        if (newUi.length > 0) {
            if (!options.dryRun) {
                if (options.backup !== false) {
                    const bak = backupFile(uiPath)
                    if (bak) result.backups.push(bak)
                }
                writeJsonCompact(uiPath, newUi)
            }
            result.uiRepaired = true
            result.touchedFiles.push(UI_MESSAGES_NAME)
        } else {
            result.errors.push("ui_messages reconstruction produced 0 events")
        }
    }

    // --- 2. Repair history_item.json task field ---
    if (historyItem) {
        let modified = false

        const taskText = historyItem.task?.trim()
        const isMissing = !taskText
        const isPlaceholder = /^Task\s*#\s*\d+(\s*\(.*\))?$/i.test(taskText ?? "")

        if (isMissing || isPlaceholder) {
            const extracted = extractTaskFromApiHistory(apiHistory)
            if (extracted) {
                historyItem.task = extracted
                result.taskRepaired = true
                modified = true
            } else {
                result.errors.push("could not extract task from api_conversation_history")
            }
        }

        // --- 3. Recompute size ---
        const uiMessages = readJsonFile<unknown[]>(uiPath)
        const expectedSize = computeTaskSize(
            uiMessages ?? [],
            apiHistory,
            historyItem,
            taskMetadata ?? {},
        )

        if (historyItem.size !== expectedSize) {
            historyItem.size = expectedSize
            result.sizeRepaired = true
            modified = true
        }

        // --- 4. Repair token fields ---
        if (
            historyItem.tokensIn === 0 &&
            historyItem.tokensOut === 0 &&
            historyItem.totalCost === 0
        ) {
            // a. Try index recovery first
            const idxEntry = options.indexItems?.find(e => e.id === taskId)
            if (idxEntry && idxEntry.tokensIn && idxEntry.tokensIn > 0) {
                historyItem.tokensIn = idxEntry.tokensIn
                historyItem.tokensOut = idxEntry.tokensOut ?? 0
                historyItem.totalCost = idxEntry.totalCost ?? 0
                if (idxEntry.cacheReads != null) historyItem.cacheReads = idxEntry.cacheReads
                if (idxEntry.cacheWrites != null) historyItem.cacheWrites = idxEntry.cacheWrites
                result.tokensRepaired = true
                result.tokensRecoverySource = "index"
                modified = true
            } else if (options.fixedInputToken !== undefined) {
                // b. User override (0 = disable, keep zeros)
                if (options.fixedInputToken > 0) {
                    historyItem.tokensIn = options.fixedInputToken
                    historyItem.tokensOut = estimateTokensOut(apiHistory as Parameters<typeof estimateTokensOut>[0])
                    historyItem.totalCost = estimateTotalCost(
                        historyItem.tokensIn,
                        historyItem.tokensOut,
                        historyItem.apiConfigName as string | undefined,
                    )
                    result.tokensRepaired = true
                    result.tokensRecoverySource = "user_override"
                    modified = true
                }
                // fixedInputToken === 0: explicitly skip estimation, keep zeros
            } else {
                // c. Default: estimate from ACH
                const estOut = estimateTokensOut(apiHistory as Parameters<typeof estimateTokensOut>[0])
                const estIn = estimateTokensIn(apiHistory as Parameters<typeof estimateTokensIn>[0])
                if (estOut > 0 || estIn > 0) {
                    historyItem.tokensOut = estOut
                    historyItem.tokensIn = estIn
                    historyItem.totalCost = estimateTotalCost(
                        estIn,
                        estOut,
                        historyItem.apiConfigName as string | undefined,
                    )
                    result.tokensRepaired = true
                    result.tokensRecoverySource = "estimate"
                    modified = true
                }
            }

            // Estimate cacheReads if still zero/missing after repair
            if (result.tokensRepaired && historyItem.tokensIn > 0) {
                const provider = historyItem.apiConfigName as string | undefined
                if (!historyItem.cacheReads || historyItem.cacheReads === 0) {
                    historyItem.cacheReads = estimateCacheReads(historyItem.tokensIn, provider)
                }
                if (historyItem.cacheWrites === undefined || historyItem.cacheWrites === null) {
                    historyItem.cacheWrites = 0
                }
            }
        }

        if (modified && !options.dryRun) {
            if (options.backup !== false) {
                const bak = backupFile(hiPath)
                if (bak) result.backups.push(bak)
            }
            writeJsonCompact(hiPath, historyItem)
        }
        if (modified && !result.touchedFiles.includes(HISTORY_ITEM_NAME)) {
            result.touchedFiles.push(HISTORY_ITEM_NAME)
        }
    } else {
        result.errors.push("missing history_item.json — cannot repair task or size")
    }

    return result
}
