import { cueText } from '../../core/model/cue';
import { Cue, CueId, Ms, Track } from '../../core/model/types';
import { Problem } from '../../core/lint/rules';
import { formatClock, formatTimecode } from '../../core/time/timecode';
import { AudioWaveform, PEAKS_PER_SECOND } from '../../state/audio-peaks';

/** Vertical layout of the lanes canvas; the track header column mirrors it. */
export const RULER_H = 24;
export const LANES_TOP = 28;
export const LANE_H = 56;
export const LANE_GAP = 4;
export const CUE_INSET = 4;
export const AUDIO_H = 48;

export const laneY = (i: number) => LANES_TOP + i * (LANE_H + LANE_GAP);

export interface Palette {
	bg: string;
	panel: string;
	text: string;
	onTrack: string;
	faded: string;
	border: string;
	brand: string;
	warning: string;
	danger: string;
	info: string;
}

export function readPalette(el: Element): Palette {
	const s = getComputedStyle(el);
	const v = (name: string) => s.getPropertyValue(name).trim();
	return {
		bg: v('--color-bg'),
		panel: v('--color-panel'),
		text: v('--color-text'),
		onTrack: v('--color-on-track'),
		faded: v('--color-text-faded'),
		border: v('--color-control-border'),
		brand: v('--color-brand'),
		warning: v('--color-warning'),
		danger: v('--color-danger'),
		info: v('--color-info'),
	};
}

export interface View {
	/** Time at the left edge. */
	start: Ms;
	pxPerMs: number;
	width: number;
	height: number;
	/** Vertical scroll of the lanes (the ruler stays put). */
	scrollY: number;
}

/** Total height of the lanes below the ruler, for vertical scrolling. */
export const contentHeight = (trackCount: number) =>
	LANES_TOP + trackCount * (LANE_H + LANE_GAP) + AUDIO_H;

export const msToX = (v: View, ms: Ms) => (ms - v.start) * v.pxPerMs;
export const xToMs = (v: View, x: number) => v.start + x / v.pxPerMs;

export interface PaintInput {
	view: View;
	palette: Palette;
	tracks: Track[];
	selection: ReadonlySet<CueId>;
	problems: Map<CueId, Problem[]>;
	playhead: Ms;
	duration: Ms;
	fps: number;
	/** Ruler labels in milliseconds instead of frames. */
	msLabels: boolean;
	snapAt: Ms | null;
	box: { x0: number; y0: number; x1: number; y1: number } | null;
	/** Edge being trimmed, with its time before the drag. */
	trim: { cueId: CueId; edge: 'start' | 'end'; original: Ms } | null;
	audio: AudioWaveform;
	/** In/out range (I / O). */
	range: { start: Ms; end: Ms } | null;
	/** Markers in time order, with their flag colors. */
	markers: { at: Ms; color: string; selected: boolean }[];
}

/** Ruler steps (ms); the major step is the smallest one leaving room for a timecode label. */
const STEPS = [
	200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
	1_800_000,
];
const MIN_LABEL_PX = 200;

function paintWaveform(ctx: CanvasRenderingContext2D, input: PaintInput, mid: number): void {
	const { view: v, palette: c, audio } = input;
	if (audio.status !== 'ready') {
		const label =
			audio.status === 'loading'
				? 'Reading audio…'
				: audio.status === 'error'
					? audio.message
					: null;
		if (label) {
			ctx.fillStyle = audio.status === 'error' ? c.danger : c.faded;
			ctx.fillText(label, 8, mid);
		} else {
			ctx.fillStyle = c.border;
			ctx.fillRect(0, Math.round(mid), Math.max(0, msToX(v, input.duration)), 1);
		}
		return;
	}
	const { peaks } = audio;
	const perMs = PEAKS_PER_SECOND / 1000;
	const full = AUDIO_H - 8;
	ctx.fillStyle = c.border;
	// One 2px bar every 3px, showing the loudest peak in its time slice.
	for (let x = 0; x < v.width; x += 3) {
		const i0 = Math.max(0, Math.floor(xToMs(v, x) * perMs));
		if (i0 >= peaks.length) break;
		const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(xToMs(v, x + 3) * perMs)));
		let loudest = 0;
		for (let i = i0; i < i1; i++) if (peaks[i] > loudest) loudest = peaks[i];
		// Square root so quiet speech is still visible next to loud music.
		const h = Math.max(1, Math.sqrt(loudest / 255) * full);
		ctx.fillRect(x, mid - h / 2, 2, h);
	}
}

