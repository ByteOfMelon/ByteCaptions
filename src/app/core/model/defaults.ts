import {
	CaptionStyle,
	Cue,
	Position,
	Project,
	ProjectSettings,
	SCHEMA_VERSION,
	Track,
} from './types';

let counter = 0;

/** Short unique id. Uses crypto.randomUUID when available. */
export function newId(prefix: string): string {
	const rand =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID().slice(0, 8)
			: Math.random().toString(36).slice(2, 10);
	return `${prefix}_${rand}${(counter++).toString(36)}`;
}

export const DEFAULT_STYLE_ID = 'style_default';
export const DEFAULT_POSITION_ID = 'pos_bottom';

/** Matches YouTube's own default caption look. */
export function defaultStyle(): CaptionStyle {
	return {
		name: 'Default',
		font: 'default',
		scale: 1,
		bold: false,
		italic: false,
		underline: false,
		offset: 'regular',
		textColor: '#FFFFFF',
		textOpacity: 1,
		bgColor: '#080808',
		bgOpacity: 0.75,
		edge: 'none',
		edgeColor: '#222222',
	};
}

export function defaultPosition(): Position {
	return {
		name: 'Bottom center',
		anchor: 7,
		x: 50,
		y: 100,
		align: 'center',
		direction: 'horizontal',
	};
}

export function defaultSettings(): ProjectSettings {
	return {
		maxCharsPerLine: 42,
		maxLines: 2,
		minDurationMs: 700,
		maxDurationMs: 7000,
		minGapMs: 80,
		maxCps: 20,
	};
}

export function createTrack(name: string, color = '#4F8CFF'): Track {
	return {
		id: newId('trk'),
		name,
		color,
		defaultStyleId: DEFAULT_STYLE_ID,
		defaultPositionId: DEFAULT_POSITION_ID,
		muted: false,
		locked: false,
		solo: false,
		cues: [],
	};
}

export function createCue(start: number, end: number, text: string): Cue {
	return { id: newId('cue'), start, end, runs: [{ text }] };
}

export function createProject(name = 'Untitled'): Project {
	return {
		schemaVersion: SCHEMA_VERSION,
		id: newId('prj'),
		name,
		media: null,
		fps: 30,
		tracks: [createTrack('Captions')],
		styles: { [DEFAULT_STYLE_ID]: defaultStyle() },
		positions: { [DEFAULT_POSITION_ID]: defaultPosition() },
		settings: defaultSettings(),
	};
}
