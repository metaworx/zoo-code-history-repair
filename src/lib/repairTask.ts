import path from "node:path"
import type {HistoryItem} from "../types.js"
import {
    API_HISTORY_NAME,
    HISTORY_ITEM_NAME,
    TASK_METADATA_NAME,
    UI_MESSAGES_NAME,
} from "./paths.js"
import {backupFile, readJsonFile, writeJsonCompact} from "./readJson.js"
import {rebuildUiMessages} from "./rebuildUiMessages.js"
import {extractTaskFromApiHistory} from "./rebuildTaskField.js"
import {computeTaskSize} from "./size.js"

export interface RepairResult {
    taskId: string
    uiRepaired: boolean
    taskRepaired: boolean
    sizeRepaired: boolean
    errors: string[]
}

/**
 * Fully repair a single task directory:
 *  1. Rebuild ui_messages.json from api_conversation_history.json
 *  2. Rebuild history_item.json task field from ACH
 *  3. Recompute history_item.json size field
 *
 * All writes are compact JSON. Backups are created before overwriting.
 */
export function repairTaskDir(
    taskDir: string,
    options: { dryRun?: boolean; backup?: boolean } = {},
): RepairResult {
    const taskId = path.basename(taskDir)
    const result: RepairResult = {
        taskId,
        uiRepaired: false,
        taskRepaired: false,
        sizeRepaired: false,
        errors: [],
    }

    const uiPath = path.join(taskDir, UI_MESSAGES_NAME)
    const hiPath = path.join(taskDir, HISTORY_ITEM_NAME)
    const apiPath = path.join(taskDir, API_HISTORY_NAME)
    const tmPath = path.join(taskDir, TASK_METADATA_NAME)

    // Read existing files
    const apiHistory = readJsonFile<unknown[]>(apiPath)
    const historyItem = readJsonFile<HistoryItem>(hiPath)
    const taskMetadata = readJsonFile<unknown>(tmPath)

    if (!apiHistory || !Array.isArray(apiHistory)) {
        result.errors.push("missing or invalid api_conversation_history.json — cannot repair")
        return result
    }

    // --- 1. Rebuild ui_messages.json ---
    const existingUi = readJsonFile<unknown[]>(uiPath)
    const existingIsEmpty = !Array.isArray(existingUi) || existingUi.length === 0

    if (existingIsEmpty) {
        const newUi = rebuildUiMessages(apiHistory as Parameters<typeof rebuildUiMessages>[0])
        if (newUi.length > 0) {
            if (!options.dryRun) {
                if (options.backup !== false) backupFile(uiPath)
                writeJsonCompact(uiPath, newUi)
            }
            result.uiRepaired = true
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

        if (modified && !options.dryRun) {
            if (options.backup !== false) backupFile(hiPath)
            writeJsonCompact(hiPath, historyItem)
        }
    } else {
        result.errors.push("missing history_item.json — cannot repair task or size")
    }

    return result
}
