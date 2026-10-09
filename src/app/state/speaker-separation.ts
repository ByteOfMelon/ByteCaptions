import { Injectable, inject, signal } from '@angular/core';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Draft } from 'immer';
import { CueId, Ms, Project, Track, TrackId } from '../core/model/types';
import {
	SpeakerSplit,
	SpeakerTurn,
	assignSpeakers,
	splitBySpeaker,
} from '../core/speakers/speakers';
import { isDesktop } from './file-io';
import { stopped, wasCancelled } from './jobs';
import { MediaSource } from './media-source';
import { trackColors } from './project-files';
import { ProjectStore } from './project-store';

/** Size of the speaker models (src-tauri/src/speakers.rs), for messages before they download. */
export const SPEAKER_MODELS_SIZE = '60 MB';

/** "Speakers" choices: Auto, then exact counts. */
export const SPEAKER_COUNTS = [null, 2, 3, 4, 5, 6] as const;

export type SpeakerEvent =
	| { type: 'download'; received: number; total: number }
	| { type: 'extracted' }
	| { type: 'separating' };

/** One speaker's track in a finished separation. Names and colours are read live from it. */
export interface SpeakerRow {
	trackId: TrackId;
	cues: number;
	talkMs: Ms;
	/** The line that's most clearly this speaker, for Listen. */
	sample: CueId;
}

export interface SpeakerResult {
	rows: SpeakerRow[];
	/** Lines flagged as an unsure speaker (in the Problems tab). */
	unsure: number;
}

/**
 * Speaker separation (desktop only): runs the backend's speaker model over the video and
 * splits a track's cues into one track per speaker.
 */
@Injectable({ providedIn: 'root' })
export class SpeakerSeparation {
	private readonly store = inject(ProjectStore);
	private readonly media = inject(MediaSource);
	/** The speaker models are downloaded (null until checked). */
	readonly installed = signal<boolean | null>(null);

	constructor() {
		void this.refresh();
	}

	async refresh(): Promise<void> {
		if (!isDesktop) return;
		try {
			this.installed.set(await invoke<boolean>('speakers_installed'));
		} catch (e) {
			console.warn('Could not check the speaker models', e);
		}
	}

	/** Who speaks when in the project's video, downloading the models first if needed. */
	async turns(
		speakers: number | null,
		signal: AbortSignal,
		emit: (e: SpeakerEvent) => void,
	): Promise<SpeakerTurn[]> {
		const path = this.media.path();
		if (!path)
			throw new Error(
				"There's no video to listen to|Link the project's video first (drop it on the editor), then try again.",
			);
		const cancel = () => void invoke('job_cancel');
		signal.addEventListener('abort', cancel);
		try {
			if (!(await invoke<boolean>('speakers_installed'))) {
				const progress = new Channel<{ received: number; total: number }>();
				progress.onmessage = (p) => emit({ type: 'download', ...p });
				try {
					await invoke('speakers_download', { onProgress: progress });
				} catch (e) {
					if (wasCancelled(e, signal)) throw stopped();
					throw new Error(`Speaker model download failed|${e}`);
				}
				this.installed.set(true);
			}
			if (signal.aborted) throw stopped();
			const events = new Channel<{ kind: 'extracted' }>();
			events.onmessage = () => emit({ type: 'extracted' });
			emit({ type: 'separating' });
			try {
				return await invoke<SpeakerTurn[]>('diarize', {
					path,
					speakers,
					onEvent: events,
				});
			} catch (e) {
				if (wasCancelled(e, signal)) throw stopped();
				throw new Error(`Speaker separation failed|${e}`);
			}
		} finally {
			signal.removeEventListener('abort', cancel);
		}
	}

	/**
	 * Split `track` by speaker, with track colours following on from the project's.
	 * `detected`: the speaker count was Auto, so tiny stray speakers are folded in.
	 */
	split(
		track: Track,
		turns: SpeakerTurn[],
		detected: boolean,
		project: Project = this.store.project(),
	): SpeakerSplit {
		const others = project.tracks.filter((t) => t.id !== track.id).length;
		const palette = trackColors();
		const colors = palette.map((_, i) => palette[(others + i) % palette.length]);
		return splitBySpeaker(
			track,
			assignSpeakers(track.cues, turns, { foldMinor: detected }),
			colors,
		);
	}

	/** Recipe: put the split's tracks where `trackId` is (or at the end), replacing it. */
	static replace(trackId: TrackId | null, split: SpeakerSplit) {
		return (p: Draft<Project>) => {
			const at = p.tracks.findIndex((t) => t.id === trackId);
			if (at >= 0) p.tracks.splice(at, 1, ...split.tracks);
			else p.tracks.push(...split.tracks);
		};
	}

	static result(split: SpeakerSplit): SpeakerResult {
		return {
			rows: split.tracks.map((t, i) => ({
				trackId: t.id,
				cues: t.cues.length,
				talkMs: t.cues.reduce((n, c) => n + c.end - c.start, 0),
				sample: split.samples[i],
			})),
			unsure: split.unsure,
		};
	}
}
