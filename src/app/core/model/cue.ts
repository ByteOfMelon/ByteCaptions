import { CaptionStyle, Cue, Position, Project, Track } from './types';

export function cueText(cue: Cue): string {
	return cue.runs.map((r) => r.text).join('');
}

/**
 * Characters of scripts written without spaces between words: Chinese, Japanese kana and CJK / full-width punctuation (Korean separates words with spaces)
 */
const UNSPACED = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
/** Full-width characters - the above plus Korean Hangul */
const WIDE = /[ᄀ-ᇿ　-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿＀-｠￠-￦]/;

/** Determine what goes between two words depending on language */
export function wordGap(before: string, after: string): string {
	return UNSPACED.test(before.at(-1) ?? '') || UNSPACED.test(after[0] ?? '') ? '' : ' ';
}

/** Words joined into text, with spaces only when the language uses them */
export function joinWords(words: readonly { text: string }[]): string {
	return words.reduce(
		(s, w, i) => (i ? s + wordGap(words[i - 1].text, w.text) : '') + w.text,
		'',
	);
}

/** Width in half-width columns, for line lengths: full-width characters count as two */
export function textWidth(text: string): number {
	let width = 0;
	for (const c of text) width += WIDE.test(c) ? 2 : 1;
	return width;
}

export function sortCues(cues: Cue[]): void {
	cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function visibleTracks(project: Project): Track[] {
	const soloed = project.tracks.filter((t) => t.solo);
	return (soloed.length ? soloed : project.tracks).filter((t) => !t.muted);
}

export function resolveStyle(project: Project, track: Track, cue: Cue): CaptionStyle {
	return project.styles[cue.styleId ?? track.defaultStyleId] ?? Object.values(project.styles)[0];
}

export function resolvePosition(project: Project, track: Track, cue: Cue): Position {
	return (
		project.positions[cue.positionId ?? track.defaultPositionId] ??
		Object.values(project.positions)[0]
	);
}
