/**
 * Formatting inside a cue: its text is a list of runs, each with optional style overrides on
 * top of the cue's preset. These keep runs tidy through edits: style a character range, keep
 * formatting when the text changes, split and join.
 */
import { CaptionStyle, TextRun } from './types';

type Override = Partial<CaptionStyle>;

function sameOverride(a: Override | undefined, b: Override | undefined): boolean {
	const ka = Object.keys(a ?? {});
	const kb = Object.keys(b ?? {});
	return (
		ka.length === kb.length &&
		ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)?.[k])
	);
}

function run(text: string, styleOverride?: Override): TextRun {
	return styleOverride && Object.keys(styleOverride).length ? { text, styleOverride } : { text };
}

/** Drop empty runs and join neighbours with the same formatting. Always at least one run. */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
	const out: TextRun[] = [];
	for (const r of runs) {
		if (!r.text) continue;
		const last = out.at(-1);
		if (last && !last.ruby && !r.ruby && sameOverride(last.styleOverride, r.styleOverride))
			out[out.length - 1] = run(last.text + r.text, last.styleOverride);
		else out.push(r.styleOverride || r.ruby ? { ...r } : { text: r.text });
	}
	return out.length ? out : [{ text: '' }];
}

/** The runs covering characters [from, to). */
export function sliceRuns(runs: readonly TextRun[], from: number, to: number): TextRun[] {
	const out: TextRun[] = [];
	let at = 0;
	for (const r of runs) {
		const end = at + r.text.length;
		const s = Math.max(from, at);
		const e = Math.min(to, end);
		if (e > s) out.push({ ...r, text: r.text.slice(s - at, e - at) });
		at = end;
	}
	return out;
}

/**
 * Change the formatting of characters [from, to): merge `change` into their overrides
 * (a value of undefined removes that override), or 'clear' to remove all of it.
 */
export function styleRange(
	runs: readonly TextRun[],
	from: number,
	to: number,
	change: Override | 'clear',
): TextRun[] {
	const length = runs.reduce((n, r) => n + r.text.length, 0);
	if (to <= from) return normalizeRuns(runs);
	const styled = sliceRuns(runs, from, to).map((r) => {
		if (change === 'clear') return { ...r, styleOverride: undefined };
		const merged: Record<string, unknown> = { ...r.styleOverride, ...change };
		for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
		return { ...r, styleOverride: merged as Override };
	});
	return normalizeRuns([
		...sliceRuns(runs, 0, from),
		...styled.map((r) => ({
			...run(r.text, r.styleOverride),
			...(r.ruby && { ruby: r.ruby }),
		})),
		...sliceRuns(runs, to, length),
	]);
}

/**
 * Change the text, keeping the formatting of what didn't change. Typed text takes the
 * formatting of the character before it (or after it, at the very start).
 */
export function replaceText(runs: readonly TextRun[], text: string): TextRun[] {
	const old = runs.map((r) => r.text).join('');
	if (old === text) return normalizeRuns(runs);
	let pre = 0;
	while (pre < old.length && pre < text.length && old[pre] === text[pre]) pre++;
	let suf = 0;
	while (
		suf < old.length - pre &&
		suf < text.length - pre &&
		old[old.length - 1 - suf] === text[text.length - 1 - suf]
	)
		suf++;
	const inserted = text.slice(pre, text.length - suf);
	const like = sliceRuns(runs, pre ? pre - 1 : pre, pre ? pre : pre + 1)[0];
	return normalizeRuns([
		...sliceRuns(runs, 0, pre),
		run(inserted, like?.styleOverride),
		...sliceRuns(runs, old.length - suf, old.length),
	]);
}

/** Trim whitespace from both ends of the runs' text, keeping formatting. */
export function trimRuns(runs: readonly TextRun[]): TextRun[] {
	const text = runs.map((r) => r.text).join('');
	const start = text.length - text.trimStart().length;
	const end = text.trimEnd().length;
	return normalizeRuns(sliceRuns(runs, start, Math.max(start, end)));
}

/** Split the runs at character `at`, trimming each side. */
export function splitRuns(runs: readonly TextRun[], at: number): [TextRun[], TextRun[]] {
	const length = runs.reduce((n, r) => n + r.text.length, 0);
	return [trimRuns(sliceRuns(runs, 0, at)), trimRuns(sliceRuns(runs, at, length))];
}

/** The formatting of characters [from, to): each property that's the same across all of them. */
export function rangeOverride(runs: readonly TextRun[], from: number, to: number): Override {
	const parts = sliceRuns(runs, from, Math.max(to, from + 1));
	if (!parts.length) return {};
	const first = parts[0].styleOverride ?? {};
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(first))
		if (parts.every((p) => (p.styleOverride as Record<string, unknown>)?.[k] === v)) out[k] = v;
	return out as Override;
}
