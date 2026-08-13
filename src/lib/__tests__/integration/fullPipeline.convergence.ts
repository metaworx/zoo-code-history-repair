/**
 * Integration test: pipeline convergence (rebuildIndex → repairTask →
 * rebuildIndex → repairAll → rebuildIndex).
 *
 * Verifies that repeatedly rebuilding the index and repairing tasks converges:
 * corruption counts decrease across passes and the final index is error-free
 * and idempotent (a final rebuild produces no change).
 */
import path from "node:path"
import {expect, vi} from "vitest"
import {IndexTransaction} from "../../IndexTransaction.js"
import {scanStorage} from "../../scan.js"
import {repairTaskDir} from "../../repairTask.js"
import {repairAllCorrupted} from "../../repairAll.js"
import {action as rebuildIndexAction} from "../../commands/rebuildIndex.js"
import {contentHash} from "../../file.js"

interface RepairCounters {
    corruptDisk: number
    corruptIdx: number
    errorsDisk: number
    errorsIdx: number
}

/** Parse the `orphan/corrupt/errors/warnings` counters out of a repair summary line. */
function parseSummary(summary: string | undefined): RepairCounters {
    const corrupt = /corrupt: (\d+) disk, (\d+) index/.exec(summary ?? "")
    const errors = /errors: (\d+) disk, (\d+) index/.exec(summary ?? "")
    return {
        corruptDisk: Number(corrupt?.[1] ?? 0),
        corruptIdx: Number(corrupt?.[2] ?? 0),
        errorsDisk: Number(errors?.[1] ?? 0),
        errorsIdx: Number(errors?.[2] ?? 0),
    }
}

export default (tmpRoot: string, tasksDir: string, consoleLogSpy: ReturnType<typeof vi.spyOn>) => async () => {
    const indexPath = path.join(tasksDir, "_index.json")

    // Measure corruption/error counters without mutating state (dry-run repair).
    const measureCounters = async (): Promise<RepairCounters> => {
        const {warnings} = await new IndexTransaction().repair(undefined, {dryRun: true})
        return parseSummary(warnings[0])
    }
    const corruptionCount = (c: RepairCounters): number => c.corruptDisk + c.corruptIdx

    // ── Phase 1: rebuild index from (possibly corrupt) disk state ──
    consoleLogSpy.mockClear()
    await rebuildIndexAction({force: true, backup: true})
    const corrupt1 = corruptionCount(await measureCounters())
    expect(corrupt1, "initial rebuild must still leave some corrupt entries").toBeGreaterThan(0)

    // ── Phase 2: repair individual corrupt tasks via repairTaskDir ──
    const scan = await scanStorage(tmpRoot)
    const indexItems = await new IndexTransaction().getEntries()
    for (const c of scan.corruptions) {
        await repairTaskDir(path.join(tasksDir, c.taskId), {
            dryRun: false,
            backup: true,
            indexItems: indexItems as Array<{
                id: string
                tokensIn?: number
                tokensOut?: number
                totalCost?: number
                cacheReads?: number
                cacheWrites?: number
            }>,
        })
    }

    // ── Phase 3: rebuild again — assert fewer corrupt entries than Phase 1 ──
    await rebuildIndexAction({force: true, backup: true})
    const corrupt3 = corruptionCount(await measureCounters())
    expect(corrupt3, "repaired + rebuilt index must have fewer corrupt entries").toBeLessThan(corrupt1)

    // ── Phase 4: repair all remaining corrupt tasks ──
    await repairAllCorrupted(tmpRoot, {dryRun: false, backup: true})

    // ── Phase 5: final rebuild — assert zero errors (converged) ──
    await rebuildIndexAction({force: true, backup: true})
    const c5 = await measureCounters()
    expect(c5.errorsIdx, "final rebuild must yield an error-free index").toBe(0)
    expect(c5.corruptIdx, "final rebuild must leave no corrupt index entries").toBe(0)

    // ── Phase 6: final rebuild again — assert no change (idempotent) ──
    const hashBefore = await contentHash(indexPath)
    await rebuildIndexAction({force: true, backup: true})
    const hashAfter = await contentHash(indexPath)
    expect(hashAfter, "re-running rebuild must not change the index").toBe(hashBefore)
}
