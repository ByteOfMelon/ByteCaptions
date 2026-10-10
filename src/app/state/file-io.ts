import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { ask, message, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exists, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Ms } from '../core/model/types';

/**
 * Checks how file I/O should be handled depending on web vs desktop
 */
export const isDesktop = isTauri();
export const WEBSITE = 'https://github.com/ByteOfMelon/ByteCaptions';

export interface FileFilter {
	name: string;
	extensions: string[];
}

export const VIDEO_FILTER: FileFilter = {
	name: 'Video',
	extensions: ['mp4', 'mov', 'mkv', 'webm'],
};
export const PROJECT_FILTER: FileFilter = { name: 'ByteCaptions project', extensions: ['bcproj'] };
export const CAPTION_FILTER: FileFilter = {
	name: 'Captions',
	extensions: ['srv3', 'ytt', 'srt', 'vtt', 'sbv'],
};

/** A file the user picked or dropped - a path on desktop, a File in the browser */
export interface PickedFile {
	name: string;
	/** Absolute path (desktop only) */
	path: string | null;
	text(): Promise<string>;
	/** Size in bytes, if it can be read */
	size(): Promise<number | null>;
	/** URL a <video> element can play */
	mediaUrl(): string;
}

export function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

export function dirname(path: string): string {
	const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));

	return i > 0 ? path.slice(0, i) : path;
}

export function stripExtension(name: string): string {
	return name.replace(/\.[^.]+$/, '');
}

/**
 * Linux only - the app's local media server (see src-tauri/src/media_server.rs), because WebKitGTK SUCKS
 */
let mediaServer: string | null = null;

/** Look up the media server once at startup, before any video is opened */
export async function initMediaUrls(): Promise<void> {
	if (isDesktop) mediaServer = await invoke<string | null>('media_server').catch(() => null);
}

/** A URL the preview's <video> can play for a local file */
function localMediaUrl(path: string): string {
	return mediaServer ? mediaServer + encodeURIComponent(path) : convertFileSrc(path);
}

export function fromPath(path: string): PickedFile {
	return {
		name: basename(path),
		path,
		text: () => readTextFile(path),
		size: () =>
			stat(path).then(
				(s) => s.size,
				() => null,
			),
		mediaUrl: () => localMediaUrl(path),
	};
}

export function fromFile(file: File): PickedFile {
	let url: string | null = null;

	return {
		name: file.name,
		path: null,
		text: () => file.text(),
		size: async () => file.size,
		mediaUrl: () => (url ??= URL.createObjectURL(file)),
	};
}

export async function fileExists(path: string): Promise<boolean> {
	return isDesktop ? exists(path).catch(() => false) : false;
}

export async function openFile(filter: FileFilter): Promise<PickedFile | null> {
	if (isDesktop) {
		const path = await openDialog({ multiple: false, directory: false, filters: [filter] });

		return typeof path === 'string' ? fromPath(path) : null;
	}

	return new Promise((resolve) => {
		const input = Object.assign(document.createElement('input'), {
			type: 'file',
			accept: filter.extensions.map((e) => `.${e}`).join(','),
		});
		input.onchange = () => resolve(input.files?.[0] ? fromFile(input.files[0]) : null);
		input.oncancel = () => resolve(null);
		input.click();
	});
}

/** Where to write a file - a path on desktop, a picked handle or a download in the browser */
export interface SaveTarget {
	name: string;
	path: string | null;
	handle?: FileSystemFileHandle;
}

interface SavePickerWindow {
	showSaveFilePicker?: (opts: { suggestedName: string }) => Promise<FileSystemFileHandle>;
}

export const canPickSaveTarget = () =>
	isDesktop || !!(window as unknown as SavePickerWindow).showSaveFilePicker;

/** Ask the user where to save */
export async function pickSaveTarget(
	suggested: string,
	filter: FileFilter,
): Promise<SaveTarget | null> {
	if (isDesktop) {
		const path = await saveDialog({ defaultPath: suggested, filters: [filter] });

		return path ? { name: basename(path), path } : null;
	}

	const w = window as unknown as SavePickerWindow;

	if (!w.showSaveFilePicker) return null;

	try {
		const handle = await w.showSaveFilePicker({ suggestedName: suggested });

		return { name: handle.name, path: null, handle };
	} catch {
		return null;
	}
}

/** Write text to a target */
export async function writeText(target: SaveTarget, text: string): Promise<void> {
	if (target.path) return writeTextFile(target.path, text);

	if (target.handle) {
		const w = await target.handle.createWritable();
		await w.write(text);
		await w.close();

		return;
	}

	const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
	const a = Object.assign(document.createElement('a'), { href: url, download: target.name });
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Yes/no question in a native dialog */
export async function confirmAction(
	message: string,
	title: string,
	okLabel: string,
): Promise<boolean> {
	if (isDesktop) return ask(message, { title, kind: 'warning', okLabel, cancelLabel: 'Cancel' });

	return confirm(message);
}

/** Save / Don't save / Cancel before closing with unsaved changes */
export async function askSaveChanges(name: string): Promise<'save' | 'discard' | 'cancel'> {
	const choice = await message(`Do you want to save the changes to ${name}?`, {
		title: 'Unsaved changes',
		kind: 'warning',
		buttons: { yes: 'Save', no: "Don't save", cancel: 'Cancel' },
	});

	if (choice === 'Save' || choice === 'Yes') return 'save';

	if (choice === "Don't save" || choice === 'No') return 'discard';

	return 'cancel';
}

/** Open a web page in the system browser */
export function openExternal(url: string): void {
	if (isDesktop) void openUrl(url);
	else window.open(url, '_blank', 'noopener');
}

export interface VideoInfo {
	durationMs: Ms;
	width: number;
	height: number;
}

/** Read a video's duration and size from its metadata */
export function probeVideo(url: string): Promise<VideoInfo | null> {
	return new Promise((resolve) => {
		const v = document.createElement('video');
		const done = (info: VideoInfo | null) => {
			clearTimeout(timer);
			v.removeAttribute('src');
			v.load();
			resolve(info);
		};
		const timer = setTimeout(() => done(null), 8000);
		v.preload = 'metadata';
		v.muted = true;
		v.onloadedmetadata = () =>
			done(
				Number.isFinite(v.duration)
					? {
							durationMs: Math.round(v.duration * 1000),
							width: v.videoWidth,
							height: v.videoHeight,
						}
					: null,
			);
		v.onerror = () => done(null);
		v.src = url;
	});
}
