import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {setRoot} from "../src/lib/cliContext.js"
import {action as rebuildIndexAction} from "../src/lib/commands/rebuildIndex.js"
import {action as repairAllAction} from "../src/lib/commands/repairAll.js"
import {action as scanAction} from "../src/lib/commands/scan.js"
import {action as listCorruptAction} from "../src/lib/commands/listCorrupt.js"

const FIXTURE_TASKS = path.resolve("tests/fixtures/tasks")
const orphan = "019ede5a-9327-70cc-9c54-2d227182e4d1"

function setup() {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zoo-regen-"))
    const tasksDir = path.join(tmpRoot, "tasks")
    fs.mkdirSync(tasksDir)
    fs.cpSync(FIXTURE_TASKS, tasksDir, {recursive: true})
    setRoot(tmpRoot)
    return {tmpRoot, tasksDir}
}

async function run(fn: () => Promise<void>): Promise<string> {
    const logs: string[] = []
    const origLog = console.log
    const origExit = process.exit
    console.log = (...a: any[]) => { logs.push(a.map(String).join(" ")) }
    ;(process as any).exit = (code?: number) => { throw new Error("__EXIT__:" + code) }
    try {
        await fn()
    } catch (e: any) {
        if (!String(e?.message).startsWith("__EXIT__:")) throw e
    } finally {
        console.log = origLog
        ;(process as any).exit = origExit
    }
    return logs.join("\n")
}

function replaceRoot(data: any, tmpRoot: string): any {
    if (typeof data === "string") {
        return data.split(tmpRoot).join("tests\\fixtures")
    }
    if (Array.isArray(data)) return data.map(x => replaceRoot(x, tmpRoot))
    if (data && typeof data === "object") {
        const out: Record<string, any> = {}
        for (const [k, v] of Object.entries(data)) out[k] = replaceRoot(v, tmpRoot)
        return out
    }
    return data
}

async function main() {
    // Flow A: rebuild-index → _index.rebuilt.json
    {
        const {tmpRoot, tasksDir} = setup()
        await run(() => rebuildIndexAction({force: true, backup: false}))
        const idxData = JSON.parse(fs.readFileSync(path.join(tasksDir, "_index.json"), "utf8"))
        const entries = Array.isArray(idxData) ? idxData : idxData.entries
        fs.writeFileSync(
            path.resolve("tests/fixtures/_index.rebuilt.json"),
            JSON.stringify({entries}, null, 4) + "\n",
        )
        console.log("WROTE _index.rebuilt.json with " + entries.length + " entries")
        fs.rmSync(tmpRoot, {recursive: true, force: true})
    }

    // Flow B: repair-all → scan.after.json + list-corrupt.after.json
    {
        const {tmpRoot, tasksDir} = setup()
        await run(() => repairAllAction({force: true, backup: false}))

        const scanRaw = await run(() => scanAction({json: true}))
        const scanJson = JSON.parse(scanRaw)
        scanJson.version = "0.4.0"
        const scanFixed = replaceRoot(scanJson, tmpRoot)
        scanFixed.storageRoot = ".\\tests\\fixtures\\"
        fs.writeFileSync(path.resolve("tests/fixtures/scan.after.json"), JSON.stringify(scanFixed, null, 4) + "\n")
        console.log("WROTE scan.after.json indexItemCount=" + scanFixed.indexItemCount + " corruptions=" + scanFixed.corruptions.length)

        const lcRaw = await run(() => listCorruptAction({json: true}))
        const lcJson = JSON.parse(lcRaw)
        lcJson.version = "0.4.0"
        fs.writeFileSync(path.resolve("tests/fixtures/list-corrupt.after.json"), JSON.stringify(lcJson, null, 4) + "\n")
        console.log("WROTE list-corrupt.after.json corruptions=" + lcJson.corruptions.length)

        fs.rmSync(tmpRoot, {recursive: true, force: true})
    }

    console.log("DONE")
}

main().catch(e => { console.error("FATAL", e); process.exit(1) })
