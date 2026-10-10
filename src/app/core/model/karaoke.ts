/**
 * Karaoke: a cue's words light up as they're spoken. Sung words take the karaoke colour on
 * top of their own formatting, so bold or coloured words stay that way.
 */
import { cueText } from './cue';
import { sliceRuns } from './runs';
import { Cue, Ms, TextRun } from './types';

/** Sung words are yellow unless a cue picks another colour. */
export const DEFAULT_KARAOKE_COLOR = '#FFFF00';

/** The colours offered for sung words. */
export const KARAOKE_COLORS: { label: string; value: string }[] = [
	{ label: 'Yellow', value: '#FFFF00' },
	{ label: 'Green', value: '#00FF66' },
	{ label: 'Cyan', value: '#00E5FF' },
	{ label: 'Pink', value: '#FF4FD8' },
	{ label: 'Orange', value: '#FF9900' },
];

/**
 * Where each word ends in the cue's text (a character offset), found in order. Null when the words aren't all in the text
 */
export function wordEnds(text: string, words: readonly { text: string }[]): number[] | null {
	const ends: number[] = [];
	let at = 0;
	for (const w of words) {
		const i = text.indexOf(w.text, at);
		if (i < 0) return null;
		at = i + w.text.length;
		ends.push(at);
	}
	return ends;
}

/**
 * Karaoke steps - from when each word starts (the first from the cue's start) to when the next one does, with how much of the text is sung by then
 */
export function karaokeSteps(cue: Cue): { start: Ms; end: Ms; sung: number }[] | null {
	const words = cue.words;
	if (!cue.karaoke || !words?.length) return null;
	const ends = wordEnds(cueText(cue), words);
	if (!ends) return null;
	// When each word starts, kept inside the cue and in order (a trimmed cue can leave word times outside it), so the steps cover the whole cue with no gaps.
	const starts: Ms[] = [];
	for (let i = 0; i < words.length; i++)
		starts.push(i ? Math.max(starts[i - 1], Math.min(cue.end, words[i].start)) : cue.start);
	return words
		.map((_, i) => ({ start: starts[i], end: starts[i + 1] ?? cue.end, sung: ends[i] }))
		.filter((s) => s.end > s.start);
}

/** How much of the cue's text is sung at ms (0 before the first word) */
export function sungAt(cue: Cue, ms: Ms): number {
	const steps = karaokeSteps(cue);
	let sung = 0;
	for (const s of steps ?? []) if (s.start <= ms) sung = s.sung;
	return sung;
}

/** The cue's runs with the first sung characters in the karaoke colour. */
export function karaokeRuns(cue: Cue, sung: number): TextRun[] {
	const color = cue.karaokeColor ?? DEFAULT_KARAOKE_COLOR;
	const length = cue.runs.reduce((n, r) => n + r.text.length, 0);
	return [
		...sliceRuns(cue.runs, 0, sung).map((r) => ({
			...r,
			styleOverride: { ...r.styleOverride, textColor: color },
		})),
		...sliceRuns(cue.runs, sung, length),
	];
}
