import { Channel, invoke } from '@tauri-apps/api/core';
import { segmentWords } from '../core/segment/segment';
import { Cue, Ms, ProjectSettings, WordTiming } from '../core/model/types';
import {
	EngineEvent,
	LANGUAGE_CODES,
	MODELS,
	ModelId,
	TranscribeOptions,
	TranscriptionEngine,
	bytes,
} from './transcription';

type AsrEvent =
	| { type: 'extracted'; durationMs: Ms }
	| { type: 'progress'; percent: number }
	| { type: 'segment'; startMs: Ms; endMs: Ms; text: string };

/** Voice activity detection model; keep in sync with VAD_MODEL in src-tauri/src/models.rs. */
const VAD_MODEL = 'silero-v6.2.0';

/** Error text the backend uses for a job stopped with `job_cancel` (src-tauri/src/jobs.rs). */
const CANCELLED = 'Cancelled';

const stopped = () => new DOMException('Stopped', 'AbortError');

function clock(ms: Ms): string {
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Transcription on the desktop app: whisper.cpp in the Rust backend (src-tauri/src/asr.rs),
 * with models downloaded on first use (models.rs). The backend returns timed words; they're
 * grouped into cues here with the project's caption limits.
 */
export class WhisperEngine implements TranscriptionEngine {
	/** Downloaded models by whisper name, with their size in bytes. */
	private installed = new Map<string, number>();

	constructor(
		private readonly mediaPath: () => string | null,
		private readonly settings: () => ProjectSettings,
		/** Called when the set of downloaded models changes. */
		private readonly changed: () => void,
	) {
		// A job still running from before the window reloaded has nobody to report to.
		void invoke('job_cancel');
		void this.refresh();
	}

	async refresh(): Promise<void> {
		try {
			const models = await invoke<{ name: string; bytes: number }[]>('models_installed');
			this.installed = new Map(models.map((m) => [m.name, m.bytes]));
			this.changed();
		} catch (e) {
			console.warn('Could not list models', e);
		}
	}

	async device(): Promise<string | null> {
		try {
			return await invoke<string | null>('gpu_device');
		} catch (e) {
			console.warn('Could not check for a GPU', e);
			return null;
		}
	}

	downloaded(): ReadonlyMap<string, number> {
		// The speech detector is tiny and goes with every model.
		return new Map([...this.installed].filter(([name]) => name !== VAD_MODEL));
	}

	async delete(name: string): Promise<void> {
		try {
			await invoke('model_delete', { name });
		} finally {
			await this.refresh();
		}
	}

	isDownloaded(model: ModelId): boolean {
		return this.installed.has(MODELS.find((m) => m.id === model)!.whisper);
	}

	async run(
		opts: TranscribeOptions,
		durationMs: Ms,
		signal: AbortSignal,
		emit: (e: EngineEvent) => void,
	): Promise<Cue[]> {
		const path = this.mediaPath();
		if (!path)
			throw new Error(
				"There's no video to transcribe|Link the project's video first (drop it on the editor), then try again.",
			);
		const model = MODELS.find((m) => m.id === opts.model)!;
		const cancel = () => void invoke('job_cancel');
		signal.addEventListener('abort', cancel);
		try {
			// The speech detector comes along with whichever Whisper model is downloaded first.
			for (const name of [model.whisper, VAD_MODEL].filter((n) => !this.installed.has(n))) {
				emit({ type: 'step', step: 'download', status: 'running', detail: '' });
				let last = '';
				const progress = new Channel<{ received: number; total: number }>();
				progress.onmessage = (p) => {
					last = `${bytes(p.received)} of ${p.total ? bytes(p.total) : model.size}`;
					emit({ type: 'step', step: 'download', status: 'running', detail: last });
					emit({ type: 'download', received: p.received, total: p.total });
				};
				try {
					await invoke('model_download', { name, onProgress: progress });
				} catch (e) {
					if (e === CANCELLED || signal.aborted) throw stopped();
					emit({ type: 'step', step: 'download', status: 'error', detail: last });
					throw new Error(`Model download failed|${e}`);
				}
				await this.refresh();
			}
			emit({ type: 'step', step: 'download', status: 'done', detail: model.size });

			emit({ type: 'step', step: 'extract', status: 'running', detail: '' });
			let duration = durationMs;
			const events = new Channel<AsrEvent>();
			events.onmessage = (e) => {
				switch (e.type) {
					case 'extracted':
						duration = e.durationMs || durationMs;
						emit({
							type: 'step',
							step: 'extract',
							status: 'done',
							detail: clock(e.durationMs),
						});
						emit({ type: 'step', step: 'transcribe', status: 'running', detail: '0%' });
						return;
					case 'progress':
						emit({ type: 'progress', mediaMs: (e.percent / 100) * duration });
						emit({
							type: 'step',
							step: 'transcribe',
							status: 'running',
							detail: `${e.percent}%`,
						});
						return;
					case 'segment':
						if (e.text)
							emit({
								type: 'progress',
								mediaMs: e.endMs,
								line: { at: e.startMs, text: e.text },
							});
				}
			};
			let words: WordTiming[];
			try {
				({ words } = await invoke<{ words: WordTiming[]; language: string }>('transcribe', {
					path,
					model: model.whisper,
					language: LANGUAGE_CODES[opts.language] ?? null,
					onEvent: events,
				}));
			} catch (e) {
				if (e === CANCELLED || signal.aborted) throw stopped();
				throw new Error(`Transcription failed|${e}`);
			}
			if (signal.aborted) throw stopped();
			emit({ type: 'progress', mediaMs: duration });
			emit({ type: 'step', step: 'transcribe', status: 'done', detail: '' });

			// Whisper times each word as it transcribes; this step just groups them into cues.
			emit({ type: 'step', step: 'align', status: 'running', detail: '' });
			const cues = segmentWords(words, this.settings());
			if (!opts.wordTimings) for (const c of cues) delete c.words;
			emit({
				type: 'step',
				step: 'align',
				status: 'done',
				detail: opts.wordTimings ? '' : 'Skipped',
			});
			return cues;
		} finally {
			signal.removeEventListener('abort', cancel);
		}
	}
}
