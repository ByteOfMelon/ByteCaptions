import { Injectable, inject } from '@angular/core';
import {
	addCue,
	addTrack,
	deleteCues,
	mergeCues,
	moveCues,
	removeTrack,
	reorderTrack,
	rippleDeleteCues,
	setTiming,
	splitCue,
	updateTrack,
} from '../../core/commands/edits';
import { createCue, createTrack, newId } from '../../core/model/defaults';
import { Cue, CueId, Ms, StyleId, TrackId } from '../../core/model/types';
import { TRACK_COLORS } from '../../state/project-files';
import { ProjectStore } from '../../state/project-store';
import { Playback } from '../player/playback';

/** Edit actions shared by the toolbar, timeline, menus and keyboard shortcuts. */
@Injectable({ providedIn: 'root' })
export class EditorCommands {
	private readonly store = inject(ProjectStore);
	private readonly playback = inject(Playback);
	/** Copied cues, with times relative to the earliest one. */
	private clipboard: Cue[] = [];

	undo(): void {
		this.store.undo();
	}

	redo(): void {
		this.store.redo();
	}

	/** Split the selected cue under the playhead, or any unlocked cue under it if none is selected. */
	splitAtPlayhead(): void {
		const t = this.store.playhead();
		const under = (r: { cue: { start: number; end: number } }) =>
			r.cue.start < t && t < r.cue.end;
		const target =
			this.store.selectedCues().find(under) ??
			this.store.allCues().find((r) => under(r) && !r.track.locked);
		if (!target || target.track.locked) return;
		const out: { rightId?: string } = {};
		this.store.apply('Split cue', splitCue(target.cue.id, t, out));
		if (out.rightId) this.store.select(out.rightId);
	}

	/** Merge the selection, or the single selected cue with the next one on its track. */
	merge(): void {
		const sel = this.store.selectedCues();
		let ids = sel.map((r) => r.cue.id);
		if (sel.length === 1) {
			const { track, cue } = sel[0];
			const next = track.cues[track.cues.findIndex((c) => c.id === cue.id) + 1];
			if (!next) return;
			ids = [cue.id, next.id];
		}
		if (ids.length < 2) return;
		this.store.apply('Merge cues', mergeCues(ids));
		this.store.select(ids[0]);
	}

	deleteSelected(): void {
		const ids = this.store
			.selectedCues()
			.filter((r) => !r.track.locked)
			.map((r) => r.cue.id);
		if (!ids.length) return;
		this.store.apply(
			ids.length > 1 ? `Delete ${ids.length} cues` : 'Delete cue',
			deleteCues(ids),
		);
		this.store.clearSelection();
	}

	/** Delete the selection and close the gap it leaves on each track. */
	rippleDeleteSelected(): void {
		const ids = this.store
			.selectedCues()
			.filter((r) => !r.track.locked)
			.map((r) => r.cue.id);
		if (!ids.length) return;
		this.store.apply(
			ids.length > 1 ? `Ripple delete ${ids.length} cues` : 'Ripple delete cue',
			rippleDeleteCues(ids),
		);
		this.store.clearSelection();
	}

	setStartToPlayhead(): void {
		const r = this.store.primary();
		const t = this.store.playhead();
		if (r && !r.track.locked && t < r.cue.end)
			this.store.apply('Set start', setTiming(r.cue.id, t, r.cue.end));
	}

	setEndToPlayhead(): void {
		const r = this.store.primary();
		const t = this.store.playhead();
		if (r && !r.track.locked && t > r.cue.start)
			this.store.apply('Set end', setTiming(r.cue.id, r.cue.start, t));
	}

	/** Nudge selected cues by whole frames (Alt+← / Alt+→). */
	nudge(frames: number): void {
		const sel = this.store.selectedCues().filter((r) => !r.track.locked);
		if (!sel.length) return;
		const d = Math.round((frames * 1000) / this.store.project().fps);
		this.store.apply('Nudge', (p) => {
			for (const r of sel)
				setTiming(
					r.cue.id,
					Math.max(0, r.cue.start + d),
					Math.max(0, r.cue.start + d) + r.cue.end - r.cue.start,
				)(p);
		});
	}

