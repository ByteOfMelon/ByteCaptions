import { Injectable, computed, inject, signal } from '@angular/core';
import { Channel, invoke } from '@tauri-apps/api/core';
import { exportSrv3 } from '../core/formats/srv3';
import { Ms, Project, TrackId } from '../core/model/types';
import { isDesktop } from './file-io';
import { ProjectStore } from './project-store';

export interface YtAccount {
	id: string;
	title: string;
	thumbnail: string;
	/** Playlist of the channel's uploads. */
	uploads: string;
}

export interface YtVideo {
	id: string;
	title: string;
	channelId: string;
	durationMs: Ms;
	privacy: 'public' | 'unlisted' | 'private' | string;
	publishedAt: string;
	thumbnail: string;
}

export interface YtCaption {
	id: string;
	language: string;
	name: string;
	isDraft: boolean;
}

/** Errors from src-tauri/src/youtube.rs; `kind` picks the message and actions. */
export interface YtError {
	kind:
		| 'not-configured'
		| 'signed-out'
		| 'cancelled'
		| 'timeout'
		| 'quota'
		| 'forbidden'
		| 'not-found'
		| 'no-channel'
		| 'offline'
		| 'failed';
	message: string;
}

export type UploadStepId = 'combine' | 'build' | 'upload' | 'check';
export interface UploadStep {
	id: UploadStepId;
	label: string;
	status: 'waiting' | 'running' | 'done' | 'error';
	detail: string;
}

export interface UploadOptions {
	video: YtVideo;
	trackIds: TrackId[];
	/** YouTube language code, e.g. "en". */
	language: string;
	/** Track name shown on YouTube; empty shows just the language. */
	name: string;
	draft: boolean;
	/** The video's existing track in this language, replaced by the upload. */
	replace: YtCaption | null;
}

/** Caption languages offered for upload, with YouTube's codes. */
export const CAPTION_LANGUAGES: { code: string; name: string }[] = [
	['en', 'English'],
	['es', 'Spanish'],
	['fr', 'French'],
	['de', 'German'],
	['it', 'Italian'],
	['pt', 'Portuguese'],
	['nl', 'Dutch'],
	['pl', 'Polish'],
	['ru', 'Russian'],
	['uk', 'Ukrainian'],
	['tr', 'Turkish'],
	['ar', 'Arabic'],
	['hi', 'Hindi'],
	['id', 'Indonesian'],
	['vi', 'Vietnamese'],
	['ja', 'Japanese'],
	['ko', 'Korean'],
	['zh', 'Chinese'],
].map(([code, name]) => ({ code, name }));

