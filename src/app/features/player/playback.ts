import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { snapToFrame } from '../../core/time/timecode';
import { MediaSource } from '../../state/media-source';
import { ProjectStore } from '../../state/project-store';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** Fastest J / L shuttle speed. */
const MAX_SHUTTLE = 8;

/**
 * Transport. Drives the store's playhead from the attached <video> when media is loaded,
 * otherwise from a requestAnimationFrame clock so captions can be previewed without media.
 */
@Injectable({ providedIn: 'root' })
export class Playback {
	private readonly store = inject(ProjectStore);
	private video: HTMLVideoElement | null = null;
	private raf = 0;
	private lastTick = 0;
	/** URL of the loaded video, if any. */
	readonly mediaUrl = inject(MediaSource).url;
	/**
	 * J / L shuttle multiplier on top of the playback rate: 1 for normal play, 2, 4, 8 after
	 * repeated L presses, negative for playing backwards with J. Pausing resets it.
	 */
	readonly shuttle = signal(1);

	constructor() {
		effect(() => {
			if (this.video)
				this.video.playbackRate = this.store.rate() * Math.max(1, this.shuttle());
		});
		// A new video starts paused.
		effect(() => {
			this.mediaUrl();
			untracked(() => this.pause());
		});
	}

	/**
	 * Untracked: called from an effect, and reading the playhead there would re-attach
	 * (and seek) the video on every tick, stalling playback.
	 */
	attach(video: HTMLVideoElement | null): void {
		this.video = video;
		if (video)
			untracked(() => {
				video.playbackRate = this.store.rate();
				video.currentTime = this.store.playhead() / 1000;
				video.onended = () => this.pause();
			});
	}

	toggle(): void {
		if (this.store.playing()) this.pause();
		else this.play();
	}

	/** Play at `speed` × the playback rate; negative plays backwards. */
	play(speed = 1): void {
		if (speed > 0 && this.store.playhead() >= this.store.duration()) this.store.seek(0);
		this.shuttle.set(speed);
		this.store.playing.set(true);
		this.lastTick = performance.now();
		// Video elements can't play backwards; the clock in tick() scrubs the video instead.
		if (this.video) {
			if (speed > 0) void this.video.play();
			else this.video.pause();
		}
		cancelAnimationFrame(this.raf);
		this.raf = requestAnimationFrame(this.tick);
	}

	/** J (-1) / L (1): play that way, or go twice as fast if already going that way. */
	shuttleBy(dir: 1 | -1): void {
		const s = this.store.playing() ? this.shuttle() : 0;
		this.play(Math.sign(s) === dir ? Math.min(Math.abs(s) * 2, MAX_SHUTTLE) * dir : dir);
	}

	pause(): void {
		this.shuttle.set(1);
		this.store.playing.set(false);
		this.video?.pause();
		cancelAnimationFrame(this.raf);
	}

	seek(ms: number): void {
		this.store.seek(ms);
		if (this.video) this.video.currentTime = this.store.playhead() / 1000;
	}

	/** Step by whole frames (← / →). */
	stepFrames(n: number): void {
		this.pause();
		const fps = this.store.project().fps;
		this.seek(snapToFrame(this.store.playhead() + (n * 1000) / fps + 1, fps));
	}

	/** Step by whole seconds (Shift+← / →), landing on a frame. */
	stepSeconds(n: number): void {
		this.pause();
		const fps = this.store.project().fps;
		this.seek(snapToFrame(this.store.playhead() + n * 1000, fps));
	}

	/** Jump to the previous / next cue start across all tracks. */
	jumpCue(dir: 1 | -1): void {
		const t = this.store.playhead();
		const starts = this.store.allCues().map((r) => r.cue.start);
		const target =
			dir > 0 ? starts.find((s) => s > t + 1) : [...starts].reverse().find((s) => s < t - 1);
		if (target !== undefined) this.seek(target);
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
			// Backwards: scrub the video along, skipping frames while a seek is still loading.
			if (this.video && !this.video.seeking)
				this.video.currentTime = this.store.playhead() / 1000;
			const t = this.store.playhead();
			if (speed < 0 ? t <= 0 : t >= this.store.duration()) return this.pause();
		}
		this.lastTick = now;
		this.raf = requestAnimationFrame(this.tick);
	};
}