	/** Select and seek to the next / previous cue with a problem (F8 / Shift+F8). */
	goToProblem(dir: 1 | -1): void {
		const flagged = this.store
			.allCues()
			.filter((r) => this.store.problemsByCue().has(r.cue.id));
		if (!flagged.length) return;
		const current = this.store.primary()?.cue.start ?? this.store.playhead();
		const target =
			dir > 0
				? (flagged.find((r) => r.cue.start > current) ?? flagged[0])
				: ([...flagged].reverse().find((r) => r.cue.start < current) ?? flagged.at(-1)!);
		this.store.select(target.cue.id);
		this.playback.seek(target.cue.start);
	}

	togglePlay(): void {
		this.playback.toggle();
	}

	// ---- Cue and track operations (timeline menus) -----------------------

	/** Track new cues go to: the selected cue's, else the first unlocked one. */
	private targetTrack(trackId?: TrackId): TrackId | undefined {
		if (trackId) return trackId;
		const p = this.store.primary();
		if (p && !p.track.locked) return p.track.id;
		return this.store.project().tracks.find((t) => !t.locked)?.id;
	}

	private freshCopy(c: Cue, offset: Ms): Cue {
		const copy = { ...structuredClone(c), id: newId('cue') };
		copy.start += offset;
		copy.end += offset;
		copy.words?.forEach((w) => ((w.start += offset), (w.end += offset)));
		return copy;
	}

	/** Add an empty two-second cue and select it. */
	newCueAt(atMs: Ms = this.store.playhead(), trackId?: TrackId): void {
		const id = this.targetTrack(trackId);
		if (!id || this.store.track(id)?.locked) return;
		const cue = createCue(Math.round(atMs), Math.round(atMs) + 2000, '');
		this.store.apply('New cue', addCue(id, cue));
		this.store.select(cue.id);
	}

	copy(): void {
		const sel = this.store.selectedCues();
		if (!sel.length) return;
		const t0 = Math.min(...sel.map((r) => r.cue.start));
		this.clipboard = sel.map((r) => this.freshCopy(r.cue, -t0));
	}

	/** Copy the selection, then delete it (cues on locked tracks are copied but kept). */
	cut(): void {
		this.copy();
		const ids = this.store
			.selectedCues()
			.filter((r) => !r.track.locked)
			.map((r) => r.cue.id);
		if (!ids.length) return;
		this.store.apply(ids.length > 1 ? `Cut ${ids.length} cues` : 'Cut cue', deleteCues(ids));
		this.store.clearSelection();
	}

	get canPaste(): boolean {
		return this.clipboard.length > 0;
	}

	paste(atMs: Ms = this.store.playhead(), trackId?: TrackId): void {
		const id = this.targetTrack(trackId);
		if (!id || !this.clipboard.length || this.store.track(id)?.locked) return;
		const cues = this.clipboard.map((c) => this.freshCopy(c, Math.round(atMs)));
		this.store.apply(cues.length > 1 ? `Paste ${cues.length} cues` : 'Paste cue', (p) => {
			for (const c of cues) addCue(id, c)(p);
		});
		this.store.selection.set(new Set(cues.map((c) => c.id)));
	}

	/** Copies of the selection placed right after it, on the same tracks. */
	duplicateSelected(): void {
		const sel = this.store.selectedCues().filter((r) => !r.track.locked);
		if (!sel.length) return;
		const t0 = Math.min(...sel.map((r) => r.cue.start));
		const t1 = Math.max(...sel.map((r) => r.cue.end));
		const copies = sel.map((r) => ({ track: r.track.id, cue: this.freshCopy(r.cue, t1 - t0) }));
		this.store.apply(sel.length > 1 ? `Duplicate ${sel.length} cues` : 'Duplicate cue', (p) => {
			for (const c of copies) addCue(c.track, c.cue)(p);
		});
		this.store.selection.set(new Set(copies.map((c) => c.cue.id)));
	}

	/** Ctrl+A: the selected cue's track, or the first unlocked one when nothing is selected. */
	selectAllOnTrack(trackId = this.targetTrack()): void {
		const t = trackId ? this.store.track(trackId) : undefined;
		if (t) this.store.selection.set(new Set(t.cues.map((c) => c.id)));
	}