export function languageName(code: string): string {
	return CAPTION_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** Videos this close to the project's length count as the same video. */
const SAME_LENGTH_MS = 1500;

const asError = (e: unknown): YtError =>
	typeof e === 'object' && e && 'kind' in e
		? (e as YtError)
		: { kind: 'failed', message: String(e) };

/** The selected tracks combined into one, regardless of preview mute/solo (as in Export). */
export function combineTracks(p: Project, ids: ReadonlySet<TrackId>): Project {
	return {
		...p,
		tracks: p.tracks
			.filter((t) => ids.has(t.id))
			.map((t) => ({ ...t, muted: false, solo: false })),
	};
}

/**
 * YouTube sign-in and caption upload (PLAN §5.12), desktop only: the backend
 * (src-tauri/src/youtube.rs) holds the sign-in and talks to the YouTube API. The upload job
 * lives here so it keeps going when the dialog closes.
 */
@Injectable({ providedIn: 'root' })
export class YouTube {
	private readonly store = inject(ProjectStore);

	/** This build has a Google OAuth client (false in the browser). */
	readonly available = signal(false);
	/** The signed-in channel; null when signed out, undefined while checking. */
	readonly account = signal<YtAccount | null | undefined>(undefined);
	readonly accountError = signal<YtError | null>(null);
	readonly signingIn = signal(false);

	/** The channel's uploads loaded so far, newest first. */
	readonly videos = signal<YtVideo[]>([]);
	readonly totalVideos = signal(0);
	readonly loadingVideos = signal(false);
	readonly videosError = signal<YtError | null>(null);
	private nextPage: string | null | undefined;
	readonly hasMoreVideos = signal(false);

	readonly phase = signal<'setup' | 'running' | 'done' | 'error'>('setup');
	readonly steps = signal<UploadStep[]>([]);
	readonly error = signal<YtError | null>(null);
	readonly result = signal<{
		options: UploadOptions;
		caption: YtCaption;
		cues: number;
		warnings: number;
		took: string;
	} | null>(null);
	/** What the running or finished job is uploading. */
	readonly job = signal<UploadOptions | null>(null);
	readonly running = computed(() => this.phase() === 'running');

	/** Run at start-up, so menus know whether to offer YouTube before they're built. */
	async init(): Promise<void> {
		if (!isDesktop) return;

		const ok = await invoke<boolean>('youtube_available').catch(() => false);
		this.available.set(ok);

		if (ok) void this.refreshAccount();
	}

	async refreshAccount(): Promise<void> {
		this.accountError.set(null);

		try {
			this.setAccount(await invoke<YtAccount | null>('youtube_account'));
		} catch (e) {
			this.accountError.set(asError(e));
			this.account.set(null);
		}
	}

	private setAccount(a: YtAccount | null): void {
		if (a?.id !== this.account()?.id) {
			this.videos.set([]);
			this.nextPage = undefined;
			this.hasMoreVideos.set(false);
		}

		this.account.set(a);
	}

	/** Sign in in the browser. Resolves once signed in, or quietly if it was cancelled. */
	async signIn(): Promise<boolean> {
		this.signingIn.set(true);
		this.accountError.set(null);

		try {
			this.setAccount(await invoke<YtAccount | null>('youtube_sign_in'));

			return !!this.account();
		} catch (e) {
			const err = asError(e);

			if (err.kind !== 'cancelled') this.accountError.set(err);

			return false;
		} finally {
			this.signingIn.set(false);
		}
	}

	cancelSignIn(): void {
		void invoke('youtube_cancel_sign_in');
	}

	async signOut(): Promise<void> {
		await invoke('youtube_sign_out');
		this.setAccount(null);
	}

	/** Load the next page of uploads (the first page on the first call). */
	async loadVideos(): Promise<void> {
		const account = this.account();

		if (!account || this.loadingVideos() || this.nextPage === null) return;

		this.loadingVideos.set(true);
		this.videosError.set(null);

		try {
			const page = await invoke<{
				videos: YtVideo[];
				nextPageToken: string | null;
				total: number;
			}>('youtube_videos', { uploads: account.uploads, pageToken: this.nextPage ?? null });
			this.videos.update((v) => [...v, ...page.videos]);
			this.totalVideos.set(page.total);
			this.nextPage = page.nextPageToken;
			this.hasMoreVideos.set(!!page.nextPageToken);
		} catch (e) {
			this.videosError.set(asError(e));
		} finally {
			this.loadingVideos.set(false);
		}
	}

	/** A video by ID, e.g. pasted into the search box. */
	async findVideo(id: string): Promise<YtVideo | null> {
		try {
			return await invoke<YtVideo | null>('youtube_video', { id });
		} catch (e) {
			throw asError(e);
		}
	}

	async captions(videoId: string): Promise<YtCaption[]> {
		return invoke<YtCaption[]>('youtube_captions', { videoId });
	}

	/** The loaded video closest to `ms` long, if one is within a second and a half. */
	matchByLength(ms: Ms): YtVideo | null {
		let best: YtVideo | null = null;

		for (const v of this.videos()) {
			const d = Math.abs(v.durationMs - ms);

			if (d <= SAME_LENGTH_MS && (!best || d < Math.abs(best.durationMs - ms))) best = v;
		}

		return best;
	}

	sameLength(v: YtVideo, ms: Ms): boolean {
		return Math.abs(v.durationMs - ms) <= SAME_LENGTH_MS;
	}

	reset(): void {
		if (this.running()) return;

		this.phase.set('setup');
		this.error.set(null);
		this.result.set(null);
	}

	async upload(opts: UploadOptions): Promise<void> {
		if (this.running()) return;

		const started = performance.now();
		const project = combineTracks(this.store.project(), new Set(opts.trackIds));
		const cues = project.tracks.reduce((n, t) => n + t.cues.length, 0);
		const names = project.tracks.map((t) => t.name);
		this.job.set(opts);
		this.error.set(null);
		this.result.set(null);
		this.steps.set([
			{
				id: 'combine',
				label: names.length > 1 ? `Combine ${joinNames(names)}` : `Use ${names[0]}`,
				status: 'done',
				detail: `${cues} cue${cues === 1 ? '' : 's'}`,
			},
			{ id: 'build', label: 'Build SRV3 captions', status: 'running', detail: '' },
			{ id: 'upload', label: 'Upload to YouTube', status: 'waiting', detail: 'Waiting' },
			{ id: 'check', label: 'Check them on YouTube', status: 'waiting', detail: 'Waiting' },
		]);
		this.phase.set('running');

		const { xml, stats } = exportSrv3(project);
		this.step('build', 'done', `${Math.max(1, Math.round(stats.bytes / 1024))} KB`);
		this.step('upload', 'running', '');
		const uploadStarted = performance.now();
		const events = new Channel<{ type: 'uploaded' | 'checked' }>();
		events.onmessage = (e) => {
			if (e.type === 'uploaded') {
				this.step('upload', 'done', formatSeconds(performance.now() - uploadStarted));
				this.step('check', 'running', '');
			}
		};

		try {
			const caption = await invoke<YtCaption>('youtube_upload', {
				videoId: opts.video.id,
				language: opts.language,
				name: opts.name,
				draft: opts.draft,
				content: xml,
				replace: opts.replace,
				onEvent: events,
			});
			this.step('check', 'done', caption.isDraft ? 'Draft' : 'Processed');
			const ids = new Set(opts.trackIds);
			this.result.set({
				options: opts,
				caption,
				cues,
				warnings: this.store.problems().filter((p) => ids.has(p.trackId)).length,
				took: formatSeconds(performance.now() - started),
			});
			this.phase.set('done');
		} catch (e) {
			const err = asError(e);
			const failed = this.steps().find((s) => s.status === 'running')?.id ?? 'upload';
			this.step(failed, 'error', err.kind === 'signed-out' ? 'Signed out' : 'Failed');
			this.error.set(err);
			this.phase.set('error');

			if (err.kind === 'signed-out') this.setAccount(null);
		}
	}

	private step(id: UploadStepId, status: UploadStep['status'], detail: string): void {
		this.steps.update((steps) =>
			steps.map((s) => (s.id === id ? { ...s, status, detail } : s)),
		);
	}
}

function joinNames(names: string[]): string {
	return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

function formatSeconds(ms: Ms): string {
	const s = Math.max(1, Math.round(ms / 1000));

	return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}
