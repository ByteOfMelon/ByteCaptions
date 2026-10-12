/**
 * Live, non-blocking quality checks. Pure functions over the project; the app shows results as badges on cues and in the Problems tab.
 */
import { cueText, textWidth } from '../model/cue';
import { Cue, CueId, Ms, Project, Track, TrackId } from '../model/types';

export type Severity = 'error' | 'warning';

export type ProblemKind =
	'overlap' | 'cps' | 'tooShort' | 'tooLong' | 'lineLength' | 'tooManyLines' | 'gap' | 'speaker';

/** Any quick fix the app can offer */
export type ProblemFix =
	| { kind: 'setTiming'; label: string; start: Ms; end: Ms }
	| { kind: 'split'; label: string }
	| { kind: 'confirmSpeaker'; label: string };

export interface Problem {
	kind: ProblemKind;
	severity: Severity;
	trackId: TrackId;
	cueId: CueId;
	message: string;
	fix?: ProblemFix;
	/** For an overlap: the cue it overlaps (on the same track) */
	otherCueId?: CueId;
}

/** Characters per second, ignoring line breaks */
export function readingSpeed(cue: Cue): number {
	const seconds = (cue.end - cue.start) / 1000;

	if (seconds <= 0) return Infinity;

	return cueText(cue).replace(/\n/g, '').length / seconds;
}

/**
 * Reading speed for display
 */
export function formatCps(cps: number): string {
	return String(Math.ceil(cps * 10 - 1e-9) / 10);
}

export function lintTrack(project: Project, track: Track): Problem[] {
	const s = project.settings;
	const out: Problem[] = [];
	const add = (
		cue: Cue,
		kind: ProblemKind,
		severity: Severity,
		message: string,
		fix?: ProblemFix,
		otherCueId?: CueId,
	) =>
		out.push({
			kind,
			severity,
			trackId: track.id,
			cueId: cue.id,
			message,
			fix,
			...(otherCueId && { otherCueId }),
		});

	track.cues.forEach((cue, i) => {
		const next = track.cues[i + 1];
		const dur = cue.end - cue.start;
		const text = cueText(cue);

		if (next && next.start < cue.end) {
			add(
				cue,
				'overlap',
				'error',
				'Overlaps the next cue',
				{ kind: 'setTiming', label: 'Trim to next cue', start: cue.start, end: next.start },
				next.id,
			);
		} else if (next && next.start - cue.end < s.minGapMs) {
			add(cue, 'gap', 'warning', `Gap to next cue under ${s.minGapMs} ms`);
		}

		const cps = readingSpeed(cue);

		if (text.trim() && cps > s.maxCps) {
			const neededEnd =
				cue.start + Math.ceil((text.replace(/\n/g, '').length / s.maxCps) * 1000);
			const room = next ? next.start - s.minGapMs : Infinity;
			add(
				cue,
				'cps',
				'warning',
				`Reading speed ${Math.round(cps)} cps (max ${s.maxCps})`,
				neededEnd <= room
					? {
							kind: 'setTiming',
							label: 'Extend to fit',
							start: cue.start,
							end: neededEnd,
						}
					: undefined,
			);
		}

		if (dur < s.minDurationMs) {
			const end = cue.start + s.minDurationMs;
			const room = next ? next.start - s.minGapMs : Infinity;
			add(
				cue,
				'tooShort',
				'warning',
				`Shorter than ${s.minDurationMs / 1000}s`,
				end <= room
					? { kind: 'setTiming', label: 'Extend to minimum', start: cue.start, end }
					: undefined,
			);
		} else if (dur > s.maxDurationMs) {
			add(cue, 'tooLong', 'warning', `Longer than ${s.maxDurationMs / 1000}s`, {
				kind: 'split',
				label: 'Split in half',
			});
		}

		const lines = text.split('\n');

		if (lines.length > s.maxLines) {
			add(cue, 'tooManyLines', 'warning', `${lines.length} lines (max ${s.maxLines})`);
		}

		// Full-width characters (Chinese, Japanese, Korean) count as two
		const longest = Math.max(...lines.map((l) => textWidth(l)));

		if (longest > s.maxCharsPerLine) {
			add(
				cue,
				'lineLength',
				'warning',
				`Line is ${longest} characters (max ${s.maxCharsPerLine})`,
			);
		}

		if (cue.speakerUnsure) {
			add(cue, 'speaker', 'warning', `Might not be ${track.name}'s line`, {
				kind: 'confirmSpeaker',
				label: 'Mark as checked',
			});
		}
	});

	return out;
}

export function lintProject(project: Project): Problem[] {
	return project.tracks.flatMap((t) => lintTrack(project, t));
}
