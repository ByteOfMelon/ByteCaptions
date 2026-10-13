import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Ms } from '../../core/model/types';
import { snapToFrame } from '../../core/time/timecode';
import { MediaSource } from '../../state/media-source';
import { ProjectStore } from '../../state/project-store';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** Fastest J / L shuttle speed */
const MAX_SHUTTLE = 8;
/** Reloads allowed in RECOVER_WINDOW_MS before a broken video is left alone. */
const MAX_RECOVERIES = 3;
const RECOVER_WINDOW_MS = 10_000;
/** Waits shorter than this don't show the buffering indicator, so quick seeks don't flicker */
const BUFFERING_DELAY_MS = 250;
/** Events after which the video may have started or stopped waiting for data */
const BUFFERING_EVENTS = ['waiting', 'seeking', 'seeked', 'playing', 'canplay', 'pause', 'emptied'];

@Injectable({ providedIn: 'root' })
export class Playback {
	private readonly store = inject(ProjectStore);
	private video: HTMLVideoElement | null = null;
	private raf = 0;
	private lastTick = 0;
	private recoveries: number[] = [];
	/** Where `playSpan` stops */
	private stopAt: Ms | null = null;
	/** Explain to the user why the video can't play, shown over the preview, if necessary */
	readonly videoError = signal<string | null>(null);
	/** The video is waiting for data (after a seek, or mid-playback), shown over the preview */
	readonly buffering = signal(false);
	private bufferingTimer: ReturnType<typeof setTimeout> | null = null;
	/** URL of the loaded video, if any. */
	readonly mediaUrl = inject(MediaSource).url;
	/**
	 * J / L shuttle multiplier on top of the playback rate: 1 for normal play, 2, 4, 8 after repeated L presses, negative for playing backwards with J. Pausing resets it
	 */
	readonly shuttle = signal(1);
	/** In / out points - either may be unset, view state, not saved with the project */
	readonly inPoint = signal<Ms | null>(null);
	readonly outPoint = signal<Ms | null>(null);
	/** The in/out range once either point is set - a missing point means the start/end. */
	readonly range = computed(() => {
		const a = this.inPoint();
		const b = this.outPoint();

		if (a === null && b === null) return null;

		return { start: a ?? 0, end: b ?? this.store.duration() };
	});
	/** Loop playback */
	readonly loop = signal(false);

	constructor() {
		effect(() => {
			if (this.video)
				this.video.playbackRate = this.store.rate() * Math.max(1, this.shuttle());
		});
		effect(() => {
			this.mediaUrl();
			untracked(() => this.pause());
		});
		const projectId = computed(() => this.store.project().id);
		effect(() => {
			projectId();
			untracked(() => this.clearRange());
		});
	}

	attach(video: HTMLVideoElement | null): void {
		this.video = video;
		this.videoError.set(null);
		this.setBuffering(false);

		if (video)
			untracked(() => {
				let loaded = false;
				video.onloadeddata = () => (loaded = true);
				video.playbackRate = this.store.rate();
				video.currentTime = this.store.playhead() / 1000;
				video.onended = () => this.onEnded();
				// A video that never loaded won't load on a retry either.
				video.onerror = () => (loaded ? this.recover(video) : this.fail(video));

				for (const e of BUFFERING_EVENTS)
					video.addEventListener(e, () => this.checkBuffering(video));
			});
	}

	toggle(): void {
		if (this.store.playing()) this.pause();
		else this.play();
	}

	/** Play at `speed` * the playback rate */
	play(speed = 1): void {
		const t = this.store.playhead();
		const span = this.loop() ? this.loopSpan() : null;

		// Looping starts inside the loop, otherwise playing from the very end starts over
		if (span && (t < span.start || t >= span.end)) this.seek(speed > 0 ? span.start : span.end);
		else if (speed > 0 && t >= this.store.duration()) this.seek(0);

		this.shuttle.set(speed);
		this.store.playing.set(true);
		this.lastTick = performance.now();

		// HTML video elements can't play backwards
		if (this.video) {
			if (speed > 0) this.startVideo(this.video);
			else this.video.pause();
		}

		cancelAnimationFrame(this.raf);
		this.raf = requestAnimationFrame(this.tick);
	}

	/** Play just this stretch, then pause (e.g. a sample of one speaker) */
	playSpan(start: Ms, end: Ms): void {
		this.pause();
		this.seek(start);
		this.play();
		this.stopAt = end;
	}

	/** J (-1)/L (1) - play that way, or go twice as fast if already going that way */
	shuttleBy(dir: 1 | -1): void {
		const s = this.store.playing() ? this.shuttle() : 0;
		this.play(Math.sign(s) === dir ? Math.min(Math.abs(s) * 2, MAX_SHUTTLE) * dir : dir);
	}

	pause(): void {
		this.stopAt = null;
		this.shuttle.set(1);
		this.store.playing.set(false);
		this.video?.pause();
		cancelAnimationFrame(this.raf);
	}

	seek(ms: number): void {
		this.store.seek(ms);

		if (this.video) this.video.currentTime = this.store.playhead() / 1000;
	}

	/** Step by whole frames */
	stepFrames(n: number): void {
		this.pause();
		const fps = this.store.project().fps;
		this.seek(snapToFrame(this.store.playhead() + (n * 1000) / fps + 1, fps));
	}

	/** Step by whole seconds */
	stepSeconds(n: number): void {
		this.pause();
		const fps = this.store.project().fps;
		this.seek(snapToFrame(this.store.playhead() + n * 1000, fps));
	}

