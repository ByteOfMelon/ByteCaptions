/** Shortcut keys are written as on Windows and Linux ("Ctrl+Shift+Z"); the Mac shows its own. */
export const IS_MAC = /Mac/.test(navigator.userAgent);

const MAC: Record<string, string> = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Backspace: '⌫' };

/** The keys of a shortcut as shown on this computer, one entry per key cap. */
export function keyCaps(keys: string, separator = '+'): string[] {
	return keys
		.split(separator)
		.map((k) => k.trim())
		.filter(Boolean)
		.map((k) => (IS_MAC ? (MAC[k] ?? k) : k));
}
