import { Ms, Track, TrackId } from '../model/types';

/** A cue to paste */
export interface PasteItem {
	track: TrackId;
	start: Ms;
	end: Ms;
}

/**
 * Determines where each pasted cue goes
 */
export function planPaste(
	items: readonly PasteItem[],
	tracks: readonly Track[],
	at: Ms,
): { start: Ms; end: Ms }[] {
	const cuesOn = (id: TrackId) => tracks.find((t) => t.id === id)?.cues ?? [];
	const startsInGap = items.every(
		(i) => !cuesOn(i.track).some((c) => c.start <= at + i.start && c.end > at + i.start),
	);

	if (startsInGap)
		return items.map((i) => {
			const start = at + i.start;
			const next = Math.min(
				...cuesOn(i.track)
					.filter((c) => c.start >= start)
					.map((c) => c.start),
			);

			return { start, end: Math.min(at + i.end, next) };
		});

	const start = firstFit(items, cuesOn, at);

	return items.map((i) => ({ start: start + i.start, end: start + i.end }));
}

/** The earliest time from "at" where the paste fits without trimming anything */
function firstFit(
	items: readonly PasteItem[],
	cuesOn: (id: TrackId) => readonly { start: Ms; end: Ms }[],
	at: Ms,
): Ms {
	let start = at;

	// Each pass moves past at least one cue, so this ends once nothing is in the way
	for (let pass = 0; pass < 10_000; pass++) {
		let next = start;

		for (const item of items) {
			const s = start + item.start;
			const e = start + item.end;

			for (const c of cuesOn(item.track))
				if (c.start < e && c.end > s) next = Math.max(next, start + c.end - s);
		}

		if (next === start) return start;

		start = next;
	}

	return start;
}
