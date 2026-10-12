import { Injectable, effect, inject, untracked } from '@angular/core';
import { CueId, Ms } from '../core/model/types';
import { ProjectStore } from './project-store';

/** Where you were in a project */
export interface ProjectView {
	playhead: Ms;
	selection: CueId[];
	zoom?: number;
	viewStart?: Ms;
	at: number;
}

const KEY = 'bc.projectViews';
const MAX = 50;
const SAVE_DELAY_MS = 1000;

function load(): Record<string, ProjectView> {
	try {
		const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');

		return v && typeof v === 'object' ? v : {};
	} catch {
		return {};
	}
}

/**
 * Remembers the playhead, selection and timeline view per project, and puts them back when
 * the project is opened again
 */
@Injectable({ providedIn: 'root' })
export class ViewMemory {
	private readonly store = inject(ProjectStore);
	private views = load();
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** Set while restoring, so the restore itself isn't saved over the remembered view */
	private restoring = false;
	private lastLoad = -1;

	constructor() {
		effect(() => {
			this.store.loads();
			untracked(() => this.restore(this.store.project().id));
		});
		effect(() => {
			const load = this.store.loads();
			const playhead = this.store.playhead();
			const selection = [...this.store.selection()];
			untracked(() => {
				// The reset that comes with opening a project isn't where the user was
				if (load !== this.lastLoad) {
					this.lastLoad = load;

					return;
				}

				this.update(this.store.project().id, { playhead, selection });
			});
		});
	}

	/** The remembered view for a project, if any */
	get(projectId: string): ProjectView | undefined {
		return this.views[projectId];
	}

	/** The timeline reports its zoom and scroll position here */
	timeline(zoom: number, viewStart: Ms): void {
		this.update(this.store.project().id, { zoom, viewStart });
	}

	private restore(id: string): void {
		const v = this.views[id];

		if (!v) return;

		this.restoring = true;
		this.store.seek(v.playhead);
		const ids = new Set(this.store.allCues().map((r) => r.cue.id));
		this.store.selection.set(new Set(v.selection.filter((c) => ids.has(c))));
		this.restoring = false;
	}

	private update(id: string, change: Partial<ProjectView>): void {
		if (this.restoring) return;

		const old = this.views[id] ?? { playhead: 0, selection: [], at: 0 };
		this.views[id] = { ...old, ...change, at: Date.now() };

		if (this.timer) clearTimeout(this.timer);

		this.timer = setTimeout(() => this.persist(), SAVE_DELAY_MS);
	}

	private persist(): void {
		this.timer = null;
		// Keep the most recently used projects
		const recent = Object.entries(this.views)
			.sort(([, a], [, b]) => b.at - a.at)
			.slice(0, MAX);
		this.views = Object.fromEntries(recent);

		try {
			localStorage.setItem(KEY, JSON.stringify(this.views));
		} catch {
			console.warn('[ViewMemory] Failed to persist view memory to localStorage');
		}
	}
}
