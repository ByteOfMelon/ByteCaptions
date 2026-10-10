/**
 * ByteCaptions document model
 */

/** All times are integer milliseconds */
export type Ms = number;

export type TrackId = string;
export type CueId = string;
export type StyleId = string;
export type PosId = string;
export type MarkerId = string;

export const SCHEMA_VERSION = 1;

export interface Project {
	schemaVersion: number;
	id: string;
	name: string;
	media: MediaRef | null;
	fps: number;
	/** Ordered top to bottom as shown in the timeline */
	tracks: Track[];
	styles: Record<StyleId, CaptionStyle>;
	positions: Record<PosId, Position>;
	settings: ProjectSettings;
	transcript?: TranscriptMeta;
	/** Editor notes pinned to times (not part of final export) */
	markers: Marker[];
}

export type MarkerColor = 'yellow' | 'red' | 'blue' | 'purple' | 'green';

export interface Marker {
	id: MarkerId;
	at: Ms;
	note: string;
	color: MarkerColor;
}

export interface MediaRef {
	path: string;
	hash: string;
	durationMs: Ms;
	width: number;
	height: number;
}

export interface Track {
	id: TrackId;
	name: string;
	color: string;
	defaultStyleId: StyleId;
	defaultPositionId: PosId;
	/** Excluded from preview and export */
	muted: boolean;
	locked: boolean;
	solo: boolean;
	/** Kept sorted by start time */
	cues: Cue[];
}

export interface Cue {
	id: CueId;
	start: Ms;
	end: Ms;
	runs: TextRun[];
	/** Overrides the track default */
	styleId?: StyleId;
	/** Overrides the track default */
	positionId?: PosId;
	/** Word timings from transcription */
	words?: WordTiming[];
	karaoke?: boolean;
	/** Color of already-sung words in karaoke (#RRGGBB), defaults to yellow */
	karaokeColor?: string;
	/** Used when the speaker separation model isn't sure whose line this was */
	speakerUnsure?: boolean;
}

export interface TextRun {
	text: string;
	styleOverride?: Partial<CaptionStyle>;
	/** Ruby annotation shown above this run */
	ruby?: string;
}

export interface WordTiming {
	text: string;
	start: Ms;
	end: Ms;
	confidence?: number;
}

/**
 * YouTube's fixed font families (SRV3 fs attribute). Custom fonts are not supported by YouTube
 */
export type YtFont =
	| 'default' // 0: Roboto (proportional sans)
	| 'monoSerif' // 1: Courier New
	| 'propSerif' // 2: Times New Roman
	| 'monoSans' // 3: Lucida Console / Deja Vu Sans Mono
	| 'propSans' // 4: Roboto
	| 'casual' // 5: Comic Sans MS
	| 'cursive' // 6: Monotype Corsiva
	| 'smallCaps'; // 7: Carrois Gothic SC

export type EdgeType = 'none' | 'hardShadow' | 'bevel' | 'glow' | 'softShadow';

export type TextOffset = 'subscript' | 'regular' | 'superscript';

/** Maps onto an SRV3 <pen>. */
export interface CaptionStyle {
	name: string;
	font: YtFont;
	/**
	 * Visual scale as rendered by YouTube (1 = 100%). YouTube compresses the scale written in the file; the exporter handles that conversion. Minimum renderable value is 0.75
	 */
	scale: number;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	offset: TextOffset;
	/** Hex color format */
	textColor: string;
	/** 0–1 */
	textOpacity: number;
	bgColor: string;
	bgOpacity: number;
	edge: EdgeType;
	edgeColor: string;
}

/** 3×3 grid, row-major, top-left = 0 ... bottom-right = 8. Same IDs as SRV3 ap */
export type Anchor = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type TextDirection = 'horizontal' | 'verticalRtl' | 'verticalLtr';

/** Maps onto an SRV3 <wp> (window position) + <ws> (window style) */
export interface Position {
	name: string;
	anchor: Anchor;
	/** 0–100, expressed as a percent of the video frame where it's actually displayed */
	x: number;
	y: number;
	align: 'left' | 'center' | 'right';
	direction: TextDirection;
}

export interface ProjectSettings {
	maxCharsPerLine: number;
	maxLines: number;
	minDurationMs: Ms;
	maxDurationMs: Ms;
	/** Minimum gap between consecutive cues on a track */
	minGapMs: Ms;
	/** Max reading speed (characters per second) */
	maxCps: number;
}

export interface TranscriptMeta {
	engine: string;
	model: string;
	language: string;
	createdAt: string;
}
