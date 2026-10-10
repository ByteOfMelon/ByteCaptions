import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { setWords } from '../core/commands/edits';
import { cueText } from '../core/model/cue';
import { CueId, Ms } from '../core/model/types';
import { splitWords, tappedWords } from '../core/model/words';
import { Playback } from '../features/player/playback';
import { ProjectStore } from './project-store';

/** Tapping plays at this speed, so there's time to react to each word. */
const TAP_RATE = 0.5;
/** Playback starts this long before the cue, to catch its first word. */
const LEAD_IN_MS = 600;

/**
 * Tap to time: the cue plays slowly and each Space press marks where the next word starts.
 * Esc (or the cue ending) stops it, keeping what was tapped; untapped words share the rest.
 * The result is one undo step.
 */
@Injectable({ providedIn: 'root' })
export class WordTapping {
	private readonly store = inject(ProjectStore);
	private readonly playback = inject(Playback);
	private readonly state = signal<{
		cueId: CueId;
		words: string[];
		taps: Ms[];
		rate: number;
	} | null>(null);

	/** What the timeline shows while tapping: which cue, how far, and the hint text. */
	readonly active = computed(() => {
		const s = this.state();

		if (!s) return null;

		const n = s.taps.length;

		return {
			cueId: s.cueId,
			tappedUntil: n ? this.store.playhead() : null,
			label: `Tap to time  •  Space marks the next word  •  ${Math.min(n + 1, s.words.length)} of ${s.words.length}  •  Esc to stop`,
		};
	});

	constructor() {
		// Playback stopping (the cue ended, or it was paused) finishes tapping.
		effect(() => {
			if (!this.store.playing() && untracked(this.state)) untracked(() => this.finish());
		});
		window.addEventListener('keydown', (e) => this.onKey(e), true);
	}

	start(cueId: CueId): void {
		const ref = this.store.find(cueId);

		if (!ref || ref.track.locked) return;

		const words = splitWords(cueText(ref.cue));

		if (!words.length) return;

		this.state.set({ cueId, words, taps: [], rate: this.store.rate() });
		this.store.select(cueId);
		this.store.rate.set(TAP_RATE);
		this.playback.playSpan(Math.max(0, ref.cue.start - LEAD_IN_MS), ref.cue.end);
	}

	private onKey(e: KeyboardEvent): void {
		const s = this.state();

		if (!s) return;

		if (e.key === ' ' || e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
		}

		if (e.key === 'Escape') this.playback.pause();
		else if (e.key === ' ' && !e.repeat && s.taps.length < s.words.length) {
			const ref = this.store.find(s.cueId);

			if (!ref) return;

			const t = Math.max(ref.cue.start, Math.min(ref.cue.end - 1, this.store.playhead()));

			// Taps only go forwards.
			if (t > (s.taps.at(-1) ?? -1)) this.state.set({ ...s, taps: [...s.taps, t] });
		}
	}

	private finish(): void {
		const s = this.state();
		this.state.set(null);

		if (!s) return;

		this.store.rate.set(s.rate);
		const ref = this.store.find(s.cueId);

		if (!ref || !s.taps.length) return;

		this.store.apply(
			'Tap to time',
			setWords(s.cueId, tappedWords(s.words, s.taps, ref.cue.start, ref.cue.end)),
		);
	}
}
