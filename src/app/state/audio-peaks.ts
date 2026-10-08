import { Injectable, effect, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './file-io';
import { MediaSource } from './media-source';

/** Waveform resolution. Keep in sync with PEAKS_PER_SECOND in src-tauri/src/media.rs. */
export const PEAKS_PER_SECOND = 100;

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
