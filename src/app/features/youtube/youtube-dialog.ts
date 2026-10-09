import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { LucideCheck, LucideCircle, LucideLoaderCircle, LucideX } from '@lucide/angular';
import { TrackId } from '../../core/model/types';
import { EditorUi } from '../../state/editor-ui';
import { openExternal } from '../../state/file-io';
import { ProjectStore } from '../../state/project-store';
import {
	CAPTION_LANGUAGES,
	YouTube,
	YtCaption,
	YtError,
	YtVideo,
	languageName,
} from '../../state/youtube';
import { Autofocus } from '../../ui/autofocus/autofocus';
import { Button } from '../../ui/button/button';
import { Toggle } from '../../ui/controls/controls';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Field } from '../../ui/field/field';
import { Notice } from '../../ui/notice/notice';
import { Select } from '../../ui/select/select';
import { TrackChecklist } from '../export/track-checklist';
import { TrackProblems } from '../export/track-problems';

/** The video last uploaded to, per project, so the dialog picks it again. */
const LAST_VIDEO_KEY = 'bc.youtube.lastVideo';

function lastVideos(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(LAST_VIDEO_KEY) ?? '{}');
	} catch {
		return {};
	}
}

/** A YouTube video ID, from the ID itself or a watch / youtu.be / Studio link. */
export function videoIdFrom(text: string): string | null {
	const s = text.trim();
	if (/^[\w-]{11}$/.test(s)) return s;
	const m = s.match(/(?:v=|youtu\.be\/|\/video\/|\/shorts\/|\/live\/)([\w-]{11})/);
	return m ? m[1] : null;
}

/** Messages for the ways an upload can fail. */
const ERRORS: Record<YtError['kind'], { title: string; detail?: string }> = {
	'signed-out': {
		title: 'Your YouTube sign-in has expired',
		detail: 'Sign in again to finish.',
	},
	quota: {
		title: "YouTube's daily upload limit is used up",
		detail: 'Try again tomorrow. The limit resets at midnight Pacific time.',
	},
	forbidden: {
		title: "You can't add captions to this video",
		detail: "It may belong to a channel you're not signed in to.",
	},
	'not-found': {
		title: 'This video is no longer on YouTube',
		detail: 'Choose another video and try again.',
	},
	offline: { title: "Couldn't reach YouTube", detail: 'Check your connection and try again.' },
	'no-channel': { title: "This Google account doesn't have a YouTube channel" },
	'not-configured': { title: "This build of ByteCaptions can't upload to YouTube" },
	timeout: { title: 'Sign-in took too long', detail: 'Try again.' },
	cancelled: { title: 'Sign-in was cancelled' },
	failed: { title: 'Upload failed' },
};

/** Upload to YouTube (PLAN §5.12): sign in, pick the video, upload the tracks as SRV3. */
@Component({
	selector: 'bc-youtube-dialog',
	imports: [
		NgTemplateOutlet,
		Autofocus,
		Button,
		Dialog,
		Field,
		Notice,
		Select,
		Toggle,
		TrackChecklist,
		TrackProblems,
		LucideCheck,
		LucideCircle,
		LucideLoaderCircle,
		LucideX,
	],
	templateUrl: './youtube-dialog.html',
	styleUrl: './youtube-dialog.css',
})
export class YouTubeDialog {
	protected readonly yt = inject(YouTube);
	private readonly store = inject(ProjectStore);
	private readonly ui = inject(EditorUi);
	protected readonly ref = inject(DialogRef);

	protected readonly project = this.store.project;
	/** The video's length, which the matching upload should share. */
	private readonly lengthMs = computed(
		() => this.project().media?.durationMs ?? this.store.duration(),
	);
	protected readonly subtitle = computed(
		() => `${this.project().name} • ${clock(this.lengthMs())}`,
	);

