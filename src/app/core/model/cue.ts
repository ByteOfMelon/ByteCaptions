import { CaptionStyle, Cue, Position, Project, Track } from './types';

export function cueText(cue: Cue): string {
	return cue.runs.map((r) => r.text).join('');
}

export function sortCues(cues: Cue[]): void {
	cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Tracks that should appear in preview/export, honoring solo and mute. */
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
