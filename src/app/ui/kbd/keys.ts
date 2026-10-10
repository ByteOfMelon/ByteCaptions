/** Differ how keys are shown depending on OS */
export const IS_MAC = /Mac/.test(navigator.userAgent);

const MAC: Record<string, string> = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Backspace: '⌫' };

/** The keys of a shortcut as shown on this computer */
export function keyCaps(keys: string, separator = '+'): string[] {
	return keys
		.split(separator)
		.map((k) => k.trim())
		.filter(Boolean)
		.map((k) => (IS_MAC ? (MAC[k] ?? k) : k));
}
