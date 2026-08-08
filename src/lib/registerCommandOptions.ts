/**
 * Extend commander Command prototype with registerOptions helper.
 * Must be imported once before any command registration.
 */
import {Command} from "commander"

declare module "commander" {
    interface Command {
        registerOptions(opts: ReadonlyArray<Readonly<[string, string, ...unknown[]]>>): Command
    }
}

Command.prototype.registerOptions = function (
    this: Command,
    opts: ReadonlyArray<Readonly<[string, string, ...unknown[]]>>,
): Command {
    for (const [flags, desc, ...rest] of opts) {
        if (rest.length > 0) {
            this.option(flags, desc, rest[0] as string | boolean | undefined)
        } else {
            this.option(flags, desc)
        }
    }
    return this
}
