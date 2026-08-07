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

export interface TaskCorruption {
    taskId: string
    dir?: string
    reasons: CorruptionReason[]
    indexItem?: HistoryItem | null
    diskItem?: HistoryItem | null
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