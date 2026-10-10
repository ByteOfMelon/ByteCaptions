import { Ms, WordTiming } from './types';

/** The words of some text (split at whitespace) */
export function splitWords(text: string): string[] {
	return text.split(/\s+/).filter(Boolean);
}

/** Spread words over [start, end), each getting a share by its length */
export function spreadWords(words: readonly string[], start: Ms, end: Ms): WordTiming[] {
	const weight = (w: string) => w.length + 1;
	const total = words.reduce((n, w) => n + weight(w), 0);
	let at = 0;
	return words.map((text) => {
		const s = start + ((end - start) * at) / total;
		at += weight(text);
		return {
			text,
			start: Math.round(s),
			end: Math.round(start + ((end - start) * at) / total),
		};
	});
}

/** Which old and new words are the same, in order by longest common subsequence */
function matchWords(a: readonly string[], b: readonly string[]): [number, number][] {
	const n = a.length;
	const m = b.length;
	const len = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			len[i][j] =
				a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
	const pairs: [number, number][] = [];
	for (let i = 0, j = 0; i < n && j < m;)
		if (a[i] === b[j]) pairs.push([i++, j++]);
		else if (len[i + 1][j] >= len[i][j + 1]) i++;
		else j++;
	return pairs;
}

/**
 * Word timings for edited text, keeping what didn't change: unchanged words keep their times, a replaced word takes the slot of the one it replaced, an added word shares the slot of the word before it (after it, at the start), and a deleted word's time goes to the word before it. Null when there's nothing to time
 */
export function retimeWords(
	words: readonly WordTiming[],
	text: string,
	start: Ms,
	end: Ms,
): WordTiming[] | null {
	const next = splitWords(text);
	if (!next.length) return null;
	if (!words.length) return spreadWords(next, start, end);
	const out: WordTiming[] = [];
	let pendingStart: Ms | null = null;
	let pendingInsert: string[] | null = null;
	// Old words [i0, i1) became new words [j0, j1)
	const gap = (i0: number, i1: number, j0: number, j1: number) => {
		const added = next.slice(j0, j1);
		if (i1 > i0) {
			// Replaced (or deleted) words: the new ones share their time
			const s = words[i0].start;
			const e = words[i1 - 1].end;
			if (added.length) out.push(...spreadWords(added, s, e));
			else if (out.length) out[out.length - 1] = { ...out[out.length - 1], end: e };
			else pendingStart = s;
			return;
		}
		if (!added.length) return;
		// Split the word before (or, at the start, the word after) with them
		const prev = out.at(-1);
		if (prev) {
			const shared = spreadWords([prev.text, ...added], prev.start, prev.end);
			out[out.length - 1] = { ...prev, end: shared[0].end };
			out.push(...shared.slice(1));
		} else pendingInsert = added;
	};
	const keep = (w: WordTiming) => {
		let word = { ...w };
		if (pendingStart !== null) word.start = pendingStart;
		pendingStart = null;
		if (pendingInsert) {
			const shared = spreadWords([...pendingInsert, word.text], word.start, word.end);
			out.push(...shared.slice(0, -1));
			word = { ...word, start: shared.at(-1)!.start };
			pendingInsert = null;
		}
		out.push(word);
	};
	let i = 0;
	let j = 0;
	for (const [mi, mj] of matchWords(
		words.map((w) => w.text),
		next,
	)) {
		gap(i, mi, j, mj);
		keep(words[mi]);
		i = mi + 1;
		j = mj + 1;
	}
	gap(i, words.length, j, next.length);
	
	if (out.length !== next.length) return spreadWords(next, start, end);
	return out;
}

/**
 * Move the line before word `index` to `at`: that word now starts there and, if the two
 * words touched, the word before ends there too. Each word keeps at least `minMs` as configed
 */
export function moveWordEdge(
	words: readonly WordTiming[],
	index: number,
	at: Ms,
	minMs: Ms,
): WordTiming[] {
	const prev = words[index - 1];
	const word = words[index];
	if (!prev || !word) return [...words];
	const t = Math.round(Math.max(prev.start + minMs, Math.min(word.end - minMs, at)));
	const touching = prev.end >= word.start;
	return words.map((w, i) =>
		i === index
			? { ...w, start: t }
			: i === index - 1 && (touching || w.end > t)
				? { ...w, end: t }
				: w,
	);
}

/**
 * Times for tapped words - each tap starts a word and ends the one before; the last tapped word runs to the next tap, else the untapped words share what's left of the cue
 */
export function tappedWords(
	words: readonly string[],
	taps: readonly Ms[],
	start: Ms,
	end: Ms,
): WordTiming[] {
	const n = Math.min(taps.length, words.length);
	if (!n) return spreadWords(words, start, end);
	const out: WordTiming[] = [];
	for (let i = 0; i < n; i++)
		out.push({
			text: words[i],
			start: Math.round(taps[i]),
			end: Math.round(taps[i + 1] ?? end),
		});
	const rest = words.slice(n);
	if (rest.length) {
		// The last tapped word gets an average share; the rest split the remainder
		const last = out[n - 1];
		const share = (end - last.start) / (rest.length + 1);
		last.end = Math.round(last.start + share);
		out.push(...spreadWords(rest, last.end, end));
	}
	return out;
}
