import type {HistoryItem} from "../types.js"

/**
 * Byte size of a value when serialized as compact JSON (UTF-8).
 * Matches the format produced by writeJsonCompact: JSON.stringify(data)
 * with no separators.
 */
export function compactSizeBytes(data: unknown): number {
    return Buffer.byteLength(JSON.stringify(data), "utf8")
}

/**
 * Compute the expected `size` field for a history_item.json.
 *
 * Formula: sum of compact UTF-8 byte sizes of all four task JSON files.
 *   size = compact(ui_messages) + compact(api_history) + compact(history_item) + compact(task_metadata)
 *
 * The historyItem parameter should be the object *without* the size field
 * (or with it — the difference is negligible for practical purposes).
 */
export function computeTaskSize(
    uiMessages: unknown,
    apiHistory: unknown,
    historyItem: HistoryItem,
    taskMetadata: unknown,
): number {
    return (
        compactSizeBytes(uiMessages) +
        compactSizeBytes(apiHistory) +
        compactSizeBytes(historyItem) +
        compactSizeBytes(taskMetadata)
    )
}
