/**
 * Editing operations. Each is an Immer recipe factory: `edits.x(...)` returns
 * a function that mutates a Project draft. Run them through `History.apply()`.
 */
import { Draft } from 'immer';
import { createCue, newId } from '../model/defaults';
import { cueText, joinWords, sortCues, wordGap } from '../model/cue';
import { retimeWords, spreadWords, splitWords } from '../model/words';
import { normalizeRuns, replaceText, splitRuns, styleRange, trimRuns } from '../model/runs';
import {
	CaptionStyle,
	Cue,
	CueId,
	Marker,
	MarkerId,
	Ms,
	Project,
	Track,
	TrackId,
	WordTiming,
} from '../model/types';

type P = Draft<Project>;

function findTrack(p: P, trackId: TrackId): Draft<Track> {
	const t = p.tracks.find((t) => t.id === trackId);
	if (!t) throw new Error(`Track not found: ${trackId}`);
	return t;
}

function findCue(p: P, cueId: CueId): { track: Draft<Track>; index: number; cue: Draft<Cue> } {
	for (const track of p.tracks) {
		const index = track.cues.findIndex((c) => c.id === cueId);
		if (index >= 0) return { track, index, cue: track.cues[index] };
	}
	throw new Error(`Cue not found: ${cueId}`);
}

function assertUnlocked(track: Draft<Track>): void {
	if (track.locked) throw new Error(`Track is locked: ${track.name}`);
}

export function addCue(trackId: TrackId, cue: Cue) {
	return (p: P) => {
		const track = findTrack(p, trackId);
		assertUnlocked(track);
		track.cues.push(cue);
		sortCues(track.cues);
	};
}

export function deleteCues(ids: CueId[]) {
	return (p: P) => {
		const set = new Set(ids);
		for (const t of p.tracks) {
			if (t.locked) continue;
			t.cues = t.cues.filter((c) => !set.has(c.id));
		}
	};
}

/**
 * Delete cues and close the time they took up: later cues on the same track move earlier by
 * however much deleted time came before them. Other tracks are left alone.
 */
export function rippleDeleteCues(ids: CueId[]) {
	return (p: P) => {
		const set = new Set(ids);
		for (const t of p.tracks) {
			if (t.locked) continue;
			const removed = t.cues.filter((c) => set.has(c.id));
			if (!removed.length) continue;
			t.cues = t.cues.filter((c) => !set.has(c.id));
			// Deleted time before `ms`, counting overlapping deleted cues once.
			const before = (ms: Ms) => {
				let total = 0;
				let reached = 0;
				for (const c of [...removed].sort((a, b) => a.start - b.start)) {
					const s = Math.max(c.start, reached);
					const e = Math.min(c.end, ms);
					if (e > s) total += e - s;
					reached = Math.max(reached, c.end);
				}
				return total;
			};
			for (const c of t.cues) {
				const d = Math.min(before(c.start), c.start);
				if (!d) continue;
				c.start -= d;
				c.end -= d;
				c.words?.forEach((w) => {
					w.start -= d;
					w.end -= d;
				});
			}
			sortCues(t.cues);
		}
	};
}

export function setText(cueId: CueId, text: string) {
	return (p: P) => {
		const { track, cue } = findCue(p, cueId);
		assertUnlocked(track);
		// Formatting stays on the text that didn't change.
		cue.runs = replaceText(cue.runs, text);
		// Word timings follow the edit: unchanged words keep theirs.
		if (cue.words) {
			const words = retimeWords(cue.words, text, cue.start, cue.end);
			if (words) cue.words = words;
			else {
				delete cue.words;
				delete cue.karaoke;
			}
		}
	};
}

/**
 * Format characters [from, to) of a cue: merge `change` into their style overrides (undefined
 * removes one), or 'clear' to remove all formatting there.
 */
export function styleText(
	cueId: CueId,
	from: number,
	to: number,
	change: Partial<CaptionStyle> | 'clear',
) {
	return (p: P) => {
		const { track, cue } = findCue(p, cueId);
		assertUnlocked(track);
		cue.runs = styleRange(cue.runs, from, to, change);
	};
}

/** Replace a cue's word timings (dragging a word edge, tapping). */
export function setWords(cueId: CueId, words: WordTiming[]) {
	return (p: P) => {
		const { track, cue } = findCue(p, cueId);
		assertUnlocked(track);
		cue.words = words;
	};
}

/** Give a cue's words timings by sharing its time out by word length. */
export function spreadCueWords(cueId: CueId) {
	return (p: P) => {
		const { track, cue } = findCue(p, cueId);
		assertUnlocked(track);
		const words = splitWords(cueText(cue));
		if (words.length) cue.words = spreadWords(words, cue.start, cue.end);
	};
}

