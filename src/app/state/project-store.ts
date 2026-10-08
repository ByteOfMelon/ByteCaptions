import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import { History, Recipe } from '../core/commands/history';
import { cueText } from '../core/model/cue';
import { Cue, CueId, Ms, Project, Track, TrackId } from '../core/model/types';
import { lintProject } from '../core/lint/rules';
import { demoProject } from './demo-project';

export interface CueRef {
	track: Track;
	cue: Cue;
	/** 1-based position across all tracks, ordered by start time. */
	index: number;
}

/**
 * Root editor state: the project (through undoable History), selection and playhead.
 * All document mutations go through `apply()` so they can be undone.
 */
@Injectable({ providedIn: 'root' })
export class ProjectStore {
	private readonly history = new History<Project>(demoProject());
	private readonly version = signal(0);

	readonly project = computed(() => {
		this.version();
		return this.history.current;
	});
	readonly canUndo = computed(() => (this.version(), this.history.canUndo));
	readonly canRedo = computed(() => (this.version(), this.history.canRedo));
	readonly undoLabel = computed(() => (this.version(), this.history.undoLabel));
	readonly redoLabel = computed(() => (this.version(), this.history.redoLabel));
	readonly dirty = signal(false);

	readonly selection = signal<ReadonlySet<CueId>>(new Set(['d13']));
	readonly playhead = signal<Ms>(39_233);
	readonly playing = signal(false);
	readonly rate = signal(1);

	/** Every cue across tracks, ordered by start; index is what the cue list shows. */
	readonly allCues = computed<CueRef[]>(() =>
		this.project()
			.tracks.flatMap((track) => track.cues.map((cue) => ({ track, cue, index: 0 })))
			.sort((a, b) => a.cue.start - b.cue.start || a.cue.end - b.cue.end)
			.map((r, i) => ({ ...r, index: i + 1 })),
	);
	readonly cueCount = computed(() => this.allCues().length);
	readonly problems = computed(() => lintProject(this.project()));
	readonly problemsByCue = computed(() => {
		const map = new Map<CueId, ReturnType<typeof lintProject>>();
		for (const p of this.problems()) map.set(p.cueId, [...(map.get(p.cueId) ?? []), p]);
		return map;
	});

	readonly selectedCues = computed(() =>
		this.allCues().filter((r) => this.selection().has(r.cue.id)),
	);
	/** The single selected cue (the inspector's subject), or null. */
	readonly primary = computed(() => this.selectedCues()[0] ?? null);

	readonly duration = computed(() => {
		const p = this.project();
		const lastCue = Math.max(0, ...p.tracks.flatMap((t) => t.cues.map((c) => c.end)));
		return Math.max(p.media?.durationMs ?? 0, lastCue);
	});

	constructor() {
		// Deleting the last cues can shorten the project; keep the playhead inside it.
		effect(() => {
			const end = this.duration();
			if (untracked(this.playhead) > end) this.playhead.set(end);
		});
	}

	apply(label: string, recipe: Recipe<Project>): void {
		try {
			this.history.apply(label, recipe);
		} catch (e) {
			console.warn(e);
			return;
		}
		this.dirty.set(true);
		this.version.update((v) => v + 1);
	}

	begin(label: string): void {
		this.history.begin(label);
	}

	end(): void {
		this.history.end();
		this.version.update((v) => v + 1);
	}

	undo(): void {
		this.history.undo();
		this.dirty.set(true);
		this.version.update((v) => v + 1);
	}

	redo(): void {
		this.history.redo();
		this.dirty.set(true);
		this.version.update((v) => v + 1);
	}

	load(project: Project): void {
		this.history.reset(project);
		this.selection.set(new Set());
		this.playhead.set(0);
		this.dirty.set(false);
		this.version.update((v) => v + 1);
	}

	track(id: TrackId): Track | undefined {
		return this.project().tracks.find((t) => t.id === id);
	}

	find(cueId: CueId): CueRef | undefined {
		return this.allCues().find((r) => r.cue.id === cueId);
	}

	/** Plain click selects one; additive (Ctrl/Cmd) toggles; range (Shift) extends in list order. */
	select(cueId: CueId, mode: 'replace' | 'toggle' | 'range' = 'replace'): void {
		if (mode === 'replace') return this.selection.set(new Set([cueId]));
		const next = new Set(this.selection());
		if (mode === 'toggle') {
			if (next.has(cueId)) next.delete(cueId);
			else next.add(cueId);
		} else {
			const all = this.allCues();
			const anchor = all.findIndex((r) => r.cue.id === this.primary()?.cue.id);
			const target = all.findIndex((r) => r.cue.id === cueId);
			const [a, b] =
				anchor < 0
					? [target, target]
					: [Math.min(anchor, target), Math.max(anchor, target)];
			for (let i = a; i <= b; i++) next.add(all[i].cue.id);
		}
		this.selection.set(next);
	}

	clearSelection(): void {
		this.selection.set(new Set());
	}

	seek(ms: Ms): void {
		this.playhead.set(Math.max(0, Math.min(this.duration(), ms)));
	}

	/** Cues on screen at the playhead from tracks visible in preview. */
	readonly activeCues = computed(
		() => {
			const t = this.playhead();
			const p = this.project();
			const soloed = p.tracks.some((tr) => tr.solo);
			return p.tracks
				.filter((tr) => !tr.muted && (!soloed || tr.solo))
				.flatMap((track) =>
					track.cues
						.filter((c) => c.start <= t && t < c.end)
						.map((cue) => ({ track, cue })),
				);
		},
		// Same cues as last frame: don't wake the preview during playback.
		{
			equal: (a, b) =>
				a.length === b.length &&
				a.every((r, i) => r.cue === b[i].cue && r.track === b[i].track),
		},
	);

	/** Cue text helper for templates. */
	text(cue: Cue): string {
		return cueText(cue);
	}
}
