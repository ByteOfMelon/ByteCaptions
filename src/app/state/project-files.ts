import { Injectable, inject, signal } from '@angular/core';
import { addTrack } from '../core/commands/edits';
import { formatForFilename, sniffFormat } from '../core/formats';
import { createProject, createTrack } from '../core/model/defaults';
import { MediaRef, Project } from '../core/model/types';
import { PROJECT_EXTENSION, parseProject, serializeProject } from '../core/project/serialize';
import {
	CAPTION_FILTER,
	PROJECT_FILTER,
	PickedFile,
	VIDEO_FILTER,
	basename,
	confirmAction,
	fileExists,
	fromPath,
	isDesktop,
	openFile,
	pickSaveTarget,
	probeVideo,
	stripExtension,
	writeText,
} from './file-io';
import { MediaSource } from './media-source';
import { ProjectStore } from './project-store';
import { RecentProject, RecentProjects } from './recent-projects';

/** Track colors from the design tokens (--color-track-1..4), assigned round-robin. */
export const TRACK_COLORS = ['#4a6fa5', '#7e60a6', '#9a6a3e', '#3b7c6f'];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** New, open, save and import. Paths on desktop; File objects and downloads in the browser. */
@Injectable({ providedIn: 'root' })
export class ProjectFiles {
	private readonly store = inject(ProjectStore);
	private readonly recent = inject(RecentProjects);
	private readonly media = inject(MediaSource);
	/** Last error to show the user (e.g. a bad project file). */
	readonly error = signal<string | null>(null);
	/** Where the open project is saved; Save writes here without asking (desktop only). */
	readonly currentPath = signal<string | null>(null);
	/** False for a new project until its first save (the browser saves by download, without a path). */
	readonly saved = signal(false);

	nextTrackColor(p: Project = this.store.project()): string {
		return TRACK_COLORS[p.tracks.length % TRACK_COLORS.length];
	}

	private loadProject(p: Project, path: string | null, saved: boolean): void {
		this.store.load(p);
		this.currentPath.set(path);
		this.saved.set(saved);
		this.error.set(null);
	}

	/** Ask before replacing a project with unsaved changes. Resolves true to go ahead. */
	async confirmDiscard(): Promise<boolean> {
		if (!this.store.dirty()) return true;
		return confirmAction(
			`${this.store.project().name} has unsaved changes. Discard them?`,
			'Unsaved changes',
			'Discard changes',
		);
	}

	/** Start an empty project (e.g. before importing captions on the Start screen). */
	newEmpty(name = 'Untitled'): void {
		const p = createProject(name);
		p.tracks = [];
		this.media.clear();
		this.loadProject(p, null, false);
	}

	/** Start a fresh project named after a video. Resolves false if cancelled. */
	async newFromVideo(file?: PickedFile | null): Promise<boolean> {
		file ??= await openFile(VIDEO_FILTER);
		if (!file || !(await this.confirmDiscard())) return false;
		const info = await probeVideo(file.mediaUrl());
		const p = createProject(stripExtension(file.name));
		p.fps = 60;
		p.tracks[0].name = 'Dialogue';
		p.tracks[0].color = TRACK_COLORS[0];
		p.media = {
			path: file.path ?? file.name,
			hash: '',
			durationMs: info?.durationMs ?? 0,
			width: info?.width ?? 0,
			height: info?.height ?? 0,
		};
		this.media.load(file);
		this.loadProject(p, null, false);
		return true;
	}

	/** Open a project file (picked, dropped or by path). Resolves false on cancel or error. */
	async open(file?: PickedFile | string | null): Promise<boolean> {
		if (typeof file === 'string') file = fromPath(file);
		file ??= await openFile(PROJECT_FILTER);
		if (!file || !(await this.confirmDiscard())) return false;
		try {
			const p = parseProject(await file.text());
			this.loadProject(p, file.path, true);
			this.recent.record(p, file.name, file.path);
			await this.media.loadForProject(p);
			return true;
		} catch (e) {
			this.error.set(`${file.name} couldn't be opened. ${message(e)}`);
			return false;
		}
	}

	/**
	 * Reopen a recovered copy (see Recovery). Its changes stay unsaved, and Save writes to
	 * where it was saved before, if anywhere.
	 */
	async restore(p: Project, path: string | null): Promise<boolean> {
		if (!(await this.confirmDiscard())) return false;
		this.loadProject(p, path, false);
		this.store.dirty.set(true);
		await this.media.loadForProject(p);
		return true;
	}

	/** Reopen a recent project: by path on desktop, by asking for the file in the browser. */
	async openRecent(r: RecentProject): Promise<boolean> {
		if (!isDesktop || !r.path) return this.open();
		if (!(await fileExists(r.path))) {
			this.recent.remove(r.id);
			this.error.set(`${r.fileName} was moved or deleted, so it was removed from the list.`);
			return false;
		}
		return this.open(r.path);
	}

	/** Save to the current path, or ask where on first save (and always with `saveAs`). */
	async save(saveAs = false): Promise<boolean> {
		const p = this.store.project();
		const suggested = `${p.name}.${PROJECT_EXTENSION}`;
		let path = saveAs ? null : this.currentPath();
		let name = path ? basename(path) : suggested;
		if (!path && isDesktop) {
			const target = await pickSaveTarget(suggested, PROJECT_FILTER);
			if (!target) return false;
			({ path, name } = target);
		}
		try {
			await writeText({ name, path }, serializeProject(p));
		} catch (e) {
			this.error.set(`Couldn't save ${name}. ${message(e)}`);
			return false;
		}
		this.currentPath.set(path);
		this.saved.set(true);
		this.store.dirty.set(false);
		this.recent.record(p, name, path);
		return true;
	}

	/** Import a caption file as a new track of the current project. */
	async importCaptions(file?: PickedFile | null): Promise<boolean> {
		file ??= await openFile(CAPTION_FILTER);
		if (!file) return false;
		const src = await file.text();
		const format = formatForFilename(file.name) ?? sniffFormat(src);
		if (!format) {
			this.error.set(`${file.name} isn't a caption format ByteCaptions can read.`);
			return false;
		}
		const result = format.import(src);
		const track = createTrack(stripExtension(file.name), this.nextTrackColor());
		track.cues = result.cues;
		this.store.apply(`Import ${file.name}`, (p) => {
			Object.assign(p.styles, result.styles ?? {});
			Object.assign(p.positions, result.positions ?? {});
			addTrack(track)(p);
		});
		this.error.set(result.warnings.length ? result.warnings.join(' ') : null);
		return true;
	}

	/** Link a video to the open project (dropped on the editor). */
	async linkVideo(file: PickedFile): Promise<void> {
		const media = await this.videoRef(file);
		this.media.load(file);
		this.store.apply('Link video', (p) => {
			p.media = media;
		});
	}

	/** Probe `file` for the project's media reference (Link video, Project settings). */
	async videoRef(file: PickedFile): Promise<MediaRef> {
		const info = await probeVideo(file.mediaUrl());
		return {
			path: file.path ?? file.name,
			hash: '',
			durationMs: info?.durationMs ?? this.store.project().media?.durationMs ?? 0,
			width: info?.width ?? 0,
			height: info?.height ?? 0,
		};
	}

	/** Play `file` in the preview (its project media is set separately). */
	loadVideo(file: PickedFile): void {
		this.media.load(file);
	}
}
