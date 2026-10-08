import { Injectable, signal } from '@angular/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { PickedFile, fromFile, fromPath, isDesktop } from './file-io';

export type DropKind = 'video' | 'project' | 'captions' | 'other';

export function dropKind(name: string, mimeType = ''): DropKind {
	if (mimeType.startsWith('video/') || /\.(mp4|mov|mkv|webm)$/i.test(name)) return 'video';
	if (/\.bcproj$/i.test(name)) return 'project';
	if (/\.(srv3|ytt|srt|vtt|sbv)$/i.test(name)) return 'captions';
	return 'other';
}

/** What is being dragged over the window. */
export interface DragHover {
	/** Known on desktop; the browser only reveals files on drop. */
	file: PickedFile | null;
	kind: DropKind | null;
}

/**
 * Files dragged onto the window. The desktop app gets paths from Tauri's drag-drop events
 * (the webview's own HTML5 drop events don't fire there); the browser uses HTML5 events.
 * The active screen sets `handler` to receive drops.
 */
@Injectable({ providedIn: 'root' })
export class FileDrop {
	readonly hover = signal<DragHover | null>(null);
	handler: ((file: PickedFile) => void) | null = null;
	private depth = 0;

	constructor() {
		if (isDesktop) void this.listenDesktop();
		else this.listenBrowser();
	}

	private async listenDesktop(): Promise<void> {
		await getCurrentWebview().onDragDropEvent(({ payload: e }) => {
			if (e.type === 'enter') {
				const file = e.paths[0] ? fromPath(e.paths[0]) : null;
				this.hover.set({ file, kind: file ? dropKind(file.name) : null });
			} else if (e.type === 'leave') {
				this.hover.set(null);
			} else if (e.type === 'drop') {
				this.hover.set(null);
				if (e.paths[0]) this.handler?.(fromPath(e.paths[0]));
			}
		});
	}

	private listenBrowser(): void {
		const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
		addEventListener('dragenter', (e) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			if (this.depth++ === 0) {
				const type = e.dataTransfer!.items[0]?.type ?? '';
				this.hover.set({ file: null, kind: type.startsWith('video/') ? 'video' : null });
			}
		});
		addEventListener('dragover', (e) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			e.dataTransfer!.dropEffect = this.handler ? 'copy' : 'none';
		});
		addEventListener('dragleave', (e) => {
			if (hasFiles(e) && --this.depth <= 0) this.reset();
		});
		addEventListener('drop', (e) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			this.reset();
			const file = e.dataTransfer!.files[0];
			if (file) this.handler?.(fromFile(file));
		});
	}

	private reset(): void {
		this.depth = 0;
		this.hover.set(null);
	}
}
