import {guessStorageRoots} from "./paths.js"

let _root: string | undefined

export function setRoot(root: string): void {
    _root = root
}

export function resolveRoot(): string {
    if (_root) return _root
    const root = guessStorageRoots()[0]
    if (!root) {
        console.error("No storage root found. Pass --root")
        process.exit(1)
    }
    return root
}
