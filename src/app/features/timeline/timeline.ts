import {
	Component,
	DestroyRef,
	Directive,
	ElementRef,
	afterNextRender,
	afterRenderEffect,
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
	LucideRepeat,
	LucideScissors,
	LucideZoomIn,
	LucideZoomOut,
} from '@lucide/angular';
import { addCue, setTiming, moveCues, setWords, updateTrack } from '../../core/commands/edits';
import { MARKER_COLORS, createCue } from '../../core/model/defaults';
import { CueId, MarkerId, Ms, Track, TrackId } from '../../core/model/types';
import { moveWordEdge } from '../../core/model/words';
import { formatClock, formatTimecode, snapToFrame } from '../../core/time/timecode';
import { AudioPeaks } from '../../state/audio-peaks';
import { EditorUi, TimelineZoom } from '../../state/editor-ui';
import { ProjectStore } from '../../state/project-store';
import { WordTapping } from '../../state/word-tapping';
import { ThemeService } from '../../theme/theme.service';
import { IconButton } from '../../ui/button/button';
import { ErrorTip, Tooltip } from '../../ui/tooltip/tooltip';
import { EditorCommands } from '../editor/editor-commands';
import { MarkerPopover } from '../markers/marker-popover';
import { Markers } from '../markers/markers';
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
/** Chrome stops laying out elements wider than ~33M px. */
const MAX_SCROLL_PX = 10_000_000;
/** Dragging within this many px of the left/right edge (or past it) scrolls the view. */
const AUTOSCROLL_PX = 24;
/** Auto-scroll speed in px per frame: grows with how far past AUTOSCROLL_PX the pointer is. */
const AUTOSCROLL_MIN_SPEED = 2;
const AUTOSCROLL_MAX_SPEED = 60;

type Hit =
	| { kind: 'ruler' }
	/** In/out range in the ruler: an edge, or the whole range on Alt+drag (edge null). */
	| { kind: 'range'; edge: 'start' | 'end' | null }
	| { kind: 'marker'; id: MarkerId }
	| { kind: 'cue'; track: Track; trackIndex: number; cueId: CueId; edge: 'start' | 'end' | null }
	/** The line before word `index` in the selected cue. */
	| { kind: 'word'; track: Track; cueId: CueId; index: number }
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
	| { mode: 'word'; cueId: CueId; index: number; original: Ms }
	| { mode: 'range'; edge: 'start' | 'end' | null; downMs: Ms; start: Ms; end: Ms }
	| { mode: 'marker'; id: MarkerId; downX: number; moved: boolean }
	/** Alt+drag on empty lane space draws a new cue; it's added once the drag moves. */
	| {
			mode: 'create';
			trackId: TrackId;
			ms0: Ms;
			downX: number;
			cueId: CueId | null;
			moved: boolean;
	  }
	/** The box's start is kept in time so it stays put while the view auto-scrolls. */
	| { mode: 'box'; ms0: Ms; y0: number; base: ReadonlySet<CueId>; moved: boolean };

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
 * lane space to box-select, or Alt+drag it to draw a new cue. Wheel scrolls; Shift+wheel
 * (or wheel over the track headers) scrolls tracks vertically; Ctrl+wheel zooms around the
 * pointer.
 */