/**
 * Karaoke on or off, and the colour of sung words. Turning it on for a cue without word
 * timings spreads its words evenly first.
 */
export function setKaraoke(ids: CueId[], changes: { on?: boolean; color?: string }) {
	return (p: P) => {
		for (const id of ids) {
			const { track, cue } = findCue(p, id);
			if (track.locked) continue;
			if (changes.color !== undefined) cue.karaokeColor = changes.color;
			if (changes.on === false) delete cue.karaoke;
			else if (changes.on) {
				const words = splitWords(cueText(cue));
				if (!words.length) continue;
				cue.words ??= spreadWords(words, cue.start, cue.end);
				cue.karaoke = true;
			}
		}
	};
}

export function clearWords(cueId: CueId) {
	return (p: P) => {
		const { track, cue } = findCue(p, cueId);
		assertUnlocked(track);
		delete cue.words;
		delete cue.karaoke;
	};
}

/** Set start/end. Clamps to >= 0 and keeps at least 1ms duration. */
export function setTiming(cueId: CueId, start: Ms, end: Ms) {
	return (p: P) => {
		const { track, cue } = findCue(p, cueId);
		assertUnlocked(track);
		const s = Math.max(0, Math.round(start));
		const e = Math.max(s + 1, Math.round(end));
		const ds = s - cue.start;
		const sameDuration = e - s === cue.end - cue.start;
		cue.start = s;
		cue.end = e;
		// A pure move carries word timings along; trims leave them in place.
		if (cue.words && ds !== 0 && sameDuration) {
			for (const w of cue.words) {
				w.start += ds;
				w.end += ds;
			}
		}
		sortCues(track.cues);
	};
}

/** Move cues by an offset, optionally to another track. */
export function moveCues(ids: CueId[], deltaMs: Ms, toTrackId?: TrackId) {
	return (p: P) => {
		const target = toTrackId ? findTrack(p, toTrackId) : undefined;
		if (target) assertUnlocked(target);
		const touched = new Set<Draft<Track>>();
		for (const id of ids) {
			const { track, index, cue } = findCue(p, id);
			assertUnlocked(track);
			const d = Math.max(deltaMs, -cue.start);
			cue.start += d;
			cue.end += d;
			cue.words?.forEach((w) => {
				w.start += d;
				w.end += d;
			});
			if (target && target !== track) {
				track.cues.splice(index, 1);
				target.cues.push(cue);
				// Moving a line to another speaker's track settles whose it is.
				delete cue.speakerUnsure;
			}
			touched.add(track);
			if (target) touched.add(target);
		}
		touched.forEach((t) => sortCues(t.cues));
	};
}

/** Clear the unsure-speaker flag: the cues are on the right speaker's track. */
export function confirmSpeaker(ids: CueId[]) {
	return (p: P) => {
		for (const id of ids) {
			const { track, cue } = findCue(p, id);
			assertUnlocked(track);
			delete cue.speakerUnsure;
		}
	};
}

/** Shift every cue starting at or after `fromMs` on all unlocked tracks. */
export function shiftAfter(fromMs: Ms, deltaMs: Ms) {
	return (p: P) => {
		for (const t of p.tracks) {
			if (t.locked) continue;
			for (const c of t.cues) {
				if (c.start < fromMs) continue;
				c.start = Math.max(0, c.start + deltaMs);
				c.end = Math.max(c.start + 1, c.end + deltaMs);
				c.words?.forEach((w) => {
					w.start += deltaMs;
					w.end += deltaMs;
				});
			}
			sortCues(t.cues);
		}
	};
}

/**
 * Split a cue at `atMs`. With word timings, words go to the side their
 * midpoint falls on; otherwise text is split by time ratio at a word boundary.
 * Returns the new right-hand cue's id via `out`.
 */
