import { Injectable, signal } from '@angular/core';
import { Project } from '../core/model/types';
import { PickedFile, fileExists, fromPath, isDesktop } from './file-io';

/** The video the preview plays. Desktop streams it from disk by path. */
@Injectable({ providedIn: 'root' })
export class MediaSource {
	readonly url = signal<string | null>(null);
	/** Path of the loaded video on disk (desktop only). */
	readonly path = signal<string | null>(null);

	load(file: PickedFile): void {
		this.clear();
		this.url.set(file.mediaUrl());
		this.path.set(file.path);
	}

	clear(): void {
		const old = this.url();

		if (old?.startsWith('blob:')) URL.revokeObjectURL(old);

		this.url.set(null);
		this.path.set(null);
	}

	/** Reconnect a project's video after opening it (desktop; the browser needs a drop). */
	async loadForProject(p: Project): Promise<void> {
		this.clear();
		const path = p.media?.path;

		if (isDesktop && path && (await fileExists(path))) this.load(fromPath(path));
	}
}
