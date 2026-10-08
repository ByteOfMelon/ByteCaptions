import {
	Component,
	DestroyRef,
	Directive,
	ElementRef,
	afterNextRender,
	computed,
	effect,
	inject,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import {
	LucideAudioLines,
	LucideEye,
	LucideEyeOff,
	LucideHeadphones,
	LucideLock,
	LucideLockOpen,
	LucideMagnet,
	LucideScissors,
	LucideZoomIn,
	LucideZoomOut,
} from '@lucide/angular';
import { setTiming, moveCues, updateTrack } from '../../core/commands/edits';
import { CueId, Ms, Track, TrackId } from '../../core/model/types';
import { formatClock, formatTimecode } from '../../core/time/timecode';
import { EditorUi, TimelineZoom } from '../../state/editor-ui';
import { ProjectStore } from '../../state/project-store';
import { AudioPeaks } from '../../state/audio-peaks';
import { ThemeService } from '../../theme/theme.service';
import { IconButton } from '../../ui/button/button';
import { Tooltip } from '../../ui/tooltip/tooltip';
import { EditorCommands } from '../editor/editor-commands';
import { Playback } from '../player/playback';
import { StyleChip } from '../player/style-chip';
import {
	CUE_INSET,
	LANE_GAP,
	LANE_H,
	LANES_TOP,
	RULER_H,
	View,
	contentHeight,
	laneY,
	msToX,
	paintTimeline,
	readPalette,
	xToMs,
} from './timeline-paint';
import { TimelineMenus } from './timeline-menus';

const EDGE_PX = 6;
const SNAP_PX = 8;
/** Zoom range in pixels per second; the slider maps 0–100 logarithmically onto it. */
const MIN_PX_PER_S = 2;
const MAX_PX_PER_S = 800;

type Hit =
	| { kind: 'ruler' }
	| { kind: 'cue'; track: Track; trackIndex: number; cueId: CueId; edge: 'start' | 'end' | null }
	| { kind: 'lane'; track: Track; trackIndex: number }
	| { kind: 'none' };

type Drag =
	| { mode: 'scrub' }
	| {
			mode: 'move';
			downX: number;
			downY: number;
			downMs: Ms;
			anchor: CueId;
			orig: Map<CueId, { start: Ms; end: Ms }>;
			trackId: TrackId;
			moved: boolean;
			clickSelect: CueId | null;
	  }
	| { mode: 'trim'; cueId: CueId; edge: 'start' | 'end'; start: Ms; end: Ms; original: Ms }
	| { mode: 'box'; x0: number; y0: number; base: ReadonlySet<CueId>; moved: boolean };

/** Focuses and selects an input when it appears (inline rename). */
@Directive({ selector: 'input[bcAutoselect]' })
class AutoSelect {
	constructor() {
		const el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
		afterNextRender(() => (el.focus(), el.select()));
	}
}

/** Floating label over the lanes while dragging (Interactions board). */
interface Hud {
	text: string;
	x: number;
	y: number;
	/** Which side of `x` the label sits on. */
	align: 'left' | 'right';
}

/**
 * Canvas timeline (PLAN §5.2): ruler, one lane per track, a waveform lane and the playhead.
 * Drag a cue to move it (vertically to change track), drag its edges to trim, drag empty
 * lane space to box-select. Wheel scrolls; Shift+wheel (or wheel over the track headers)
 * scrolls tracks vertically; Ctrl+wheel zooms around the pointer.
 */
@Component({
	selector: 'bc-timeline',
	imports: [
		AutoSelect,
		IconButton,
		Tooltip,
		StyleChip,
		LucideScissors,
		LucideMagnet,
		LucideZoomIn,
		LucideZoomOut,
		LucideEye,
		LucideEyeOff,
		LucideLock,
		LucideLockOpen,
		LucideHeadphones,
		LucideAudioLines,
	],
	templateUrl: './timeline.html',
	styleUrl: './timeline.css',
})
export class Timeline {
	protected readonly store = inject(ProjectStore);
	protected readonly commands = inject(EditorCommands);
	private readonly playback = inject(Playback);
	private readonly theme = inject(ThemeService);
	private readonly audio = inject(AudioPeaks);
	private readonly menus = inject(TimelineMenus);
	protected readonly ui = inject(EditorUi);
	private readonly host = inject(ElementRef<HTMLElement>);
	private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

	/** Zoom slider position, 0–100. */
	protected readonly zoom = signal(56);
	private readonly viewStart = signal<Ms>(0);
	private readonly size = signal({ width: 0, height: 0 });
	private readonly snapAt = signal<Ms | null>(null);
	/** What the last snap landed on, for the snap label. */
	private snapLabel = '';
	private readonly trim = signal<{ cueId: CueId; edge: 'start' | 'end'; original: Ms } | null>(
		null,
	);
	protected readonly hud = signal<Hud | null>(null);
	private readonly scrollTarget = signal(0);
	private readonly box = signal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	protected readonly cursor = signal('default');
	private drag: Drag | null = null;

	protected readonly timecode = computed(() =>
		this.ui.timeUnits() === 'ms'
			? formatClock(this.store.playhead())
			: formatTimecode(this.store.playhead(), this.store.project().fps),
	);
	/** Fully zoomed out shows the whole video, however long it is. */
	private readonly minPxPerS = computed(() => {
		const seconds = this.store.duration() / 1000;
		const width = this.size().width;
		return seconds && width ? Math.min(MIN_PX_PER_S, (width * 0.98) / seconds) : MIN_PX_PER_S;
	});
	private readonly pxPerMs = computed(() => {
		const min = this.minPxPerS();
		return (min * Math.pow(MAX_PX_PER_S / min, this.zoom() / 100)) / 1000;
	});
	private readonly maxScrollY = computed(() =>
		Math.max(0, contentHeight(this.store.project().tracks.length) - this.size().height),
	);
	/** Vertical scroll, clamped so removing tracks or growing the panel never strands it. */
	protected readonly scrollY = computed(() =>
		Math.max(0, Math.min(this.maxScrollY(), this.scrollTarget())),
	);
	private readonly view = computed<View>(() => ({
		start: this.viewStart(),
		pxPerMs: this.pxPerMs(),
		...this.size(),
		scrollY: this.scrollY(),
	}));

	protected readonly headers = computed(() => {
		const p = this.store.project();
		return p.tracks.map((track) => ({ track, style: p.styles[track.defaultStyleId] }));
	});

	constructor() {
		effect((onCleanup) => {
			const el = this.canvas().nativeElement;
			const ro = new ResizeObserver(([e]) =>
				this.size.set({ width: e.contentRect.width, height: e.contentRect.height }),
			);
			ro.observe(el);
			onCleanup(() => ro.disconnect());
		});

		// A different project starts scrolled to its beginning.
		const projectId = computed(() => this.store.project().id);
		effect(() => {
			projectId();
			untracked(() => {
				this.viewStart.set(0);
				this.scrollTarget.set(0);
			});
		});

		// Keep the playhead in view while playing (page-style follow).
		effect(() => {
			if (!this.store.playing()) return;
			const v = this.view();
			const x = msToX(v, this.store.playhead());
			if (v.width && (x < 0 || x > v.width - 24))
				this.viewStart.set(Math.max(0, this.store.playhead() - 40 / v.pxPerMs));
		});

		effect(() => {
			this.theme.theme();
			const v = this.view();
			const el = this.canvas().nativeElement;
			const dpr = window.devicePixelRatio || 1;
			if (!v.width) return;
			// Resizing reallocates the canvas, so only do it when the size changes.
			const w = Math.round(v.width * dpr);
			const h = Math.round(v.height * dpr);
			if (el.width !== w || el.height !== h) {
				el.width = w;
				el.height = h;
			}
			const ctx = el.getContext('2d')!;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			paintTimeline(ctx, {
				view: v,
				palette: readPalette(this.host.nativeElement),
				tracks: this.store.project().tracks,
				selection: this.store.selection(),
				problems: this.store.problemsByCue(),
				playhead: this.store.playhead(),
				duration: this.store.duration(),
				fps: this.store.project().fps,
				msLabels: this.ui.timeUnits() === 'ms',
				snapAt: this.snapAt(),
				box: this.box(),
				trim: this.trim(),
				audio: this.audio.waveform(),
			});
		});

		this.ui.zoomTimeline = (step) => this.zoomStep(step);
		inject(DestroyRef).onDestroy(() => (this.ui.zoomTimeline = null));

		// Fonts load after first paint; repaint once they are ready.
		void document.fonts.ready.then(() => this.size.update((s) => ({ ...s })));
	}

	// ---- Header controls -------------------------------------------------

	protected zoomBy(delta: number, aroundX = this.size().width / 2): void {
		const v = this.view();
		const atMs = xToMs(v, aroundX);
		this.zoom.set(Math.max(0, Math.min(100, this.zoom() + delta)));
		this.viewStart.set(Math.max(0, atMs - aroundX / this.pxPerMs()));
	}

	protected onZoomInput(e: Event): void {
		this.zoomBy(Number((e.target as HTMLInputElement).value) - this.zoom(), this.playheadX());
	}

	/** Keyboard zoom: around the playhead when it's in view; fit shows the whole video. */
	private zoomStep(step: TimelineZoom): void {
		if (step !== 'fit') return this.zoomBy(step === 'in' ? 10 : -10, this.playheadX());
		this.zoom.set(0);
		this.viewStart.set(0);
	}

	/** The playhead's x if it's in view, else the middle of the timeline. */
	private playheadX(): number {
		const x = msToX(this.view(), this.store.playhead());
		return x >= 0 && x <= this.size().width ? x : this.size().width / 2;
	}

	protected toggleTrack(track: Track, key: 'muted' | 'locked' | 'solo'): void {
		const verb = {
			muted: track.muted ? 'Show' : 'Hide',
			locked: track.locked ? 'Unlock' : 'Lock',
			solo: track.solo ? 'Unsolo' : 'Solo',
		}[key];
		this.store.apply(`${verb} ${track.name}`, updateTrack(track.id, { [key]: !track[key] }));
	}

	protected finishRename(track: Track, name: string): void {
		if (this.ui.renamingTrack() !== track.id) return;
		this.ui.renamingTrack.set(null);
		this.commands.renameTrack(track.id, name);
	}

	// ---- Context menus ---------------------------------------------------

	protected onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		if (this.drag) return;
		const r = this.canvas().nativeElement.getBoundingClientRect();
		const x = e.clientX - r.left;
		const h = this.hit(x, e.clientY - r.top);
		if (h.kind === 'cue') void this.menus.cue(e, h.track, h.cueId);
		else if (h.kind === 'lane') void this.menus.lane(e, h.track, xToMs(this.view(), x));
	}

	protected onHeaderMenu(e: MouseEvent, track: Track): void {
		e.preventDefault();
		void this.menus.header(e, track);
	}

	// ---- Pointer gestures ------------------------------------------------

	private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
		const r = this.canvas().nativeElement.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	private hit(x: number, y: number): Hit {
		if (y < RULER_H) return { kind: 'ruler' };
		if (y < LANES_TOP) return { kind: 'none' };
		y += this.scrollY();
		const tracks = this.store.project().tracks;
		const i = Math.floor((y - LANES_TOP) / (LANE_H + LANE_GAP));
		const track = tracks[i];
		if (y < LANES_TOP || !track || y > laneY(i) + LANE_H) return { kind: 'none' };
		const v = this.view();
		const ms = xToMs(v, x);
		const inCue = y >= laneY(i) + CUE_INSET && y <= laneY(i) + LANE_H - CUE_INSET;
		// Prefer edges so short cues stay trimmable; check the selected cue first.
		const cues = [...track.cues].sort(
			(a, b) =>
				Number(this.store.selection().has(b.id)) - Number(this.store.selection().has(a.id)),
		);
		for (const c of cues) {
			const x0 = msToX(v, c.start),
				x1 = msToX(v, c.end);
			if (!inCue || x < x0 - EDGE_PX || x > x1 + EDGE_PX) continue;
			const edge =
				Math.abs(x - x0) <= EDGE_PX ? 'start' : Math.abs(x - x1) <= EDGE_PX ? 'end' : null;
			if (edge || (ms >= c.start && ms <= c.end))
				return { kind: 'cue', track, trackIndex: i, cueId: c.id, edge };
		}
		return { kind: 'lane', track, trackIndex: i };
	}

	/**
	 * Snap whichever of `points` is closest (within SNAP_PX) to the playhead, another cue's
	 * edge, a word boundary or the edge of a silence; failing that, the first to a frame. Returns the snap delta. `exclude` are
	 * the cues being dragged; a trimmed cue's own words still count (`ownWords`).
	 */
	private snapDelta(points: Ms[], exclude: ReadonlySet<CueId>, ownWords = false): number {
		if (!this.ui.snapping()) return 0;
		const fps = this.store.project().fps;
		const tc = (ms: Ms) => formatTimecode(ms, fps);
		const targets: { at: Ms; label: string }[] = [
			{ at: 0, label: 'Snapped to start' },
			{ at: this.store.playhead(), label: 'Snapped to playhead' },
			...this.audio
				.silenceEdges()
				.map((at) => ({ at, label: `Snapped to silence ${tc(at)}` })),
		];
		for (const t of this.store.project().tracks)
			t.cues.forEach((c, i) => {
				const dragged = exclude.has(c.id);
				if (!dragged)
					targets.push(
						{ at: c.start, label: `Snapped to cue ${i + 1} • Start ${tc(c.start)}` },
						{ at: c.end, label: `Snapped to cue ${i + 1} • End ${tc(c.end)}` },
					);
				if (!dragged || ownWords)
					for (const w of c.words ?? [])
						targets.push(
							{ at: w.start, label: `Snapped to "${w.text}" • Start ${tc(w.start)}` },
							{ at: w.end, label: `Snapped to "${w.text}" • End ${tc(w.end)}` },
						);
			});
		const limit = SNAP_PX / this.pxPerMs();
		let best: { d: number; at: Ms; label: string } | null = null;
		for (const p of points)
			for (const t of targets) {
				const d = t.at - p;
				if (Math.abs(d) <= limit && (!best || Math.abs(d) < Math.abs(best.d)))
					best = { d, ...t };
			}
		this.snapAt.set(best?.at ?? null);
		this.snapLabel = best?.label ?? '';
		if (best) return best.d;
		const frame = 1000 / fps;
		return Math.round(points[0] / frame) * frame - points[0];
	}

	protected onPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		const { x, y } = this.local(e);
		const h = this.hit(x, y);
		(e.target as Element).setPointerCapture(e.pointerId);
		const additive = e.ctrlKey || e.metaKey;

		if (h.kind === 'ruler') {
			this.drag = { mode: 'scrub' };
			this.playback.seek(xToMs(this.view(), x));
		} else if (h.kind === 'cue') {
			const cue = h.track.cues.find((c) => c.id === h.cueId)!;
			if (h.edge && !h.track.locked && !additive && !e.shiftKey) {
				this.store.select(cue.id);
				this.drag = {
					mode: 'trim',
					cueId: cue.id,
					edge: h.edge,
					start: cue.start,
					end: cue.end,
					original: h.edge === 'start' ? cue.start : cue.end,
				};
				this.trim.set({ cueId: cue.id, edge: h.edge, original: this.drag.original });
				this.store.begin('Trim cue');
				return;
			}
			const wasSelected = this.store.selection().has(cue.id);
			if (e.shiftKey) this.store.select(cue.id, 'range');
			else if (additive) this.store.select(cue.id, 'toggle');
			else if (!wasSelected) this.store.select(cue.id);
			if (!this.store.selection().has(cue.id)) return;
			const orig = new Map(
				this.store
					.selectedCues()
					.filter((r) => !r.track.locked)
					.map((r) => [r.cue.id, { start: r.cue.start, end: r.cue.end }]),
			);
			this.drag = {
				mode: 'move',
				downX: x,
				downY: y,
				downMs: xToMs(this.view(), x),
				anchor: cue.id,
				orig,
				trackId: h.track.id,
				moved: false,
				clickSelect: wasSelected && !additive && !e.shiftKey ? cue.id : null,
			};
		} else if (h.kind === 'lane' || h.kind === 'none') {
			const base = additive || e.shiftKey ? this.store.selection() : new Set<CueId>();
			this.drag = { mode: 'box', x0: x, y0: y, base, moved: false };
		}
	}

	protected onPointerMove(e: PointerEvent): void {
		const { x, y } = this.local(e);
		const d = this.drag;
		if (!d) {
			const h = this.hit(x, y);
			this.cursor.set(
				h.kind === 'cue' && h.edge && !h.track.locked
					? 'ew-resize'
					: h.kind === 'ruler'
						? 'col-resize'
						: 'default',
			);
			return;
		}
		const ms = xToMs(this.view(), x);
		switch (d.mode) {
			case 'scrub':
				this.playback.seek(ms);
				break;
			case 'trim': {
				const snap = this.snapDelta([ms], new Set([d.cueId]), true);
				const t = Math.round(ms + snap);
				const minLen = 1000 / this.store.project().fps;
				const [s, en] =
					d.edge === 'start'
						? [Math.min(t, d.end - minLen), d.end]
						: [d.start, Math.max(t, d.start + minLen)];
				const start = Math.max(0, s);
				this.store.apply('Trim cue', setTiming(d.cueId, start, en));
				const now = d.edge === 'start' ? start : en;
				this.showHud(now, y, d.edge === 'start' ? 'left' : 'right', () => {
					const tc = (ms: Ms) => formatTimecode(ms, this.store.project().fps);
					const diff = (now - d.original) / 1000;
					const sign = diff < 0 ? '−' : '+';
					const edge = d.edge === 'start' ? 'Start' : 'End';
					return `${edge} ${tc(d.original)} → ${tc(now)}  ${sign}${Math.abs(diff).toFixed(2)} s`;
				});
				break;
			}
			case 'move': {
				if (!d.moved && Math.hypot(x - d.downX, y - d.downY) < 3) return;
				if (!d.moved) {
					d.moved = true;
					this.store.begin(d.orig.size > 1 ? `Move ${d.orig.size} cues` : 'Move cue');
				}
				const ids = new Set(d.orig.keys());
				const minStart = Math.min(...[...d.orig.values()].map((o) => o.start));
				let delta = Math.max(-minStart, ms - d.downMs);
				const a = d.orig.get(d.anchor);
				// Pure vertical drags keep their timing; only horizontal movement snaps.
				if (Math.abs(x - d.downX) < 3) delta = 0;
				else if (a)
					delta = Math.round(
						delta + this.snapDelta([a.start + delta, a.end + delta], ids),
					);
				this.store.apply('Move cue', (p) => {
					for (const [id, o] of d.orig) setTiming(id, o.start + delta, o.end + delta)(p);
				});
				this.showHud(null, y, 'right', null);
				// Vertical drag moves cues to another unlocked track (when they share one).
				const h = this.hit(x, y);
				const sameTrack = this.store.selectedCues().every((r) => r.track.id === d.trackId);
				if (
					(h.kind === 'lane' || h.kind === 'cue') &&
					h.track.id !== d.trackId &&
					!h.track.locked &&
					sameTrack
				) {
					this.store.apply('Move cue', moveCues([...ids], 0, h.track.id));
					d.trackId = h.track.id;
				}
				break;
			}
			case 'box': {
				d.moved = true;
				this.box.set({ x0: d.x0, y0: d.y0, x1: x, y1: y });
				const v = this.view();
				const [t0, t1] = [xToMs(v, Math.min(d.x0, x)), xToMs(v, Math.max(d.x0, x))];
				const [y0, y1] = [Math.min(d.y0, y), Math.max(d.y0, y)];
				const next = new Set(d.base);
				const hitTracks = new Set<TrackId>();
				let n = 0;
				this.store.project().tracks.forEach((t, i) => {
					const ly = laneY(i) + CUE_INSET - this.scrollY();
					if (ly + LANE_H - CUE_INSET * 2 < y0 || ly > y1) return;
					for (const c of t.cues)
						if (c.end >= t0 && c.start <= t1) {
							next.add(c.id);
							hitTracks.add(t.id);
							n++;
						}
				});
				this.store.selection.set(next);
				const k = hitTracks.size;
				this.hud.set(
					n
						? {
								text: `${n} cue${n === 1 ? '' : 's'} on ${k} track${k === 1 ? '' : 's'}`,
								x: Math.max(d.x0, x) + 8,
								y: Math.max(d.y0, y) + 8,
								align: 'right',
							}
						: null,
				);
				break;
			}
		}
	}

	protected onPointerUp(e: PointerEvent): void {
		const d = this.drag;
		this.drag = null;
		this.snapAt.set(null);
		this.box.set(null);
		this.trim.set(null);
		this.hud.set(null);
		if (!d) return;
		if (d.mode === 'trim' || (d.mode === 'move' && d.moved)) this.store.end();
		if (d.mode === 'move' && !d.moved && d.clickSelect) this.store.select(d.clickSelect);
		if (d.mode === 'box' && !d.moved) {
			if (!d.base.size) this.store.clearSelection();
			this.playback.seek(xToMs(this.view(), this.local(e).x));
		}
	}

	/**
	 * Shows the snap label at the snap point when snapped, otherwise `fallback` (if given)
	 * beside `ms`. Labels sit just above the pointer.
	 */
	private showHud(
		ms: Ms | null,
		y: number,
		align: Hud['align'],
		fallback: (() => string) | null,
	): void {
		const snapped = this.snapAt() !== null;
		const at = snapped ? this.snapAt() : ms;
		const text = snapped ? this.snapLabel : fallback?.();
		if (at === null || !text) return this.hud.set(null);
		const x = msToX(this.view(), at);
		this.hud.set({ text, x: align === 'left' ? x - 8 : x + 8, y: Math.max(0, y - 40), align });
	}

	protected onWheel(e: WheelEvent): void {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			this.zoomBy(-Math.sign(e.deltaY) * 5, this.local(e).x);
			return;
		}
		if (e.shiftKey && !e.deltaX) return this.scrollBy(e.deltaY);
		const delta =
			(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / this.pxPerMs();
		const maxStart = Math.max(
			0,
			this.store.duration() - this.size().width / this.pxPerMs() / 2,
		);
		this.viewStart.set(Math.max(0, Math.min(maxStart, this.viewStart() + delta)));
	}

	/** Vertical scroll of the track lanes; headers follow via a transform. */
	protected scrollBy(dy: number): void {
		this.scrollTarget.set(Math.max(0, Math.min(this.maxScrollY(), this.scrollY() + dy)));
	}

	protected onHeadersWheel(e: WheelEvent): void {
		if (!this.maxScrollY()) return;
		e.preventDefault();
		this.scrollBy(e.deltaY);
	}
}
