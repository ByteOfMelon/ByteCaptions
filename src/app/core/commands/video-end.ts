import { Draft } from 'immer';
import { Project } from '../model/types';

/**
 * After an edit, pull back any cue end it pushed past the end of the video
 */
export function keepInVideo(before: Project, p: Draft<Project>): void {
	const videoEnd = p.media?.durationMs;

	if (!videoEnd) return;

	const previousEnd = new Map(before.tracks.flatMap((t) => t.cues.map((c) => [c.id, c.end])));

	for (const t of p.tracks)
		for (const c of t.cues) {
			const limit = Math.max(videoEnd, previousEnd.get(c.id) ?? 0);

			// A cue that starts after the limit can't be shortened to fit, so it's left alone
			if (c.end > limit && c.start < limit) c.end = limit;
		}
}
