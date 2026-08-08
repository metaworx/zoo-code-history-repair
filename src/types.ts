export interface HistoryItem {
    id: string
    ts?: number
    task?: string
    tokensIn?: number
    tokensOut?: number
    cacheWrites?: number
    cacheReads?: number
    totalCost?: number
    size?: number
    mode?: string
    number?: number
    parentTaskId?: string
    rootTaskId?: string
    workspace?: string
    status?: string

    [key: string]: unknown
}

export type CorruptionReason =
    | "placeholder_task_name"   // "Task #1", "Task #12 (Incomplete)", etc.
    | "zero_size"
    | "missing_task_text"
    | "missing_history_item"
    | "invalid_json"
    | "missing_task_dir"
    | "empty_ui_messages"
    | "empty_api_history"
    | "index_orphan"            // in index but no folder
    | "folder_orphan"           // folder exists but not in index
    | "ui_sync_mismatch"        // ui_messages.json differs from ACH-derived reconstruction
    | "interrupted_task"        // task appears interrupted (last turn ends with tool_use, co-occurs with other corruption)
    | "zero_tokens"             // tokensIn==0 && tokensOut==0 && totalCost==0 but ACH has entries

export interface TaskCorruption {
    taskId: string
    dir?: string
    reasons: Array<{reason: CorruptionReason; source: string}>
    indexItem?: HistoryItem | null
    diskItem?: HistoryItem | null
}

export interface IndexFile {
    version: number
    updatedAt: number
    entries: HistoryItem[]
}

export interface ScanResult {
    storageRoot: string
    tasksDir: string
    indexPath: string
    indexItems: HistoryItem[]
    taskDirs: string[]
    corruptions: TaskCorruption[]
}

export interface RepairOptions {
    storageRoot?: string
    dryRun?: boolean
    backup?: boolean
}