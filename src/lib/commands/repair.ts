/**
 * @file src/lib/commands/repair.ts
 *
 * repair command — unified repair surface dispatching on --index / --all / <taskId>.
 */
import path from "node:path"
import { IndexTransaction } from "../IndexTransaction.js"
import { JsonFileTransaction } from "../file.js"
import { DEFAULT_INDEX_NAME, HISTORY_ITEM_NAME, resolveTasksDir, UI_MESSAGES_NAME } from "../paths.js"
import { ABBREV_HELP, getVersionBanner, resolveRoot } from "../cliContext.js"
import { c, colorize } from "../format.js"
import { formatRepairParts, repairTaskDir } from "../repairTask.js"
import { repairAllCorrupted } from "../repairAll.js"
import { alignSummary } from "../scanOutput.js"

export const name = "repair"
export const summary = "Repair corrupted task data (index, single task, or all tasks)"

export const description = `${summary}.

Exactly one of --index, --all, or <taskId> is required; any other combination
errors with usage. All modes default to dry-run; pass --force to actually write.
Token repair: recovers from ${DEFAULT_INDEX_NAME} or estimates from ACH.
Use --fixed-input-token 0 to disable estimation.`

export const usage = `--index|<taskId>|--all [--force] [... options]

Modes: repair --index  [--force]  # rebuild the main index
       repair <taskId> [--force]  # attempt to repair a specific task
       repair --all    [--force]  # attempt to repair all tasks`

export const additionalHelp = ABBREV_HELP

export const options = [
	["--index", `Rebuild ${DEFAULT_INDEX_NAME} from each task's ${HISTORY_ITEM_NAME}`, false],
	["--all", "Repair all corrupted tasks, then rebuild _index.json", false],
	["--force", "Actually write changes (default: dry-run)", false],
	["--no-backup", "Skip creating timestamped backup files"],
	["--verify-ui-sync", `Verify ${UI_MESSAGES_NAME} sync with ACH reconstruction`, false],
	["--force-uim", `Force ${UI_MESSAGES_NAME} rebuild even when not corrupt`, false],
	["--fixed-input-token <n>", "Use n as tokensIn (0 = keep zeros, omit = estimate)", parseInt],
	["--force-rebuild-hi", `Rebuild a missing ${HISTORY_ITEM_NAME} from ACH + backups`, false],
	["--verbose", "Show all processed tasks including skipped", false],
] as const

interface RepairCmdOptions {
	index?: boolean
	all?: boolean
	force?: boolean
	backup?: boolean
	verifyUiSync?: boolean
	forceUim?: boolean
	fixedInputToken?: number
	forceRebuildHi?: boolean
	verbose?: boolean
}

const dryRunIndexMsg = colorize("\n!! Dry-run — nothing written. Use --force to apply changes. !!", c.red)
const dryRunTaskMsg = colorize("\n!! Dry-run — nothing written. Use --force to apply changes. !!", c.red)
const dryRunAllMsg = colorize("\nDry-run — nothing written. Use --force to apply changes.", c.red)

/** repair --index: rebuild _index.json from each task's history_item.json. */
async function repairIndexMode(cmdOpts: RepairCmdOptions): Promise<void> {
	const root = resolveRoot()
	const idx = new IndexTransaction(false)
	const {
		items,
		written,
		backupPath,
		uiSyncMismatches = [],
	} = await idx.repair(undefined, {
		dryRun: !cmdOpts.force,
		backup: cmdOpts.backup !== false,
		verifyUiSync: !!cmdOpts.verifyUiSync,
	})

	console.log(getVersionBanner())
	console.log(`Rebuilt index with ${items.length} items`)
	if (!written) {
		console.log(dryRunIndexMsg)
	} else {
		console.log(`Written: ${resolveTasksDir(root)}/${DEFAULT_INDEX_NAME}`)
		if (cmdOpts.backup !== false && backupPath) console.log(`Backup:  ${backupPath}`)
	}

	if (uiSyncMismatches.length > 0) {
		console.log(`UI-sync mismatch: ${uiSyncMismatches.length} task(s) differ from ACH reconstruction`)
		for (const id of uiSyncMismatches) console.log(`  ${id}: ui_sync_mismatch`)
	} else if (cmdOpts.verifyUiSync) {
		console.log("UI-sync verified: no mismatches")
	}
}

