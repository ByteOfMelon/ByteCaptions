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

export function isTextEntry(el: Element | null): boolean {
	if (!(el instanceof HTMLElement)) return false;

	if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;

	return el instanceof HTMLInputElement && ['text', 'search', ''].includes(el.type);
}