@Component({
	selector: 'bc-timeline',
	imports: [
		AutoSelect,
		ErrorTip,
		MarkerPopover,
		IconButton,
		Tooltip,
		StyleChip,
		LucideScissors,
		LucideMagnet,
		LucideRepeat,
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
	protected readonly playback = inject(Playback);
	private readonly theme = inject(ThemeService);
	private readonly audio = inject(AudioPeaks);
	private readonly menus = inject(TimelineMenus);
	private readonly tapping = inject(WordTapping);
	protected readonly markers = inject(Markers);
	protected readonly ui = inject(EditorUi);
	private readonly host = inject(ElementRef<HTMLElement>);
	private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
	private readonly hscroll = viewChild.required<ElementRef<HTMLElement>>('hscroll');

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
	/** The line between two words being dragged. */
	private readonly wordEdge = signal<{ cueId: CueId; index: number } | null>(null);
	/** Tap to time's hint, shown above the cue being tapped. */
	protected readonly tapHint = computed(() => {
		const t = this.tapping.active();
		const ref = t && this.store.find(t.cueId);
		const v = this.view();
		if (!t || !ref || !v.width) return null;
		const x = msToX(v, (ref.cue.start + ref.cue.end) / 2);
		return { text: t.label, x: Math.max(160, Math.min(v.width - 160, x)) };
	});
	/** Note of the marker under the pointer. */
	protected readonly markerTip = signal<Hud | null>(null);
	private readonly scrollTarget = signal(0);
	private readonly box = signal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	protected readonly cursor = signal('default');
	private drag: Drag | null = null;
	/** Last pointer position during a drag (canvas px), for auto-scroll at the edges. */
	private pointer: { x: number; y: number } | null = null;
	private edgeFrame = 0;

	protected readonly timecode = computed(() =>
		this.ui.timeUnits() === 'ms'
			? formatClock(this.store.playhead())
			: formatTimecode(this.store.playhead(), this.store.project().fps),
	);
	/** "In … → Out … • 4.73 s" while an in/out range is set. */
	protected readonly rangeLabel = computed(() => {
		const r = this.playback.range();
		if (!r) return null;
		const fmt = (ms: Ms) =>
			this.ui.timeUnits() === 'ms'
				? formatClock(ms)
				: formatTimecode(ms, this.store.project().fps);
		return `In ${fmt(r.start)} → Out ${fmt(r.end)} • ${((r.end - r.start) / 1000).toFixed(2)} s`;
	});
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
	/** Latest view start: scrolling may go half a screen past the end. */
	private readonly maxStart = computed(() =>
		Math.max(0, this.store.duration() - this.size().width / this.pxPerMs() / 2),
	);
	/**
	 * Scrollbar content width, capped below the browser's element size limit (positions map
	 * proportionally).
	 */
	protected readonly scrollWidth = computed(() =>
		Math.min(MAX_SCROLL_PX, this.maxStart() * this.pxPerMs() + this.size().width),
	);
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
				range: this.playback.range(),
				wordEdge: this.wordEdge(),
				tapping: this.tapping.active(),
				markers: this.store.project().markers.map((m) => ({
					at: m.at,
					color: MARKER_COLORS[m.color],
					selected: m.id === this.markers.selected(),
				})),
			});
		});

		// Keep the scrollbar on the view (after render, so its content width is current).
		afterRenderEffect(() => {
			const el = this.hscroll().nativeElement;
			this.scrollWidth();
			const range = el.scrollWidth - el.clientWidth;
			const max = this.maxStart();
			const left = max && range > 0 ? (this.viewStart() / max) * range : 0;
			if (Math.abs(el.scrollLeft - left) > 1) el.scrollLeft = left;
		});

		// Opening a marker that's off-screen (Markers tab, Shift+M) scrolls it into view.
		effect(() => {
			const m = this.markers.find(this.markers.editing());
			if (!m) return;
			untracked(() => {
				const v = this.view();
				const x = msToX(v, m.at);
				if (v.width && (x < 0 || x > v.width))
					this.viewStart.set(
						Math.max(0, Math.min(this.maxStart(), m.at - v.width / 3 / v.pxPerMs)),
					);
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

	protected readonly renameError = signal<string | null>(null);

	/** Enter keeps the field open on an empty name and says why; leaving it reverts. */
	protected finishRename(track: Track, name: string, keepOpen = false): void {
		if (this.ui.renamingTrack() !== track.id) return;
		if (!name.trim() && keepOpen) return this.renameError.set('Track name can’t be empty.');
		this.cancelRename();
		this.commands.renameTrack(track.id, name);
	}

	protected cancelRename(): void {
		this.ui.renamingTrack.set(null);
		this.renameError.set(null);
	}

	protected onRenameInput(name: string): void {
		if (name.trim()) this.renameError.set(null);
	}

	// ---- Context menus ---------------------------------------------------

	protected onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		if (this.drag) return;
		const r = this.canvas().nativeElement.getBoundingClientRect();
		const x = e.clientX - r.left;
		const y = e.clientY - r.top;
		const marker = y < RULER_H ? this.markerAt(x) : null;
		if (marker) {
			this.markers.selected.set(marker);
			void this.menus.marker(e, marker);
			return;
		}
		const h = this.hit(x, y);
		if (h.kind === 'cue') void this.menus.cue(e, h.track, h.cueId);
		else if (h.kind === 'lane') void this.menus.lane(e, h.track, xToMs(this.view(), x));
		else if (h.kind === 'ruler' || h.kind === 'range' || h.kind === 'marker') {
			// Snap the clicked time to a frame so marks line up with the timecodes.
			const fps = this.store.project().fps;
			void this.menus.ruler(e, snapToFrame(xToMs(this.view(), x), fps));
		}
	}

	/** Double-clicking a marker opens its popover. */
	protected onDoubleClick(e: MouseEvent): void {
		const r = this.canvas().nativeElement.getBoundingClientRect();
		const marker = e.clientY - r.top < RULER_H ? this.markerAt(e.clientX - r.left) : null;
		if (marker) this.markers.edit(marker);
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

	private hit(x: number, y: number, alt = false): Hit {
		if (y < RULER_H) return this.rulerHit(x, alt);
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
			// The selected cue's word lines can be dragged.
			const words = this.store.selection().has(c.id) && !edge ? c.words : undefined;
			const word = words?.findIndex((w, k) => k > 0 && Math.abs(x - msToX(v, w.start)) <= 4);
			if (word !== undefined && word > 0)
				return { kind: 'word', track, cueId: c.id, index: word };
			if (edge || (ms >= c.start && ms <= c.end))
				return { kind: 'cue', track, trackIndex: i, cueId: c.id, edge };
		}
		return { kind: 'lane', track, trackIndex: i };
	}

	/** The marker whose flag is at x on the ruler (the selected one wins), if any. */
	private markerAt(x: number): MarkerId | null {
		const v = this.view();
		let best: { id: MarkerId; d: number } | null = null;
		for (const m of this.markers.list()) {
			const d = Math.abs(x - msToX(v, m.at)) - (m.id === this.markers.selected() ? 1 : 0);
			if (d <= 6 && (!best || d < best.d)) best = { id: m.id, d };
		}
		return best?.id ?? null;
	}

	/**
	 * Dragging the ruler scrubs. Markers and the in/out edges are grabbed only away from the
	 * playhead (which often sits on one after Shift+M or I / O); Alt+drag inside the range
	 * moves the whole range.
	 */
	private rulerHit(x: number, alt: boolean): Hit {
		const r = this.playback.range();
		const v = this.view();
		if (Math.abs(x - msToX(v, this.store.playhead())) <= 6) return { kind: 'ruler' };
		const marker = this.markerAt(x);
		if (marker) return { kind: 'marker', id: marker };
		if (!r) return { kind: 'ruler' };
		const x0 = msToX(v, r.start);
		const x1 = msToX(v, r.end);
		if (Math.abs(x - x0) <= EDGE_PX) return { kind: 'range', edge: 'start' };
		if (Math.abs(x - x1) <= EDGE_PX) return { kind: 'range', edge: 'end' };
		if (alt && x > x0 && x < x1) return { kind: 'range', edge: null };
		return { kind: 'ruler' };
	}

	/**
	 * Snap whichever of `points` is closest (within SNAP_PX) to the playhead, another cue's
	 * edge, a word boundary or the edge of a silence; failing that, the first to a frame.
	 * Returns the snap delta. `exclude` are the cues being dragged; a trimmed cue's own words
	 * still count (`ownWords`).
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
		const h = this.hit(x, y, e.altKey);
		(e.target as Element).setPointerCapture(e.pointerId);
		const additive = e.ctrlKey || e.metaKey;

		this.markerTip.set(null);
		if (h.kind === 'ruler') {
			this.drag = { mode: 'scrub' };
			// Grabbing the playhead's own handle doesn't nudge it to the pointer.
			if (Math.abs(x - msToX(this.view(), this.store.playhead())) > 6)
				this.playback.seek(xToMs(this.view(), x));
		} else if (h.kind === 'marker') {
			this.markers.selected.set(h.id);
			this.drag = { mode: 'marker', id: h.id, downX: x, moved: false };
		} else if (h.kind === 'range') {
			const r = this.playback.range()!;
			this.drag = {
				mode: 'range',
				edge: h.edge,
				downMs: xToMs(this.view(), x),
				start: r.start,
				end: r.end,
			};
		} else if (h.kind === 'word' && !h.track.locked && !additive && !e.shiftKey) {
			const cue = h.track.cues.find((c) => c.id === h.cueId)!;
			const original = cue.words![h.index].start;
			this.drag = { mode: 'word', cueId: cue.id, index: h.index, original };
			this.wordEdge.set({ cueId: cue.id, index: h.index });
			this.store.begin('Move word timing');
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
		} else if (h.kind === 'lane' && e.altKey && !h.track.locked) {
			const ms = xToMs(this.view(), x);
			this.drag = {
				mode: 'create',
				trackId: h.track.id,
				ms0: Math.max(0, Math.round(ms + this.snapDelta([ms], new Set()))),
				downX: x,
				cueId: null,
				moved: false,
			};
		} else if (h.kind === 'lane' || h.kind === 'none') {
			const base = additive || e.shiftKey ? this.store.selection() : new Set<CueId>();
			this.drag = { mode: 'box', ms0: xToMs(this.view(), x), y0: y, base, moved: false };
		}
	}

	protected onPointerMove(e: PointerEvent): void {
		const { x, y } = this.local(e);
		if (!this.drag) {
			const h = this.hit(x, y, e.altKey);
			this.showMarkerTip(h.kind === 'marker' ? h.id : null);
			this.cursor.set(
				(h.kind === 'cue' && h.edge && !h.track.locked) ||
					(h.kind === 'word' && !h.track.locked)
					? 'ew-resize'
					: h.kind === 'marker'
						? 'pointer'
						: h.kind === 'range'
							? h.edge
								? 'ew-resize'
								: 'grab'
							: h.kind === 'ruler'
								? 'col-resize'
								: h.kind === 'lane' && e.altKey && !h.track.locked
									? 'crosshair'
									: 'default',
			);
			return;
		}
		this.pointer = { x, y };
		this.dragTo(x, y);
		this.edgeScroll();
	}

	/**
	 * Like Premiere and Resolve: while dragging near or past the left/right edge, scroll the
	 * view each frame and re-apply the drag at the new time under the pointer.
	 */
	private edgeScroll(): void {
		if (this.edgeFrame) return;
		this.edgeFrame = requestAnimationFrame(() => {
			this.edgeFrame = 0;
			const d = this.drag;
			const p = this.pointer;
			const always =
				d?.mode === 'scrub' ||
				d?.mode === 'trim' ||
				d?.mode === 'word' ||
				d?.mode === 'range';
			if (!d || !p || (!always && !d.moved)) return;
			const width = this.size().width;
			const over =
				p.x < AUTOSCROLL_PX
					? p.x - AUTOSCROLL_PX
					: p.x > width - AUTOSCROLL_PX
						? p.x - width + AUTOSCROLL_PX
						: 0;
			if (!over) return;
			const speed = Math.min(
				AUTOSCROLL_MAX_SPEED,
				AUTOSCROLL_MIN_SPEED + Math.abs(over) * 0.4,
			);
			const start = this.viewStart();
			const next = Math.max(
				0,
				Math.min(this.maxStart(), start + (Math.sign(over) * speed) / this.pxPerMs()),
			);
			if (next === start) return;
			this.viewStart.set(next);
			this.dragTo(p.x, p.y);
			this.edgeScroll();
		});
	}

	/** Applies the current drag with the pointer at canvas (x, y). */
	private dragTo(x: number, y: number): void {
		const d = this.drag;
		if (!d) return;
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
			case 'word': {
				const ref = this.store.find(d.cueId);
				if (!ref?.cue.words) break;
				const t = Math.round(ms + this.snapDelta([ms], new Set([d.cueId])));
				const words = moveWordEdge(
					ref.cue.words,
					d.index,
					t,
					1000 / this.store.project().fps,
				);
				this.store.apply('Move word timing', setWords(d.cueId, words));
				const now = words[d.index].start;
				this.showHud(now, y, 'right', () => {
					const tc = (ms: Ms) => formatTimecode(ms, this.store.project().fps);
					const diff = (now - d.original) / 1000;
					const sign = diff < 0 ? '−' : '+';
					const pair = `“${words[d.index - 1].text}” → “${words[d.index].text}”`;
					return `${pair}  ${tc(d.original)} → ${tc(now)}  ${sign}${Math.abs(diff).toFixed(2)} s`;
				});
				break;
			}
			case 'marker': {
				if (!d.moved && Math.abs(x - d.downX) < 3) return;
				if (!d.moved) {
					d.moved = true;
					this.markerTip.set(null);
					this.store.begin('Move marker');
				}
				const at = Math.max(
					0,
					Math.min(
						this.store.duration(),
						Math.round(ms + this.snapDelta([ms], new Set())),
					),
				);
				this.markers.move(d.id, at);
				this.showHud(at, RULER_H + 48, 'right', () => {
					const tc = formatTimecode(at, this.store.project().fps);
					return `Marker ${this.markers.number(d.id)} • ${tc}`;
				});
				break;
			}
			case 'range': {
				const minLen = 1000 / this.store.project().fps;
				const duration = this.store.duration();
				const fmt = (ms: Ms) => formatTimecode(ms, this.store.project().fps);
				if (d.edge) {
					const t = Math.round(ms + this.snapDelta([ms], new Set()));
					if (d.edge === 'start')
						this.playback.inPoint.set(Math.max(0, Math.min(t, d.end - minLen)));
					else
						this.playback.outPoint.set(
							Math.min(duration, Math.max(t, d.start + minLen)),
						);
					const now = this.playback.range()![d.edge];
					// Labels sit inside the range so the In label isn't hidden behind the track headers.
					this.showHud(now, RULER_H + 48, d.edge === 'start' ? 'right' : 'left', () =>
						d.edge === 'start' ? `In ${fmt(now)}` : `Out ${fmt(now)}`,
					);
					break;
				}
				let delta = ms - d.downMs;
				delta += this.snapDelta([d.start + delta, d.end + delta], new Set());
				delta = Math.round(Math.max(-d.start, Math.min(duration - d.end, delta)));
				this.playback.inPoint.set(d.start + delta);
				this.playback.outPoint.set(d.end + delta);
				this.cursor.set('grabbing');
				this.showHud(d.end + delta, RULER_H + 48, 'right', () => {
					const [a, b] = [d.start + delta, d.end + delta];
					return `${fmt(a)} → ${fmt(b)}  ${((b - a) / 1000).toFixed(2)} s`;
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
			case 'create': {
				if (!d.moved && Math.abs(x - d.downX) < 3) return;
				const minLen = 1000 / this.store.project().fps;
				const t = Math.max(
					0,
					Math.round(ms + this.snapDelta([ms], new Set(d.cueId ? [d.cueId] : []))),
				);
				const [start, end] = t < d.ms0 ? [t, d.ms0] : [d.ms0, t];
				const timing = [start, Math.max(end, start + minLen)] as const;
				if (!d.moved) {
					d.moved = true;
					const cue = createCue(timing[0], timing[1], '');
					d.cueId = cue.id;
					this.store.begin('New cue');
					this.store.apply('New cue', addCue(d.trackId, cue));
					this.store.select(cue.id);
				} else this.store.apply('New cue', setTiming(d.cueId!, timing[0], timing[1]));
				this.showHud(t, y, t < d.ms0 ? 'left' : 'right', () => {
					const tc = (ms: Ms) => formatTimecode(ms, this.store.project().fps);
					const len = (timing[1] - timing[0]) / 1000;
					return `${tc(timing[0])} → ${tc(timing[1])}  ${len.toFixed(2)} s`;
				});
				break;
			}
			case 'box': {
				d.moved = true;
				const v = this.view();
				const x0 = msToX(v, d.ms0);
				this.box.set({ x0, y0: d.y0, x1: x, y1: y });
				const [t0, t1] = [Math.min(d.ms0, ms), Math.max(d.ms0, ms)];
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
								x: Math.max(x0, x) + 8,
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
		this.pointer = null;
		cancelAnimationFrame(this.edgeFrame);
		this.edgeFrame = 0;
		this.snapAt.set(null);
		this.box.set(null);
		this.trim.set(null);
		this.wordEdge.set(null);
		this.hud.set(null);
		if (!d) return;
		if (
			d.mode === 'trim' ||
			d.mode === 'word' ||
			((d.mode === 'move' || d.mode === 'create' || d.mode === 'marker') && d.moved)
		)
			this.store.end();
		// Clicking a marker selects it and jumps there.
		if (d.mode === 'marker' && !d.moved) this.markers.select(d.id);
		// Alt+click without dragging just moves the playhead, like a plain click.
		if (d.mode === 'create' && !d.moved)
			this.playback.seek(xToMs(this.view(), this.local(e).x));
		if (d.mode === 'move' && !d.moved && d.clickSelect) this.store.select(d.clickSelect);
		if (d.mode === 'box' && !d.moved) {
			if (!d.base.size) this.store.clearSelection();
			this.playback.seek(xToMs(this.view(), this.local(e).x));
		}
	}

	/** Hovering a marker shows its note (or its number) under the flag. */
	private showMarkerTip(id: MarkerId | null): void {
		const m = this.markers.find(id);
		if (!m || this.markers.editing() === m.id) return this.markerTip.set(null);
		const text = m.note || `Marker ${this.markers.number(m.id)}`;
		this.markerTip.set({
			text,
			x: msToX(this.view(), m.at) - 8,
			y: RULER_H + 4,
			align: 'right',
		});
	}

	protected onPointerLeave(): void {
		this.markerTip.set(null);
	}

	/** Where the edit popover sits: under the marker, kept inside the window. */
	protected readonly popover = computed(() => {
		const m = this.markers.find(this.markers.editing());
		const v = this.view();
		if (!m || !v.width) return null;
		const r = this.canvas().nativeElement.getBoundingClientRect();
		const x = r.left + msToX(v, m.at) - 140;
		const below = r.top + RULER_H + 4;
		const top = below + 220 > window.innerHeight ? Math.max(8, r.top - 224) : below;
		return { marker: m, left: Math.max(8, Math.min(window.innerWidth - 288, x)), top };
	});

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
		this.viewStart.set(Math.max(0, Math.min(this.maxStart(), this.viewStart() + delta)));
	}

	protected onHScroll(): void {
		const el = this.hscroll().nativeElement;
		const range = el.scrollWidth - el.clientWidth;
		if (range <= 0) return;
		const ms = (el.scrollLeft / range) * this.maxStart();
		// Ignore the echo of setting scrollLeft from the view.
		if (Math.abs(ms - this.viewStart()) * this.pxPerMs() >= 1) this.viewStart.set(ms);
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