	/** Mark in. An out point before it is dropped */
	setIn(ms: Ms = this.store.playhead()): void {
		const out = this.outPoint();

		if (out !== null && out <= ms) this.outPoint.set(null);

		this.inPoint.set(ms);
	}

	/** Mark out. An in point after it is dropped */
	setOut(ms: Ms = this.store.playhead()): void {
		const at = this.inPoint();

		if (at !== null && at >= ms) this.inPoint.set(null);

		this.outPoint.set(ms);
	}

	clearRange(): void {
		this.inPoint.set(null);
		this.outPoint.set(null);
	}

	goTo(edge: 'in' | 'out'): void {
		const r = this.range();

		if (r) this.seek(edge === 'in' ? r.start : r.end);
	}

	/** What looping plays - the in/out range, else the selected cues, else the whole video */
	loopSpan(): { start: Ms; end: Ms } {
		const r = this.range();

		if (r) return r;

		const cues = this.store.selectedCues().map((c) => c.cue);

		if (cues.length)
			return {
				start: Math.min(...cues.map((c) => c.start)),
				end: Math.max(...cues.map((c) => c.end)),
			};

		return { start: 0, end: this.store.duration() };
	}

	/** Jump to the previous/next cue start across all tracks */
	jumpCue(dir: 1 | -1): void {
		const t = this.store.playhead();
		const starts = this.store.allCues().map((r) => r.cue.start);
		const target =
			dir > 0 ? starts.find((s) => s > t + 1) : [...starts].reverse().find((s) => s < t - 1);

		if (target !== undefined) this.seek(target);
	}

	/** The video reached its end - start the loop over, or stop */
	private onEnded(): void {
		if (!this.loop() || !this.store.playing() || this.shuttle() < 0) return this.pause();

		this.seek(this.loopSpan().start);

		if (this.video) this.startVideo(this.video);
	}

	private startVideo(video: HTMLVideoElement): void {
		video.play().catch((e: DOMException) => {
			if (e.name === 'AbortError' || video !== this.video || video.error) return;

			console.warn('[Playback] Video playback failure: ', e);
			this.pause();
			this.videoError.set(`The video won't play. ${e.message}`);
		});
	}

	/**
	 * The desktop app's video stream can fail mid-seek, this attempts to recover it, has been successful so far but lmk if it doesn't work
	 */
	private recover(video: HTMLVideoElement): void {
		if (video !== this.video) return;

		const now = performance.now();
		this.recoveries = this.recoveries.filter((t) => now - t < RECOVER_WINDOW_MS);
		console.warn('Video error; reloading it', video.error?.code, video.error?.message);

		if (this.recoveries.length >= MAX_RECOVERIES) return this.fail(video);

		this.recoveries.push(now);
		video.addEventListener(
			'loadedmetadata',
			() => {
				if (video !== this.video) return;

				video.currentTime = this.store.playhead() / 1000;

				if (this.store.playing() && this.shuttle() > 0) this.startVideo(video);
			},
			{ once: true },
		);
		video.load();
	}

	/** Waiting = seeking, or playing without enough data to keep going */
	private checkBuffering(video: HTMLVideoElement): void {
		if (video !== this.video) return;

		const waiting =
			!video.error &&
			(video.seeking ||
				(this.store.playing() &&
					this.shuttle() > 0 &&
					video.readyState < video.HAVE_FUTURE_DATA));

		if (!waiting) return this.setBuffering(false);

		this.bufferingTimer ??= setTimeout(() => {
			this.bufferingTimer = null;
			this.buffering.set(true);
		}, BUFFERING_DELAY_MS);
	}

	private setBuffering(on: boolean): void {
		if (this.bufferingTimer) clearTimeout(this.bufferingTimer);

		this.bufferingTimer = null;
		this.buffering.set(on);
	}

	private fail(video: HTMLVideoElement): void {
		if (video !== this.video) return;

		this.setBuffering(false);
		this.pause();
		this.videoError.set(mediaErrorText(video.error));
	}

	private readonly tick = (now: number) => {
		if (!this.store.playing()) return;

		const speed = this.shuttle();

		if (this.video && speed > 0) {
			if (!this.video.paused) this.store.seek(this.video.currentTime * 1000);
		} else {
			this.store.seek(
				this.store.playhead() + (now - this.lastTick) * this.store.rate() * speed,
			);

			if (this.video && !this.video.seeking)
				this.video.currentTime = this.store.playhead() / 1000;
		}

		const t = this.store.playhead();

		if (this.stopAt !== null && t >= this.stopAt) return this.pause();

		const span = this.loop() ? this.loopSpan() : null;

		if (span && (speed > 0 ? t >= span.end : t <= span.start))
			this.seek(speed > 0 ? span.start : span.end);
		else if (!(this.video && speed > 0) && (speed < 0 ? t <= 0 : t >= this.store.duration()))
			return this.pause();

		this.lastTick = now;
		this.raf = requestAnimationFrame(this.tick);
	};
}

/** Am explanation of why a <video> element failed */
export function mediaErrorText(error: MediaError | null): string {
	switch (error?.code) {
		case MediaError.MEDIA_ERR_NETWORK:
			return 'The video stopped loading. Check that the file is still there.';
		case MediaError.MEDIA_ERR_DECODE:
			return "The video couldn't be decoded. The file may be damaged.";
		case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
			return "This video's format can't be played here. Converting it to MP4 (H.264) usually helps.";
		default:
			return `The video couldn't be played.${error?.message ? ' ' + error.message : ''}`;
	}
}
