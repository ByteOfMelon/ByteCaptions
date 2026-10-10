import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './file-io';
import { MediaSource } from './media-source';

/** Waveform resolution. Keep in sync with PEAKS_PER_SECOND in src-tauri/src/media.rs. */
export const PEAKS_PER_SECOND = 100;

/** Silence for snapping: quieter than this fraction of the loudest peak, for this long. */
const QUIET = 0.05;
const MIN_SILENCE_MS = 300;

export type AudioWaveform =
	| { status: 'none' }
	| { status: 'loading' }
	| { status: 'ready'; peaks: Uint8Array }
	| { status: 'error'; message: string };

/**
 * The loaded video's waveform for the timeline's audio lane. The desktop app decodes it with
 * the bundled ffmpeg (cached per file); the browser build has no decoder and shows none.
 */
@Injectable({ providedIn: 'root' })
export class AudioPeaks {
	private readonly media = inject(MediaSource);
	readonly waveform = signal<AudioWaveform>({ status: 'none' });

	/**
	 * Where silences start and end, in ms, for timeline snapping: stretches of at least
	 * MIN_SILENCE_MS quieter than QUIET of the loudest peak.
	 */
	readonly silenceEdges = computed(() => {
		const w = this.waveform();

		if (w.status !== 'ready') return [];

		const peaks = w.peaks;
		const quiet = Math.max(1, peaks.reduce((m, p) => Math.max(m, p), 0) * QUIET);
		const step = 1000 / PEAKS_PER_SECOND;
		const edges: number[] = [];
		let from = -1;

		for (let i = 0; i <= peaks.length; i++) {
			const silent = i < peaks.length && peaks[i] < quiet;

			if (silent && from < 0) from = i;
			else if (!silent && from >= 0) {
				if ((i - from) * step >= MIN_SILENCE_MS) edges.push(from * step, i * step);

				from = -1;
			}
		}

		return edges;
	});

	constructor() {
		effect(() => {
			const path = this.media.path();

			if (!isDesktop || !path) {
				this.waveform.set({ status: 'none' });

				return;
			}

			this.waveform.set({ status: 'loading' });
			invoke<ArrayBuffer>('media_peaks', { path }).then(
				(buf) => {
					// Ignore results for a video that has since been replaced.
					if (this.media.path() === path)
						this.waveform.set({ status: 'ready', peaks: new Uint8Array(buf) });
				},
				(e) => {
					if (this.media.path() === path)
						this.waveform.set({ status: 'error', message: String(e) });
				},
			);
		});
	}
}
