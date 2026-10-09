import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { Project } from '../core/model/types';
import { parseProject, serializeProject } from '../core/project/serialize';
import { isDesktop } from './file-io';
import { ProjectFiles } from './project-files';
import { ProjectStore } from './project-store';

/** A copy of a project with unsaved changes, kept in case the app closes before it's saved. */
export interface RecoveryEntry {
	projectId: string;
	name: string;
	/** Where the project was saved, if it ever was; recovering keeps saving there. */
	path: string | null;
	savedAt: number;
	/** The serialized project. */
	project: string;
}

/** How long after an edit the recovery copy is written. */
const DELAY_MS = 2000;
const BROWSER_PREFIX = 'bc.recovery.';

/**
 * The open project, kept in sessionStorage so a reload of the window (not a restart of the
 * app) reopens it: from its recovery copy when it has unsaved changes, else from where it's
 * saved, else (a new project with no changes yet) from the copy kept here.
 */
interface SessionProject {
	projectId: string;
	path: string | null;
	dirty: boolean;
	project?: string;
}
const SESSION_KEY = 'bc.session';

/** Where recovery copies live: the app's data folder on desktop, localStorage in the browser. */
const storage = {
	async dir(): Promise<string> {
		const dir = await join(await appLocalDataDir(), 'recovery');
		await mkdir(dir, { recursive: true });
		return dir;
	},
	async write(e: RecoveryEntry): Promise<void> {
		const text = JSON.stringify(e);
		if (isDesktop)
			return writeTextFile(await join(await this.dir(), `${e.projectId}.json`), text);
		localStorage.setItem(BROWSER_PREFIX + e.projectId, text);
	},
	async remove(projectId: string): Promise<void> {
		if (isDesktop) return remove(await join(await this.dir(), `${projectId}.json`));
		localStorage.removeItem(BROWSER_PREFIX + projectId);
	},
	async list(): Promise<RecoveryEntry[]> {
		const texts: string[] = [];
		if (isDesktop) {
			const dir = await this.dir();
			for (const f of await readDir(dir))
				if (f.isFile && f.name.endsWith('.json'))
					texts.push(await readTextFile(await join(dir, f.name)));
		} else {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key?.startsWith(BROWSER_PREFIX)) texts.push(localStorage.getItem(key) ?? '');
			}
		}
		return texts.flatMap((t) => {
			try {
				return [JSON.parse(t) as RecoveryEntry];
			} catch {
				return [];
			}
		});
	},
};

function readSession(): SessionProject | null {
	try {
		return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as SessionProject | null;
	} catch {
		return null;
	}
}

function writeSession(s: SessionProject): void {
	try {
		sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
	} catch {
		// Too big or storage blocked: a reload falls back to the Start screen's recovery list.
		try {
			sessionStorage.removeItem(SESSION_KEY);
		} catch {
			// Storage blocked.
		}
	}
}

/**
 * Autosave for crash recovery (PLAN §5.1). While the open project has unsaved changes, a copy
 * is written a couple of seconds after each edit and when the window loses focus. Saving, or
 * leaving the project on purpose (Discard / Don't save), deletes it. A copy still there at
 * launch means the app closed unexpectedly, and the Start screen offers it back.
 */
@Injectable({ providedIn: 'root' })
export class Recovery {
	private readonly store = inject(ProjectStore);
	private readonly files = inject(ProjectFiles);
	/** Copies left over from an earlier session, newest first. */
	readonly entries = signal<RecoveryEntry[]>([]);
	/** Projects this session has written a copy for (so it only deletes its own). */
	private readonly written = new Set<string>();
	private lastId: string | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** The project open before the window reloaded, if it did. */
	private readonly previous = readSession();

	constructor() {
		effect(() => {
			const id = this.store.project().id;
			const dirty = this.store.dirty();
			const path = this.files.currentPath();
			untracked(() => {
				writeSession({
					projectId: id,
					path,
					dirty,
					project: dirty || path ? undefined : serializeProject(this.store.project()),
				});
				// Switching projects only happens after saving or choosing to discard.
				if (this.lastId && this.lastId !== id) void this.discard(this.lastId);
				this.lastId = id;
				if (dirty) this.schedule();
				else void this.discard(id);
			});
		});
		window.addEventListener('blur', () => void this.flush());
	}

	/**
	 * After the window reloads, reopen the project that was open, then list the leftover copies.
	 * Runs before the app first renders (app.config.ts).
	 */
	async resume(): Promise<void> {
		const s = this.previous;
		try {
			if (s?.dirty) {
				const entry = (await storage.list()).find((e) => e.projectId === s.projectId);
				if (entry) await this.recover(entry);
			} else if (s?.path && isDesktop) {
				await this.files.open(s.path);
			} else if (s?.project) {
				await this.files.restore(parseProject(s.project), null);
				this.store.markSaved();
			}
		} catch (e) {
			console.warn('Could not reopen the project after reloading', e);
		}
		await this.refresh();
	}

	async refresh(): Promise<void> {
		try {
			const list = await storage.list();
			this.entries.set(
				list
					.filter((e) => !this.written.has(e.projectId))
					.sort((a, b) => b.savedAt - a.savedAt),
			);
		} catch (e) {
			console.warn('Could not read recovery copies', e);
		}
	}

	private schedule(): void {
		this.timer ??= setTimeout(() => void this.flush(), DELAY_MS);
	}

	/** Write the recovery copy now, if there are unsaved changes. */
	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (!this.store.dirty()) return;
		const p = this.store.project();
		try {
			await storage.write({
				projectId: p.id,
				name: p.name,
				path: this.files.currentPath(),
				savedAt: Date.now(),
				project: serializeProject(p),
			});
			this.written.add(p.id);
		} catch (e) {
			console.warn('Could not write recovery copy', e);
		}
	}

	/** Delete a project's recovery copy (only ones this session wrote, or one being dismissed). */
	async discard(projectId: string, force = false): Promise<void> {
		if (!force && !this.written.has(projectId)) return;
		this.written.delete(projectId);
		if (this.store.project().id === projectId && this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		try {
			await storage.remove(projectId);
		} catch {
			// Already gone.
		}
	}

	/** Dismiss a leftover copy from the Start screen. */
	async dismiss(e: RecoveryEntry): Promise<void> {
		await this.discard(e.projectId, true);
		this.entries.update((l) => l.filter((x) => x.projectId !== e.projectId));
	}

	/** Reopen a leftover copy as the current project, with its changes still unsaved. */
	async recover(e: RecoveryEntry): Promise<boolean> {
		let project: Project;
		try {
			project = parseProject(e.project);
		} catch (err) {
			this.files.error.set(`${e.name} couldn't be recovered. ${err}`);
			return false;
		}
		if (!(await this.files.restore(project, e.path))) return false;
		// The copy now belongs to this session: it's rewritten on edits and deleted on save.
		this.written.add(e.projectId);
		this.entries.update((l) => l.filter((x) => x.projectId !== e.projectId));
		return true;
	}
}
