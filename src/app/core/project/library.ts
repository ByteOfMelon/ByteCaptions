import { defaultStyle } from '../model/defaults';
import { CaptionStyle } from '../model/types';

export const LIBRARY_FORMAT = 'bytecaptions-library';
export const LIBRARY_VERSION = 1;

interface LibraryFile {
	format: typeof LIBRARY_FORMAT;
	version: number;
	styles: CaptionStyle[];
}

export function serializeLibrary(styles: CaptionStyle[]): string {
	const file: LibraryFile = { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, styles };

	return JSON.stringify(file);
}

/** Get the presets from a .bclib file */
export function parseLibrary(json: string): CaptionStyle[] {
	let data: Partial<LibraryFile>;

	try {
		data = JSON.parse(json);
	} catch {
		throw new Error("This file isn't a ByteCaptions preset library.");
	}

	if (data?.format !== LIBRARY_FORMAT || !Array.isArray(data.styles))
		throw new Error("This file isn't a ByteCaptions preset library.");

	if ((data.version ?? 0) > LIBRARY_VERSION)
		throw new Error(
			'This preset library was made by a newer version of ByteCaptions. Update the app to import it.',
		);

	return data.styles.flatMap((s) => {
		const style = toStyle(s);

		return style ? [style] : [];
	});
}

function toStyle(raw: unknown): CaptionStyle | null {
	if (!raw || typeof raw !== 'object') return null;

	const src = raw as Record<string, unknown>;
	const style = defaultStyle() as unknown as Record<string, unknown>;

	for (const key of Object.keys(style))
		if (typeof src[key] === typeof style[key]) style[key] = src[key];

	return typeof src['name'] === 'string' && src['name'].trim()
		? (style as unknown as CaptionStyle)
		: null;
}

/** Enforce a unique name within a set of taken names */
export function uniqueName(name: string, taken: Iterable<string>): string {
	const names = new Set([...taken].map((n) => n.toLowerCase()));
	const trimmed = name.trim();

	if (!names.has(trimmed.toLowerCase())) return trimmed;

	const [, base, num] = /^(.*?)(?: (\d+))?$/.exec(trimmed)!;
	let n = num ? Number(num) + 1 : 2;

	while (names.has(`${base} ${n}`.toLowerCase())) n++;

	return `${base} ${n}`;
}

export function withUniqueNames(
	styles: CaptionStyle[],
	existing: Iterable<string>,
): CaptionStyle[] {
	const taken = [...existing];

	return styles.map((s) => {
		const name = uniqueName(s.name, taken);
		taken.push(name);

		return { ...structuredClone(s), name };
	});
}

export function importNames(
	styles: CaptionStyle[],
	selected: (i: number) => boolean,
	existing: Iterable<string>,
): string[] {
	const taken = [...existing];

	return styles.map((s, i) => {
		const name = uniqueName(s.name, taken);

		if (selected(i)) taken.push(name);

		return name;
	});
}

/** Whether two presets look the same: every setting matches, whatever their names */
export function sameLook(a: CaptionStyle, b: CaptionStyle): boolean {
	return (Object.keys(defaultStyle()) as (keyof CaptionStyle)[]).every(
		(k) => k === 'name' || a[k] === b[k],
	);
}
