import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { addMarker, deleteMarker, updateMarker } from '../../core/commands/edits';
import { createMarker } from '../../core/model/defaults';
import { Marker, MarkerColor, MarkerId, Ms } from '../../core/model/types';
import { snapToFrame } from '../../core/time/timecode';
import { EditorUi } from '../../state/editor-ui';
import { ProjectStore } from '../../state/project-store';
import { Playback } from '../player/playback';

/** Marker colors in menu order, with their names. */
export const MARKER_COLOR_NAMES: { id: MarkerColor; label: string }[] = [
	{ id: 'yellow', label: 'Yellow' },
	{ id: 'red', label: 'Red' },
	{ id: 'blue', label: 'Blue' },
	{ id: 'purple', label: 'Purple' },
	{ id: 'green', label: 'Green' },
];

/**
 * Markers (Shift+M): notes pinned to video times, shown on the ruler and in the Markers tab.
 * Holds which marker is selected and which one's edit popover is open.
 */
@Injectable({ providedIn: 'root' })
export class Markers {
	private readonly store = inject(ProjectStore);
	private readonly playback = inject(Playback);
	private readonly ui = inject(EditorUi);

	readonly list = computed(() => this.store.project().markers);
	/** Marker picked on the ruler or in the Markers tab. */
	readonly selected = signal<MarkerId | null>(null);
	/** Marker whose edit popover is open (on the ruler). */
	readonly editing = signal<MarkerId | null>(null);

	constructor() {
		// A different project starts with nothing selected.
		const projectId = computed(() => this.store.project().id);
		effect(() => {
			projectId();
			untracked(() => {
				this.selected.set(null);
				this.editing.set(null);
			});
		});
		// Undo can remove a marker out from under the selection or the popover.
		effect(() => {
			const ids = new Set(this.list().map((m) => m.id));
			untracked(() => {
				if (this.selected() && !ids.has(this.selected()!)) this.selected.set(null);
				if (this.editing() && !ids.has(this.editing()!)) this.editing.set(null);
			});
		});
	}

	find(id: MarkerId | null): Marker | undefined {
		return id ? this.list().find((m) => m.id === id) : undefined;
	}

	/** 1-based position in time order, as shown in the Markers tab. */
	number(id: MarkerId): number {
		return this.list().findIndex((m) => m.id === id) + 1;
	}

	/** Shift+M: add a marker at the playhead (or reuse one already there) and open it. */
	addAtPlayhead(): void {
		this.addAt(this.store.playhead());
	}

	/** Add a marker at `ms` (snapped to a frame), or reuse one already there, and open it. */
	addAt(ms: Ms): void {
		const fps = this.store.project().fps;
		const at = snapToFrame(ms, fps);
		const existing = this.list().find((m) => Math.abs(m.at - at) < 500 / fps);
		if (existing) return this.edit(existing.id);
		const marker = createMarker(at);
		this.store.apply('Add marker', addMarker(marker));
		this.edit(marker.id);
	}

	/** Select a marker and move the playhead to it. */
	select(id: MarkerId): void {
		const m = this.find(id);
		if (!m) return;
		this.selected.set(id);
		this.playback.seek(m.at);
	}

	edit(id: MarkerId): void {
		this.selected.set(id);
		this.editing.set(id);
	}

	/** No-ops when nothing changed or the marker is gone (e.g. undone while being edited). */
	setNote(id: MarkerId, note: string): void {
		const m = this.find(id);
		if (m && m.note !== note) this.store.apply('Edit marker note', updateMarker(id, { note }));
	}

	setColor(id: MarkerId, color: MarkerColor): void {
		const m = this.find(id);
		if (m && m.color !== color) this.store.apply('Marker color', updateMarker(id, { color }));
	}

	move(id: MarkerId, at: Ms): void {
		this.store.apply('Move marker', updateMarker(id, { at }));
	}

	remove(id: MarkerId): void {
		this.store.apply('Delete marker', deleteMarker(id));
	}

	/** Next (1) / previous (-1) marker from the playhead. */
	goTo(dir: 1 | -1): void {
		const t = this.store.playhead();
		const list = this.list();
		const m =
			dir > 0
				? list.find((m) => m.at > t + 1)
				: [...list].reverse().find((m) => m.at < t - 1);
		if (m) this.select(m.id);
	}

	/** Shows the Markers tab (the palette's "Show markers"). */
	showTab(): void {
		this.ui.sideTab.set('markers');
	}
}