/** repair <taskId>: repair a single task, then surgically replace its index entry. */
async function repairTaskMode(taskId: string, cmdOpts: RepairCmdOptions): Promise<void> {
	const root = resolveRoot()
	const tasksDir = resolveTasksDir(root)
	const taskDir = `${tasksDir}/${taskId}`

	const idx = new IndexTransaction()
	const indexItems = (await idx.getEntries()) as Array<{
		id: string
		tokensIn?: number
		tokensOut?: number
		totalCost?: number
	}>
	const fullIndex = await idx.getFullIndex()
	const taskIds = await idx.getKnownTaskIds()

	const r = await repairTaskDir(taskDir, {
		dryRun: !cmdOpts.force,
		backup: cmdOpts.backup !== false,
		forceUim: cmdOpts.forceUim,
		fixedInputToken: cmdOpts.fixedInputToken,
		forceRebuildHi: cmdOpts.forceRebuildHi,
		indexItems,
		fullIndex,
		taskIds,
	})

	console.log(getVersionBanner())

	if (r.errors.length) {
		console.log(`Task: ${r.taskId}`)
		console.log(`  errors:`)
		for (const e of r.errors) console.log(`    - ${e}`)
		if (r.hint) console.log(`  hint: ${r.hint}`)
		if (r.backups.length > 0) {
			console.log(`  Backups:`)
			for (const b of r.backups) console.log(`    ${path.basename(b)}`)
		}
		if (!cmdOpts.force) console.log(dryRunTaskMsg)
		return
	}

	const parts = formatRepairParts(r)

	if (parts.length > 0) {
		console.log(
			`${cmdOpts.force ? "" : "[DRY-RUN] "}${r.taskId}: ${cmdOpts.force ? "repaired" : "would repair"} ${parts.join(", ")}`,
		)
	}

	// Targeted index update: replace only this task's entry, never touch others
	let idxBak: string | null = null
	if (cmdOpts.force && parts.length > 0) {
		const hiTx = new JsonFileTransaction(path.join(taskDir, HISTORY_ITEM_NAME), true)
		await hiTx.load(false)
		const diskEntry = hiTx.getData() as Record<string, unknown> | null
		if (diskEntry) {
			const writeIdx = new IndexTransaction(false)
			idxBak = await writeIdx.replaceId(taskId, diskEntry, true, false)
		}
	}

	const allBackups = [...r.backups]
	if (idxBak) allBackups.push(idxBak)
	if (allBackups.length > 0) {
		console.log(`  Backups:`)
		for (const b of allBackups) console.log(`    ${path.basename(b)}`)
	}

	if (!cmdOpts.force) console.log(dryRunTaskMsg)
}

/** repair --all: scan + repair every corrupted task, then rebuild _index.json. */
async function repairAllMode(cmdOpts: RepairCmdOptions): Promise<void> {
	const root = resolveRoot()
	const ra = await repairAllCorrupted(root, {
		dryRun: !cmdOpts.force,
		backup: cmdOpts.backup !== false,
		fixedInputToken: cmdOpts.fixedInputToken,
		verifyUiSync: cmdOpts.verifyUiSync,
		forceRebuildHi: cmdOpts.forceRebuildHi,
	})

	console.log(getVersionBanner())
	console.log(alignSummary("Storage:", root))
	console.log(alignSummary("Tasks:", resolveTasksDir(root)))
	console.log("")

	console.log(`Found ${ra.total} corrupted tasks`)
	let shown = 0
	for (const r of ra.results) {
		const parts = formatRepairParts(r)

		if (r.unrepairable) {
			console.log(`  ${r.taskId}: UNREPAIRABLE — ${r.errors.join("; ")}`)
			if (r.hint) console.log(`    hint: ${r.hint}`)
			shown++
		} else if (parts.length > 0) {
			const prefix = cmdOpts.force ? "" : "[DRY-RUN] "
			const verb = cmdOpts.force ? "repaired" : "would repair"
			console.log(`  ${prefix}${r.taskId}: ${verb} ${parts.join(", ")}`)
			shown++
		} else if (r.errors.length) {
			console.log(`  ${r.taskId}: FAILED — ${r.errors.join("; ")}`)
			shown++
		} else if (cmdOpts.verbose) {
			console.log(`  ${r.taskId}: nothing to repair`)
			shown++
		}
		// else: suppress no-op tasks
	}

	// Index rebuild summary
	if (ra.indexEntries > 0) {
		const addendum: string[] = []
		if (ra.indexAdded.length > 0) addendum.push(`+${ra.indexAdded.length} added: ${ra.indexAdded.join(", ")}`)
		if (ra.indexRemoved.length > 0)
			addendum.push(`−${ra.indexRemoved.length} removed: ${ra.indexRemoved.join(", ")}`)
		const extra = addendum.length > 0 ? ` (${addendum.join(", ")})` : ""
		console.log(`${DEFAULT_INDEX_NAME} rebuilt: ${ra.indexEntries} entries${extra}`)
	}

	const prefix = cmdOpts.force ? "" : "[DRY-RUN] "
	console.log(`\n${prefix}Repaired: ${ra.repaired}, Unrepairable: ${ra.unrepairable}, Failed: ${ra.failed}`)
	if (!cmdOpts.force) console.log(dryRunAllMsg)
}

export async function action(taskId: string | undefined, cmdOpts: RepairCmdOptions): Promise<void> {
	const modeCount = Number(Boolean(cmdOpts.index)) + Number(Boolean(cmdOpts.all)) + Number(Boolean(taskId))
	if (modeCount !== 1) {
		console.error("repair requires exactly one of --index, --all, or a <taskId> positional argument")
		console.error("")
		console.error("Usage:")
		console.error("  repair --index [--force] [--no-backup] [--verify-ui-sync]")
		console.error(
			"  repair <taskId> [--force] [--no-backup] [--force-uim] [--fixed-input-token <n>] [--force-rebuild-hi]",
		)
		console.error(
			"  repair --all [--force] [--no-backup] [--verbose] [--fixed-input-token <n>] [--verify-ui-sync] [--force-rebuild-hi]",
		)
		process.exit(1)
		// Unreachable in production (process.exit terminates); reached only when
		// process.exit is mocked in tests, guarding against fall-through dispatch.
		return
	}

	if (cmdOpts.index) {
		await repairIndexMode(cmdOpts)
		return
	}
	if (cmdOpts.all) {
		await repairAllMode(cmdOpts)
		return
	}
	await repairTaskMode(taskId!, cmdOpts)
}
