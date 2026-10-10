/**
 * Speaker separation. Puts transcribed cues on one track per speaker
 */
import { newId } from '../model/defaults';
import { Cue, CueId, Ms, Track } from '../model/types';

/** One stretch of one speaker. Speakers are numbered from 0, most talkative first */
export interface SpeakerTurn {
	start: Ms;
	end: Ms;
	speaker: number;
}

export interface SpeakerGuess {
	speaker: number;
	/** Share of the cue's speech that's this speaker's, 0–1 */
	purity: number;
}

/** Below this share of one speaker, a cue is flagged as unsure */
export const UNSURE_BELOW = 0.6;

/**
 * Avoid categorizing minor speakers as separate entities (as they're likely just interpreted as different by the speaker detection system when they actually aren't)
 */
const MINOR_SHARE = 0.02;

/** Cues this short (in words) may follow the speaker around them */
const FRAGMENT_WORDS = 3;
/** ...when the neighbours are this close */
const FRAGMENT_GAP: Ms = 1500;

/**
 * Assign each cue to a speaker based on the speaker turns and word timings
 */
export function assignSpeakers(
	cues: readonly Cue[],
	turns: readonly SpeakerTurn[],
	{ foldMinor = false } = {},
): SpeakerGuess[] {
	let guesses = cues.map((c) => guess(c, turns));

	if (foldMinor) {
		const counts = new Map<number, number>();

		for (const g of guesses) counts.set(g.speaker, (counts.get(g.speaker) ?? 0) + 1);

		const min = Math.max(3, cues.length * MINOR_SHARE);
		const minor = new Set([...counts].filter(([, n]) => n < min).map(([s]) => s));

		if (minor.size && minor.size < counts.size) {
			const major = turns.filter((t) => !minor.has(t.speaker));
			guesses = guesses.map((g, i) =>
				minor.has(g.speaker)
					? { ...guess(cues[i], major), purity: Math.min(g.purity, UNSURE_BELOW - 0.01) }
					: g,
			);
		}
	}

	smooth(cues, guesses);

	return guesses;
}

function guess(cue: Cue, turns: readonly SpeakerTurn[]): SpeakerGuess {
	const votes = new Map<number, number>();

	for (const w of cue.words?.length ? cue.words : [cue])
		for (const t of turns) {
			const overlap = Math.min(w.end, t.end) - Math.max(w.start, t.start);

			if (overlap > 0) votes.set(t.speaker, (votes.get(t.speaker) ?? 0) + overlap);
		}

	if (!votes.size) {
		if (!turns.length) return { speaker: 0, purity: 0 };

		const mid = (cue.start + cue.end) / 2;
		const distance = (t: SpeakerTurn) => Math.max(0, t.start - mid, mid - t.end);
		const near = turns.reduce((a, b) => (distance(b) < distance(a) ? b : a));

		return { speaker: near.speaker, purity: 0 };
	}

	const total = [...votes.values()].reduce((a, b) => a + b, 0);
	const [speaker, share] = [...votes].reduce((a, b) => (b[1] > a[1] ? b : a));

	return { speaker, purity: share / total };
}

function wordCount(c: Cue): number {
	return (
		c.words?.length ??
		c.runs
			.map((r) => r.text)
			.join(' ')
			.trim()
			.split(/\s+/).length
	);
}

/**
 * A short, uncertain fragment between two cues of the same other speaker is usually theirs, still flag as unsure
 */
function smooth(cues: readonly Cue[], guesses: SpeakerGuess[]): void {
	for (let i = 1; i < cues.length - 1; i++) {
		const [prev, cur, next] = [guesses[i - 1], guesses[i], guesses[i + 1]];

		if (
			wordCount(cues[i]) <= FRAGMENT_WORDS &&
			cur.purity < 1 &&
			prev.speaker === next.speaker &&
			cur.speaker !== prev.speaker &&
			cues[i].start - cues[i - 1].end < FRAGMENT_GAP &&
			cues[i + 1].start - cues[i].end < FRAGMENT_GAP
		)
			guesses[i] = {
				speaker: prev.speaker,
				purity: Math.min(cur.purity, UNSURE_BELOW - 0.01),
			};
	}
}

export interface SpeakerSplit {
	tracks: Track[];
	/** Per track - the cue that's most clearly that speaker, to play as a sample */
	samples: CueId[];
	/** Number of cues flagged as unsure */
	unsure: number;
}

/**
 * New tracks, one per speaker with cues, copying the source track's settings, speakers are ordered by how long they talk in the cues
 */
export function splitBySpeaker(
	source: Track,
	guesses: readonly SpeakerGuess[],
	colors: readonly string[],
): SpeakerSplit {
	const bySpeaker = new Map<number, { cue: Cue; purity: number }[]>();
	source.cues.forEach((cue, i) => {
		const g = guesses[i];
		const group = bySpeaker.get(g.speaker) ?? [];
		group.push({ cue, purity: g.purity });
		bySpeaker.set(g.speaker, group);
	});
	const talk = (xs: { cue: Cue }[]) => xs.reduce((n, x) => n + x.cue.end - x.cue.start, 0);
	const groups = [...bySpeaker.values()].sort((a, b) => talk(b) - talk(a));
	let unsure = 0;
	const tracks: Track[] = groups.map((group, k) => ({
		...source,
		id: newId('trk'),
		name: `Speaker ${k + 1}`,
		color: colors[k % colors.length],
		solo: false,
		cues: group.map(({ cue, purity }) => {
			const { speakerUnsure: _, ...rest } = cue;

			if (purity >= UNSURE_BELOW) return rest;

			unsure++;

			return { ...rest, speakerUnsure: true };
		}),
	}));
	const samples = groups.map((group) => clearest(group).id);

	return { tracks, samples, unsure };
}

/** The most single-speaker cue, preferring ones long enough to recognise a voice */
function clearest(group: { cue: Cue; purity: number }[]): Cue {
	const score = ({ cue, purity }: { cue: Cue; purity: number }) =>
		purity * Math.min(1, (cue.end - cue.start) / 2500);

	return group.reduce((a, b) => (score(b) > score(a) ? b : a)).cue;
}