export function paintTimeline(ctx: CanvasRenderingContext2D, input: PaintInput): void {
	const { view: v, palette: c, tracks } = input;
	ctx.clearRect(0, 0, v.width, v.height);
	const t0 = v.start;
	const t1 = xToMs(v, v.width);
	const range = input.range && {
		x0: Math.round(msToX(v, input.range.start)),
		x1: Math.round(msToX(v, input.range.end)),
	};

	// In/out range band behind the ruler ticks.
	if (range) {
		ctx.fillStyle = c.brand;
		ctx.globalAlpha = 0.28;
		ctx.fillRect(range.x0, 0, range.x1 - range.x0, RULER_H);
		ctx.globalAlpha = 1;
	}

	// Ruler
	const major = STEPS.find((s) => s * v.pxPerMs >= MIN_LABEL_PX) ?? STEPS.at(-1)!;
	const minor = major / (String(major)[0] === '2' ? 4 : 5);
	ctx.fillStyle = c.border;
	for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
		const x = Math.round(msToX(v, t));
		const isMajor = Math.round(t / minor) % Math.round(major / minor) === 0;
		if (isMajor) ctx.fillRect(x, 14, 1, 10);
		else ctx.fillRect(x, 19, 1, 5);
	}
	ctx.fillStyle = c.faded;
	ctx.font = '12px "Space Mono", monospace';
	ctx.textBaseline = 'top';
	for (let t = Math.floor(t0 / major) * major; t <= t1; t += major) {
		const label = input.msLabels ? formatClock(t) : formatTimecode(t, input.fps);
		ctx.fillText(label, Math.round(msToX(v, t)) + 4, 2);
	}

	// Lanes scroll vertically under the fixed ruler.
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, LANES_TOP, v.width, v.height - LANES_TOP);
	ctx.clip();

	// Lanes, then the in/out tint over them, then cues and the waveform on top.
	const ay = laneY(tracks.length) - v.scrollY;
	ctx.fillStyle = c.panel;
	tracks.forEach((_, i) => ctx.fillRect(0, laneY(i) - v.scrollY, v.width, LANE_H));
	ctx.fillRect(0, ay, v.width, AUDIO_H);
	if (range) {
		ctx.fillStyle = c.brand;
		ctx.globalAlpha = 0.08;
		ctx.fillRect(range.x0, LANES_TOP, range.x1 - range.x0, v.height - LANES_TOP);
		ctx.globalAlpha = 1;
	}
	ctx.font = '500 12px "Inter Variable", Inter, sans-serif';
	ctx.textBaseline = 'middle';
	tracks.forEach((track, i) => {
		const y = laneY(i) - v.scrollY;
		for (const cue of track.cues) {
			if (cue.end < t0 || cue.start > t1) continue;
			paintCue(ctx, input, track, cue, y + CUE_INSET);
		}
	});
	// Audio lane: the video's waveform, mirrored around the middle.
	paintWaveform(ctx, input, ay + AUDIO_H / 2);
	ctx.restore();

	// In/out edges down the lanes, with a grip for each in the ruler.
	if (range) {
		ctx.fillStyle = c.brand;
		ctx.globalAlpha = 0.7;
		ctx.fillRect(range.x0, 0, 1, v.height);
		ctx.fillRect(range.x1 - 1, 0, 1, v.height);
		ctx.globalAlpha = 1;
		ctx.beginPath();
		ctx.roundRect(range.x0, 0, 4, RULER_H, [2, 0, 0, 2]);
		ctx.roundRect(range.x1 - 4, 0, 4, RULER_H, [0, 2, 2, 0]);
		ctx.fill();
	}

	paintMarkers(ctx, input);

	// Snap guide: dashed brand line at what the edge snapped to.
	if (input.snapAt !== null) {
		const x = Math.round(msToX(v, input.snapAt)) + 0.5;
		ctx.strokeStyle = c.brand;
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(x, RULER_H);
		ctx.lineTo(x, v.height);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Box selection: faint fill, dashed outline.
	if (input.box) {
		const { x0, y0, x1, y1 } = input.box;
		const bx = Math.min(x0, x1),
			by = Math.min(y0, y1),
			bw = Math.abs(x1 - x0),
			bh = Math.abs(y1 - y0);
		ctx.fillStyle = c.text;
		ctx.globalAlpha = 0.06;
		roundRect(ctx, bx, by, bw, bh, 2);
		ctx.fill();
		ctx.globalAlpha = 0.8;
		ctx.strokeStyle = c.text;
		ctx.lineWidth = 1;
		ctx.setLineDash([6, 4]);
		roundRect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, 2);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}

	// Playhead: line plus a handle in the ruler
	const px = Math.round(msToX(v, input.playhead));
	if (px >= -6 && px <= v.width + 6) {
		ctx.fillStyle = c.brand;
		ctx.fillRect(px - 1, 6, 2, v.height - 6);
		roundRect(ctx, px - 6, 6, 12, 12, 2);
		ctx.fill();
	}
}