	protected readonly view = signal<'main' | 'choose'>('main');
	protected readonly video = signal<YtVideo | null>(null);
	/** The chosen video's caption tracks; null while loading. */
	protected readonly captions = signal<YtCaption[] | null>(null);
	/** Set when the video's existing captions couldn't be listed. */
	protected readonly captionsFailed = signal(false);
	protected readonly included = signal<ReadonlySet<TrackId>>(
		new Set(
			this.project()
				.tracks.filter((t) => !t.muted)
				.map((t) => t.id),
		),
	);
	protected readonly language = signal('en');
	protected readonly name = signal('');
	protected readonly draft = signal(false);
	/**
	 * Hidden for now: YouTube Studio doesn't show drafts uploaded through the API, so the only
	 * way to publish one is to upload again with this off.
	 */
	protected readonly showDraftToggle = false;

	protected readonly languageOptions = CAPTION_LANGUAGES.map((l) => ({
		value: l.code,
		label: l.name,
	}));

	/** The track this upload replaces: same language, preferring the same name. */
	protected readonly replace = computed(() => {
		const same = (this.captions() ?? []).filter((c) => c.language === this.language());
		return same.find((c) => c.name === this.name().trim()) ?? same[0] ?? null;
	});
	protected readonly languageNote = computed(() => {
		const lang = languageName(this.language());
		const blank = `Leave the name blank to show just "${lang}".`;
		if (this.captionsFailed())
			return `Couldn't check the captions this video already has, so this may add a second ${lang} track. ${blank}`;
		if (this.captions() === null) return blank;
		const r = this.replace();
		if (!r) return blank;
		return `Replaces the ${r.name ? `"${r.name}"` : lang} captions this video already has. ${blank}`;
	});

	protected readonly canUpload = computed(
		() => !!this.video() && this.included().size > 0 && !this.yt.running(),
	);

	// Choose a video
	protected readonly query = signal('');
	/** The video picked in the list, before "Use this video". */
	protected readonly picked = signal<YtVideo | null>(null);
	/** A video found by a pasted ID or link that isn't in the loaded list. */
	protected readonly found = signal<YtVideo | null | 'searching' | 'none'>(null);
	/** Why looking up a pasted ID failed. */
	protected readonly findError = signal<YtError | null>(null);
	protected readonly filtered = computed(() => {
		const q = this.query().trim().toLowerCase();
		const list = this.yt.videos();
		const id = videoIdFrom(this.query());
		if (id) return list.filter((v) => v.id === id);
		return q ? list.filter((v) => v.title.toLowerCase().includes(q)) : list;
	});
	protected readonly foundOther = computed(() => {
		const f = this.found();
		return typeof f === 'object' && f && f.channelId !== this.yt.account()?.id ? f : null;
	});
	/** The list shown: a found video of this channel first, then the loaded matches. */
	protected readonly listed = computed(() => {
		const f = this.found();
		const own = typeof f === 'object' && f && !this.foundOther() ? [f] : [];
		return [...own, ...this.filtered()];
	});
	protected readonly listLabel = computed(() => {
		const total = this.yt.totalVideos();
		if (this.query().trim()) return 'Matches';
		return `${total} video${total === 1 ? '' : 's'} • Newest first`;
	});
	protected readonly chooseSubtitle = computed(
		() => `${this.yt.account()?.title ?? ''} • The project is ${clock(this.lengthMs())} long`,
	);

	// Uploading
	protected readonly jobSubtitle = computed(() => {
		const j = this.yt.job();
		if (!j) return '';
		return `${j.video.title} • ${languageName(j.language)} • ${j.draft ? 'Draft' : 'Goes live'}`;
	});
	protected readonly progress = computed(() => {
		const steps = this.yt.steps();
		const done = steps.filter((s) => s.status === 'done').length;
		return Math.round(((done + 0.5) / Math.max(1, steps.length)) * 100);
	});

