import path from "node:path"
import type {HistoryItem} from "../types.js"
import {API_HISTORY_NAME, HISTORY_ITEM_NAME, TASK_METADATA_NAME, UI_MESSAGES_NAME,} from "./paths.js"
import {JsonFileTransaction} from "./file.js";
import {inspectTaskDir, isPlaceholderTaskName} from "./validation.js";
import {readPartialJsonArray} from "./io/readJson.js"
import {rebuildUiMessages} from "./rebuildUiMessages.js"
import {extractTaskFromApiHistory} from "./rebuildTaskField.js"
import {computeTaskSize} from "./size.js"
import {estimateCacheReads, estimateTokensIn, estimateTokensOut, estimateTotalCost,} from "./estimateTokens.js"

export interface RepairResult {
    taskId: string
    uiRepaired: boolean
    taskRepaired: boolean
    sizeRepaired: boolean
    tokensRepaired: boolean
    tokensRecoverySource?: "index" | "estimate" | "user_override"
    apiTruncated: boolean
    unrepairable: boolean
    errors: string[]
    touchedFiles: string[]
    backups: string[]
    /** User-facing hint (e.g. delete suggestion for unrepairable tasks). */
    hint?: string
}

/** Format repair result as human-readable parts array (e.g. ["ui(ach→uim)", "task(ach→hi)"]). */
export function formatRepairParts(r: RepairResult): string[] {
    const parts: string[] = []
    if (r.uiRepaired) parts.push("ui(ach→uim)")
    if (r.taskRepaired) parts.push("task(ach→hi)")
    if (r.sizeRepaired) parts.push("size(calc→hi)")
    if (r.tokensRepaired) {
        const src = r.tokensRecoverySource ?? "?"
        parts.push(`tokens(${src}→hi)`)
    }
    return parts
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
    indexItems?: Array<{
        id: string;
        tokensIn?: number;
        tokensOut?: number;
        totalCost?: number;
        cacheReads?: number;
        cacheWrites?: number
    }>
}

export async function repairTaskDir(
    taskDir: string,
    options: RepairTaskOptions = {},
): Promise<RepairResult> {
    const taskId = path.basename(taskDir)
    const result: RepairResult = {
        taskId,
        uiRepaired: false,
        taskRepaired: false,
        sizeRepaired: false,
        tokensRepaired: false,
        apiTruncated: false,
        unrepairable: false,
        errors: [],
        touchedFiles: [],
        backups: [],
    }

    const uiPath = path.join(taskDir, UI_MESSAGES_NAME)
    const hiPath = path.join(taskDir, HISTORY_ITEM_NAME)
    const apiPath = path.join(taskDir, API_HISTORY_NAME)
    const tmPath = path.join(taskDir, TASK_METADATA_NAME)

    // Read existing files via JsonFileTransaction — tolerant reads for repair
    const apiTx = new JsonFileTransaction(apiPath, false, [])
    const hiTx = new JsonFileTransaction(hiPath, false, [])
    const tmTx = new JsonFileTransaction(tmPath, false, [])

    await apiTx.load(false)
    let apiHistory = apiTx.getData() as unknown[] | null
    await hiTx.load(false)
    const historyItem = hiTx.getData() as HistoryItem | null
    await tmTx.load(false)
    const taskMetadata = tmTx.getData()

    if (!apiHistory || !Array.isArray(apiHistory)) {
        const partial = await readPartialJsonArray(apiPath)
        if (partial && partial.data.length > 0) {
            apiHistory = partial.data
            if (partial.truncated) {
                result.apiTruncated = true
            }
        }
    }

    if (!apiHistory || !Array.isArray(apiHistory)) {
        result.unrepairable = true
        result.errors.push("missing or invalid api_conversation_history.json — cannot repair")
        result.hint = `This task cannot be repaired. Remove it with: zoo-code-history-repair delete ${taskId} --force`
        return result
    }

    // R-2: Pre-repair detection — drive repair from detected corruption reasons
    const corruption = await inspectTaskDir(taskId, taskDir, null, {})
    const reasonSet = new Set(corruption.reasons.map(r => r.reason))

    // --- 1. Rebuild ui_messages.json ---
    const uiTx = new JsonFileTransaction(uiPath, false, [])
    await uiTx.load(false)
    const existingUi = uiTx.getData() as unknown[] | null
    const existingIsEmpty = !Array.isArray(existingUi) || existingUi.length === 0
    const shouldRebuildUi = existingIsEmpty || options.forceUim || reasonSet.has("empty_ui_messages")

    if (shouldRebuildUi) {
        const newUi = rebuildUiMessages(apiHistory as Parameters<typeof rebuildUiMessages>[0])
        if (newUi.length > 0) {
            if (!options.dryRun) {
                uiTx.setData(newUi)
                const bak = await uiTx.save(true, options.backup !== false)
                if (bak) result.backups.push(bak)
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
        const isPlaceholder = isPlaceholderTaskName(taskText ?? "")

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

        // --- 3. Repair token fields ---
        if (
            historyItem.tokensIn === 0 &&
            historyItem.tokensOut === 0 &&
            historyItem.totalCost === 0 &&
            Array.isArray(apiHistory) &&
            apiHistory.length > 0
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

        // --- 4. Recompute size (after all modifications) ---
        await uiTx.load(false)
        const uiMessages = uiTx.getData() as unknown[] | null
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

        if (modified && !options.dryRun) {
            hiTx.setData(historyItem)
            const bak = await hiTx.save(true, options.backup !== false)
            if (bak) result.backups.push(bak)
        }
        if (modified && !result.touchedFiles.includes(HISTORY_ITEM_NAME)) {
            result.touchedFiles.push(HISTORY_ITEM_NAME)
        }
    } else {
        result.errors.push("missing history_item.json — cannot repair task or size")
        result.hint = `This task cannot be repaired. Remove it with: zoo-code-history-repair delete ${taskId} --force`
    }

    return result
}
