import { joinWords, textWidth, wordGap } from '../model/cue';
import { createCue } from '../model/defaults';
import { Cue, Ms, ProjectSettings, WordTiming } from '../model/types';

/**
 * Words → cues (PLAN §5.2). Turns timed words from transcription into cues that respect the
 * project's limits: characters per line, lines per cue, min/max duration, gap between cues
 * and reading speed. Breaks prefer sentence ends, then clause punctuation, then pauses.
 *
 * Word text is expected trimmed (punctuation attached, e.g. "Hello,") and is joined with
 * single spaces, or none in Chinese and Japanese. Line lengths count full-width characters
 * as two.
 */

export interface SegmentOptions {
	/** A silence at least this long always starts a new cue. */
	pauseMs: Ms;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = { pauseMs: 700 };

type Limits = Pick<
	ProjectSettings,
	'maxCharsPerLine' | 'maxLines' | 'minDurationMs' | 'maxDurationMs' | 'minGapMs' | 'maxCps'
>;

const SENTENCE_END = /[.?!…。！？]["'”’)\]」』）]*$/;
const CLAUSE_END = /[,;:—–\-、，；：]["'”’)\]」』）]*$/;
/** Words a line or cue shouldn't end on, since they bind to what follows (English). */
const WEAK_END =
	/^(a|an|the|and|or|but|nor|of|to|in|on|at|for|with|from|by|as|into|than|that|if|my|your|his|her|its|our|their|this|these|those)$/i;

export function segmentWords(
	words: WordTiming[],
	limits: Limits,
	options: SegmentOptions = DEFAULT_SEGMENT_OPTIONS,
): Cue[] {
	const clean = words
		.map((w) => ({ ...w, text: w.text.trim() }))
		.filter((w) => w.text && w.end >= w.start)
		.sort((a, b) => a.start - b.start);

	const groups: WordTiming[][] = [];
	let current: WordTiming[] = [];
	const flush = () => {
		if (current.length) groups.push(current);
		current = [];
	};

	for (const word of clean) {
		const prev = current.at(-1);
		if (prev) {
			const pause = word.start - prev.end >= options.pauseMs;
			// Sentence ends start a new cue, unless the cue would be too short to read.
			const sentence =
				SENTENCE_END.test(prev.text) && prev.end - current[0].start >= limits.minDurationMs;
			if (pause || sentence) flush();
		}
		current.push(word);
		// Over a limit: break at the best point and carry the rest into the next cue.
		while (current.length > 1 && !fits(current, limits)) {
			const at = bestBreak(current, limits);
			groups.push(current.slice(0, at));
			current = current.slice(at);
		}
	}
	flush();

	const cues = groups.map((g) => {
		const cue = createCue(g[0].start, g.at(-1)!.end, layoutLines(g, limits).join('\n'));
		cue.words = g;
		return cue;
	});
	adjustTiming(cues, limits);
	return cues;
}

function fits(words: WordTiming[], limits: Limits): boolean {
	if (words.at(-1)!.end - words[0].start > limits.maxDurationMs) return false;
	return wrap(words, limits.maxCharsPerLine).length <= limits.maxLines;
}

/** Greedy wrap into lines at most `max` wide (a wider single word gets its own line). */
function wrap(words: WordTiming[], max: number): string[] {
	const lines: string[] = [];
	let line = '';
	words.forEach((w, i) => {
		const longer = line ? line + wordGap(words[i - 1].text, w.text) + w.text : w.text;
		if (line && textWidth(longer) > max) {
			lines.push(line);
			line = w.text;
		} else line = longer;
	});
	if (line) lines.push(line);
	return lines;
}

/**
 * Where to end the first cue (index of the first word of the next one) when `words` is over
 * the limits. Scores each break that leaves a fitting left side.
 */
function bestBreak(words: WordTiming[], limits: Limits): number {
	const capacity = limits.maxCharsPerLine * limits.maxLines;
	let best = 1;
	let bestScore = -Infinity;
	for (let at = 1; at < words.length; at++) {
		const left = words.slice(0, at);
		if (!fits(left, limits)) break;
		const before = words[at - 1];
		const gap = words[at].start - before.end;
		const fill = textWidth(joinWords(left)) / capacity;
		const score =
			(SENTENCE_END.test(before.text) ? 6 : CLAUSE_END.test(before.text) ? 3 : 0) +
			Math.min(gap / 150, 3) -
			(WEAK_END.test(before.text) ? 3 : 0) +
			// Prefer using the space: full cues read better than many short ones.
			fill * 4 -
			// Avoid leaving a single dangling word for the next cue.
			(at === words.length - 1 ? 2 : 0);
		if (score >= bestScore) {
			bestScore = score;
			best = at;
		}
	}
	return best;
}

/**
 * Lines for a cue: one line if it fits, otherwise the most balanced split (preferring breaks
 * after punctuation), falling back to greedy wrapping beyond two lines.
 */
export function layoutLines(words: WordTiming[], limits: Limits): string[] {
	const max = limits.maxCharsPerLine;
	const text = joinWords(words);
	if (textWidth(text) <= max || limits.maxLines < 2 || words.length < 2) return [text];

	let best: string[] | null = null;
	let bestScore = Infinity;
	for (let at = 1; at < words.length; at++) {
		const a = joinWords(words.slice(0, at));
		const b = joinWords(words.slice(at));
		const [aw, bw] = [textWidth(a), textWidth(b)];
		if (aw > max || bw > max) continue;
		const prev = words[at - 1].text;
		const score =
			Math.abs(aw - bw) -
			(SENTENCE_END.test(prev) ? 12 : CLAUSE_END.test(prev) ? 8 : 0) +
			(WEAK_END.test(prev) ? 10 : 0) +
			// Slightly prefer a shorter top line (bottom-heavy pyramid reads better).
			(aw > bw ? 2 : 0);
		if (score < bestScore) {
			bestScore = score;
			best = [a, b];
		}
	}
	return best ?? wrap(words, max);
}

/**
 * Timing clean-up between consecutive cues: keep the minimum gap, then let short or fast
 * cues linger into the following silence (up to the max duration) so they can be read.
 */
function adjustTiming(cues: Cue[], limits: Limits): void {
	cues.forEach((cue, i) => {
		const next = cues[i + 1];
		const latest = next ? next.start - limits.minGapMs : Infinity;
		if (cue.end > latest && latest > cue.start) cue.end = latest;

		const chars = cue.runs[0].text.replace(/\n/g, '').length;
		const needed = Math.max(limits.minDurationMs, (chars / limits.maxCps) * 1000);
		const target = Math.min(cue.start + needed, cue.start + limits.maxDurationMs, latest);
		if (target > cue.end) cue.end = Math.round(target);
	});
}