	constructor() {
		// Signed in: load the uploads, then pick the video last used or the one that matches.
		effect(() => {
			if (!this.yt.account()) return;
			untracked(() => {
				if (!this.yt.videos().length) void this.yt.loadVideos();
			});
		});
		effect(() => {
			const videos = this.yt.videos();
			if (untracked(this.video) || !videos.length) return;
			untracked(() => void this.pickInitial());
		});
		effect(() => {
			const v = this.video();
			this.captions.set(null);
			this.captionsFailed.set(false);
			if (!v) return;
			this.yt
				.captions(v.id)
				.then((c) => {
					if (this.video()?.id === v.id) this.captions.set(c);
				})
				.catch(() => {
					if (this.video()?.id === v.id) this.captionsFailed.set(true);
				});
		});
		// A pasted ID or link that isn't loaded is looked up on YouTube.
		effect(() => {
			const id = videoIdFrom(this.query());
			this.findError.set(null);
			if (!id || this.yt.videos().some((v) => v.id === id)) return this.found.set(null);
			this.found.set('searching');
			this.yt.findVideo(id).then(
				(v) => {
					if (videoIdFrom(this.query()) === id) this.found.set(v ?? 'none');
				},
				(e: YtError) => {
					if (videoIdFrom(this.query()) !== id) return;
					this.found.set(null);
					this.findError.set(e);
				},
			);
		});
	}

	private async pickInitial(): Promise<void> {
		const last = lastVideos()[this.project().id];
		const remembered = last
			? (this.yt.videos().find((v) => v.id === last) ?? (await this.yt.findVideo(last)))
			: null;
		if (this.video()) return;
		this.video.set(remembered ?? this.yt.matchByLength(this.lengthMs()));
	}

	protected sameLength(v: YtVideo): boolean {
		return this.yt.sameLength(v, this.lengthMs());
	}

	protected choose(): void {
		this.picked.set(this.video());
		this.query.set('');
		this.view.set('choose');
	}

	protected usePicked(): void {
		const v = this.picked();
		if (v) this.video.set(v);
		this.view.set('main');
	}

	protected review(): void {
		this.ui.sideTab.set('problems');
		this.ref.close();
	}

	protected upload(): void {
		const video = this.video();
		if (!video || !this.canUpload()) return;
		try {
			localStorage.setItem(
				LAST_VIDEO_KEY,
				JSON.stringify({ ...lastVideos(), [this.project().id]: video.id }),
			);
		} catch {
			/* Remembering the video is a convenience. */
		}
		void this.yt.upload({
			video,
			trackIds: this.project()
				.tracks.filter((t) => this.included().has(t.id))
				.map((t) => t.id),
			language: this.language(),
			name: this.name().trim(),
			draft: this.draft(),
			replace: this.replace(),
		});
	}

	/** Sign in again after the sign-in expired mid-upload, then retry. */
	protected async signInAndRetry(): Promise<void> {
		const job = this.yt.job();
		if (!(await this.yt.signIn()) || !job) return;
		this.yt.reset();
		void this.yt.upload(job);
	}

	protected retry(): void {
		const job = this.yt.job();
		this.yt.reset();
		if (job) void this.yt.upload(job);
	}

	protected chooseAnother(): void {
		this.yt.reset();
		this.video.set(null);
		this.choose();
	}

	protected openStudio(): void {
		const v = this.yt.result()?.options.video;
		if (v) openExternal(`https://studio.youtube.com/video/${v.id}/translations`);
	}

	protected errorText(e: YtError): { title: string; detail: string } {
		const m = ERRORS[e.kind] ?? ERRORS.failed;
		return { title: m.title, detail: m.detail ?? e.message };
	}

	/** Leaving Done (or an error) returns to setup for next time. */
	protected finish(): void {
		this.yt.reset();
		this.ref.close();
	}

	protected meta(v: YtVideo): string {
		const privacy = v.privacy ? v.privacy[0].toUpperCase() + v.privacy.slice(1) : '';
		return [clock(v.durationMs), privacy, uploaded(v.publishedAt)].filter(Boolean).join(' • ');
	}

	protected readonly languageName = languageName;
}

function clock(ms: number): string {
	const s = Math.round(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "Uploaded Sep 30", with the year when it isn't this year. */
function uploaded(iso: string): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	const sameYear = d.getFullYear() === new Date().getFullYear();
	const date = d.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' }),
	});
	return `Uploaded ${date}`;
}