export function splitCue(cueId: CueId, atMs: Ms, out?: { rightId?: CueId }) {
	return (p: P) => {
		const { track, index, cue } = findCue(p, cueId);
		assertUnlocked(track);
		if (atMs <= cue.start || atMs >= cue.end) return;

		const text = cueText(cue);
		let leftRuns, rightRuns;
		let leftWords, rightWords;
		if (cue.words?.length) {
			leftWords = cue.words.filter((w) => (w.start + w.end) / 2 < atMs);
			rightWords = cue.words.filter((w) => (w.start + w.end) / 2 >= atMs);
			const leftText = joinWords(leftWords);
			// Keep formatting while the text is still exactly what the words say.
			if (text === joinWords(cue.words))
				[leftRuns, rightRuns] = splitRuns(cue.runs, leftText.length);
			else [leftRuns, rightRuns] = [[{ text: leftText }], [{ text: joinWords(rightWords) }]];
		} else {
			const ratio = (atMs - cue.start) / (cue.end - cue.start);
			const at = splitIndex(text, Math.round(text.length * ratio));
			[leftRuns, rightRuns] = splitRuns(cue.runs, at);
		}

		const right = createCue(atMs, cue.end, '');
		right.runs = rightRuns;
		right.id = out?.rightId ?? newId('cue');
		if (cue.styleId) right.styleId = cue.styleId;
		if (cue.positionId) right.positionId = cue.positionId;
		if (rightWords) right.words = rightWords.map((w) => ({ ...w }));
		if (cue.karaoke) right.karaoke = true;
		if (out) out.rightId = right.id;

		cue.end = atMs;
		cue.runs = leftRuns;
		if (leftWords) cue.words = leftWords;
		track.cues.splice(index + 1, 0, right);
	};
}

/** Where to split text near `idx`: the closest whitespace, else `idx` itself. */
function splitIndex(text: string, idx: number): number {
	let best = -1;
	for (let i = 0; i < text.length; i++) {
		if (/\s/.test(text[i]) && (best < 0 || Math.abs(i - idx) < Math.abs(best - idx))) best = i;
	}
	return best < 0 ? idx : best;
}

/** Split text near `idx`, preferring the closest whitespace. */
export function splitTextAt(text: string, idx: number): [string, string] {
	const best = splitIndex(text, idx);
	return [text.slice(0, best).trim(), text.slice(best).trim()];
}

/** Merge cues (must be on the same track) into the earliest one. */
export function mergeCues(ids: CueId[]) {
	return (p: P) => {
		if (ids.length < 2) return;
		const found = ids.map((id) => findCue(p, id));
		const track = found[0].track;
		if (found.some((f) => f.track !== track))
			throw new Error('Can only merge cues on the same track');
		assertUnlocked(track);
		const cues = found.map((f) => f.cue).sort((a, b) => a.start - b.start);
		const [first, ...rest] = cues;
		first.end = Math.max(...cues.map((c) => c.end));
		// Join with formatting kept: a space between cues (none for Chinese or Japanese), and
		// line breaks and runs of spaces become single spaces.
		const parts = cues.map((c) => trimRuns(c.runs));
		first.runs = normalizeRuns(
			parts.flatMap((runs, i) => {
				const flat = runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ') }));
				const prev = i ? parts[i - 1].map((r) => r.text).join('') : '';
				const gap = i ? wordGap(prev, flat.map((r) => r.text).join('')) : '';
				return gap ? [{ text: gap }, ...flat] : flat;
			}),
		);
		first.words = cues.every((c) => c.words) ? cues.flatMap((c) => c.words!) : undefined;
		if (!first.words) delete first.words;
		const drop = new Set(rest.map((c) => c.id));
		track.cues = track.cues.filter((c) => !drop.has(c.id));
	};
}

export function addTrack(track: Track, index?: number) {
	return (p: P) => {
		p.tracks.splice(index ?? p.tracks.length, 0, track);
	};
}

export function removeTrack(trackId: TrackId) {
	return (p: P) => {
		p.tracks = p.tracks.filter((t) => t.id !== trackId);
	};
}

export function updateTrack(trackId: TrackId, changes: Partial<Omit<Track, 'id' | 'cues'>>) {
	return (p: P) => {
		Object.assign(findTrack(p, trackId), changes);
	};
}

export function reorderTrack(trackId: TrackId, toIndex: number) {
	return (p: P) => {
		const from = p.tracks.findIndex((t) => t.id === trackId);
		if (from < 0) return;
		const [t] = p.tracks.splice(from, 1);
		p.tracks.splice(Math.max(0, Math.min(toIndex, p.tracks.length)), 0, t);
	};
}

// ---- Markers (anchored to video time, so cue edits never move them) ----

function sortMarkers(p: P): void {
	p.markers.sort((a, b) => a.at - b.at);
}

export function addMarker(marker: Marker) {
	return (p: P) => {
		p.markers.push(marker);
		sortMarkers(p);
	};
}

export function updateMarker(id: MarkerId, changes: Partial<Omit<Marker, 'id'>>) {
	return (p: P) => {
		const m = p.markers.find((m) => m.id === id);
		if (!m) throw new Error(`Marker not found: ${id}`);
		Object.assign(m, changes);
		sortMarkers(p);
	};
}

export function deleteMarker(id: MarkerId) {
	return (p: P) => {
		p.markers = p.markers.filter((m) => m.id !== id);
	};
}
