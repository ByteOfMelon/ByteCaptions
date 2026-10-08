import { Injectable, signal } from '@angular/core';
import { Ms, Project } from '../core/model/types';
import { dirname } from './file-io';

export interface RecentProject {
	/** The file path, or the project id where paths are unknown (browser). */
	id: string;
	fileName: string;
	/** Absolute path of the project file (desktop only). */
	path: string | null;
	folder: string | null;
	editedAt: number;
	cues: number;
	durationMs: Ms;
}

const KEY = 'bc.recentProjects';
const MAX = 8;

function load(): RecentProject[] {
	try {
		const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

/**
 * Recently opened or saved projects for the Start screen. The desktop app reopens them by
 * path; the browser build can't, so picking one there asks for the file again.
 */
@Injectable({ providedIn: 'root' })
export class RecentProjects {
	readonly list = signal<RecentProject[]>(load());

	record(project: Project, fileName: string, path: string | null = null): void {
		const lastCue = Math.max(0, ...project.tracks.flatMap((t) => t.cues.map((c) => c.end)));
		const entry: RecentProject = {
			id: path ?? project.id,
			fileName,
			path,
			folder: path ? dirname(path) : null,
			editedAt: Date.now(),
			cues: project.tracks.reduce((n, t) => n + t.cues.length, 0),
			durationMs: Math.max(project.media?.durationMs ?? 0, lastCue),
		};
		this.list.update((l) => [entry, ...l.filter((e) => e.id !== entry.id)].slice(0, MAX));
		this.persist();
	}

	remove(id: string): void {
		this.list.update((l) => l.filter((e) => e.id !== id));
		this.persist();
	}

	private persist(): void {
		try {
			localStorage.setItem(KEY, JSON.stringify(this.list()));
		} catch {
			// Storage can be unavailable (private mode); the list just won't persist.
		}
	}
}

/** "Edited 2 hours ago", "Edited yesterday", "Edited Sep 12". */
export function editedLabel(at: number, now = Date.now()): string {
	const min = Math.round((now - at) / 60_000);
	if (min < 1) return 'Edited just now';
	if (min < 60) return `Edited ${min} min ago`;
	const hours = Math.round(min / 60);
	const day = (d: number) => new Date(d).toDateString();
	if (day(at) === day(now)) return `Edited ${hours} hour${hours === 1 ? '' : 's'} ago`;
	if (day(at) === day(now - 86_400_000)) return 'Edited yesterday';
	const date = new Date(at);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	return `Edited ${date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' }),
	})}`;
}