/** Markers: a flag on the ruler and a faint line down the lanes; the selected one brighter. */
function paintMarkers(ctx: CanvasRenderingContext2D, input: PaintInput): void {
	const { view: v, palette: c } = input;
	for (const m of input.markers) {
		const x = Math.round(msToX(v, m.at));
		if (x < -6 || x > v.width + 6) continue;
		ctx.fillStyle = m.color;
		ctx.globalAlpha = m.selected ? 0.8 : 0.35;
		ctx.fillRect(x, RULER_H, 1, v.height - RULER_H);
		ctx.globalAlpha = 1;
		// 11 × 13 flag pointing down at the time, its tip on the ruler's bottom edge.
		ctx.beginPath();
		ctx.moveTo(x - 5, 11);
		ctx.lineTo(x + 6, 11);
		ctx.lineTo(x + 6, 19);
		ctx.lineTo(x + 0.5, RULER_H);
		ctx.lineTo(x - 5, 19);
		ctx.closePath();
		ctx.fill();
		if (m.selected) {
			ctx.strokeStyle = c.text;
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}
	}
}

function paintCue(
	ctx: CanvasRenderingContext2D,
	input: PaintInput,
	track: Track,
	cue: Cue,
	y: number,
): void {
	const { view: v, palette: c } = input;
	const x0 = msToX(v, cue.start);
	const x1 = msToX(v, cue.end);
	const w = Math.max(2, x1 - x0);
	const h = LANE_H - CUE_INSET * 2;
	ctx.globalAlpha = track.muted ? 0.4 : 1;
	ctx.fillStyle = track.color;
	roundRect(ctx, x0, y, w, h, 4);
	ctx.fill();

	if (w > 24) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(x0 + 8, y, w - 16, h);
		ctx.clip();
		ctx.fillStyle = c.onTrack;
		ctx.fillText(cueText(cue).replace(/\n/g, ' '), Math.max(x0, 0) + 8, y + h / 2);
		ctx.restore();
	}
	ctx.globalAlpha = 1;

	const problems = input.problems.get(cue.id);
	const stroke = input.selection.has(cue.id)
		? c.text
		: problems?.some((p) => p.severity === 'error')
			? c.danger
			: problems?.length
				? c.warning
				: null;
	if (stroke && w > 4) {
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 2;
		roundRect(ctx, x0 + 1, y + 1, w - 2, h - 2, 3);
		ctx.stroke();
	}

	// Trimming: brand handle on the dragged edge, dashed line where it started.
	const trim = input.trim;
	if (trim?.cueId === cue.id) {
		const ex = trim.edge === 'start' ? x0 : x1 - 4;
		ctx.fillStyle = c.brand;
		roundRect(ctx, ex, y, 4, h, 2);
		ctx.fill();
		const ox = Math.round(msToX(v, trim.original)) + 0.5;
		ctx.strokeStyle = c.text;
		ctx.globalAlpha = 0.5;
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(ox, y);
		ctx.lineTo(ox, y + h);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath();
	// A zero-size box (box select before it moves) would give a negative radius, which throws.
	ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}
