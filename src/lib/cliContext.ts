import {
	API_HISTORY_NAME,
	DEFAULT_INDEX_NAME,
	guessStorageRoots,
	HISTORY_ITEM_NAME,
	UI_MESSAGES_NAME,
} from "./paths.js"

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

let _colorEnabled: boolean | undefined

export function setColorEnabled(v: boolean): void {
	_colorEnabled = v
}

export function getColorEnabled(): boolean {
	if (_colorEnabled !== undefined) return _colorEnabled
	// Default: enabled on TTY, disabled when NO_COLOR is set
	_colorEnabled = (process.stdout.isTTY ?? false) && !process.env.NO_COLOR
	return _colorEnabled
}

let _version = ""

export function setVersion(v: string): void {
	_version = v
}

export function getVersion(): string {
	return _version
}

export function getVersionBanner(): string {
	return `Zoo Code History Repair, v${_version}\n`
}

export const ABBREV_HELP = `
Output abbreviations:
  ach  = ${API_HISTORY_NAME}
  calc = computed from task files on disk
  hi   = ${HISTORY_ITEM_NAME}
  uim  = ${UI_MESSAGES_NAME}
  idx  = ${DEFAULT_INDEX_NAME}`
