import { cueText, resolvePosition, resolveStyle, visibleTracks } from '../model/cue';
import { CaptionStyle, Cue, Position, Project, TrackId } from '../model/types';

/** A cue with its track defaults resolved */
export interface FlatCue {
	trackId: TrackId;
	cue: Cue;
	text: string;
	style: CaptionStyle;
	position: Position;
}

/** All visible cues across tracks, sorted by start time */
export function flatten(project: Project): FlatCue[] {
	const out: FlatCue[] = [];
	for (const track of visibleTracks(project)) {
		for (const cue of track.cues) {
			out.push({
				trackId: track.id,
				cue,
				text: cueText(cue),
				style: resolveStyle(project, track, cue),
				position: resolvePosition(project, track, cue),
			});
		}
	}
	return out.sort((a, b) => a.cue.start - b.cue.start || a.cue.end - b.cue.end);
}

/** Result of parsing a caption file into plain cues for one track */
export interface ImportResult {
	cues: Cue[];
	/** New styles/positions discovered (SRV3). Keyed by generated ids. */
	styles?: Record<string, CaptionStyle>;
	positions?: Record<string, Position>;
	/** warnings about anything that couldn't be represented */
	warnings: string[];
}

export function normalizeNewlines(s: string): string {
	return s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