	/** Set the preset on cues; picking the track default clears the override. */
	setPreset(ids: CueId[], styleId: StyleId): void {
		const name = this.store.project().styles[styleId]?.name ?? 'preset';
		this.store.apply(`Set style to ${name}`, (p) => {
			const set = new Set(ids);
			for (const t of p.tracks) {
				if (t.locked) continue;
				for (const c of t.cues) {
					if (!set.has(c.id)) continue;
					if (styleId === t.defaultStyleId) delete c.styleId;
					else c.styleId = styleId;
				}
			}
		});
	}

	moveToTrack(ids: CueId[], trackId: TrackId): void {
		const name = this.store.track(trackId)?.name ?? 'track';
		this.store.apply(`Move to ${name}`, moveCues(ids, 0, trackId));
	}

	/** Shift cues by `deltaMs` keeping their spacing (clamped at 0). */
	shiftTiming(ids: CueId[], deltaMs: Ms): void {
		if (!deltaMs) return;
		const rows = this.store.allCues().filter((r) => ids.includes(r.cue.id));
		const minStart = Math.min(...rows.map((r) => r.cue.start));
		this.store.apply('Shift timing', moveCues(ids, Math.max(-minStart, deltaMs)));
	}

	/** Add an empty track ("Track 3"…) below `afterId`, or at the bottom. Returns its id. */
	newTrack(afterId?: TrackId): TrackId {
		const p = this.store.project();
		let n = p.tracks.length + 1;
		while (p.tracks.some((t) => t.name === `Track ${n}`)) n++;
		const track = createTrack(
			`Track ${n}`,
			TRACK_COLORS[p.tracks.length % TRACK_COLORS.length],
		);
		const after = p.tracks.findIndex((t) => t.id === afterId);
		this.store.apply('New track', addTrack(track, after < 0 ? undefined : after + 1));
		return track.id;
	}

	/** Move a track one place up (-1) or down (1) the stack. */
	moveTrack(trackId: TrackId, by: -1 | 1): void {
		const tracks = this.store.project().tracks;
		const from = tracks.findIndex((t) => t.id === trackId);
		const to = from + by;
		if (from < 0 || to < 0 || to >= tracks.length) return;
		const name = tracks[from].name;
		this.store.apply(`Move ${name} ${by < 0 ? 'up' : 'down'}`, reorderTrack(trackId, to));
	}

	duplicateTrack(trackId: TrackId): void {
		const p = this.store.project();
		const src = p.tracks.find((t) => t.id === trackId);
		if (!src) return;
		const copy = {
			...structuredClone(src),
			id: newId('trk'),
			name: `${src.name} copy`,
			locked: false,
			cues: src.cues.map((c) => this.freshCopy(c, 0)),
		};
		this.store.apply(
			`Duplicate ${src.name}`,
			addTrack(copy, p.tracks.findIndex((t) => t.id === trackId) + 1),
		);
	}

	deleteTrack(trackId: TrackId): void {
		const t = this.store.track(trackId);
		if (!t) return;
		this.store.apply(`Delete ${t.name}`, removeTrack(trackId));
		const gone = new Set(t.cues.map((c) => c.id));
		this.store.selection.set(
			new Set([...this.store.selection()].filter((id) => !gone.has(id))),
		);
	}

	renameTrack(trackId: TrackId, name: string): void {
		const t = this.store.track(trackId);
		const clean = name.trim();
		if (t && clean && clean !== t.name)
			this.store.apply(`Rename ${t.name}`, updateTrack(trackId, { name: clean }));
	}

	setTrackColor(trackId: TrackId, color: string): void {
		this.store.apply('Track color', updateTrack(trackId, { color }));
	}

	setTrackPreset(trackId: TrackId, styleId: StyleId): void {
		const name = this.store.project().styles[styleId]?.name ?? 'preset';
		this.store.apply(
			`Set track style to ${name}`,
			updateTrack(trackId, { defaultStyleId: styleId }),
		);
	}
}
