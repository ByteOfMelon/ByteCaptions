import { Injectable, computed, inject, signal } from '@angular/core';
import { addTrack } from '../core/commands/edits';
import { createTrack } from '../core/model/defaults';
import { Cue, Ms, TrackId } from '../core/model/types';
import { SpeakerTurn } from '../core/speakers/speakers';
import { isDesktop } from './file-io';
import { MediaSource } from './media-source';
import { ProjectFiles } from './project-files';
import { ProjectStore } from './project-store';
import { SPEAKER_MODELS_SIZE, SpeakerResult, SpeakerSeparation } from './speaker-separation';
import { WhisperEngine } from './whisper-engine';

export type ModelId = 'fast' | 'balanced' | 'accurate';
export type StepId = 'download' | 'extract' | 'transcribe' | 'align' | 'speakers';
export type StepStatus = 'waiting' | 'running' | 'done' | 'error';
export type Phase = 'setup' | 'running' | 'error' | 'done';

export interface ModelInfo {
	id: ModelId;
	name: string;
	/** Default whisper.cpp (ggml) model for this tier; alternatives are in PLAN §5.2.1. */
	whisper: string;
	description: string;
	size: string;
	/** Rough processing time as a fraction of media duration on the CPU (PLAN §5.2.1). */
	speed: number;
	/** The same on a GPU. */
	gpuSpeed: number;
	recommended?: boolean;
	/** Not offered in the dialog (see the tier's comment). */
	hidden?: boolean;
}

export const MODELS: ModelInfo[] = [
	{
		id: 'fast',
		name: 'Fast',
		whisper: 'small',
		description: 'Good for clear speech.',
		size: '488 MB',
		speed: 0.11,
		gpuSpeed: 0.025,
	},
	{
		id: 'balanced',
		name: 'Balanced',
		whisper: 'large-v3-turbo',
		description: 'Most accurate. Handles accents and background music.',
		size: '1.6 GB',
		speed: 0.46,
		gpuSpeed: 0.04,
		recommended: true,
	},
	// Hidden until a model beats Balanced: large-v2 and large-v3 both fell into repetition
	// loops on long conversational audio, losing minutes of speech (PLAN §5.2.1).
	{
		id: 'accurate',
		name: 'Accurate',
		whisper: 'large-v2',
		description: 'Best for noisy audio or many speakers.',
		size: '2.9 GB',
		speed: 0.7,
		gpuSpeed: 0.06,
		hidden: true,
	},
];

/** Spoken-language choices and their Whisper codes (null: let the model detect it). */
export const LANGUAGE_CODES: Record<string, string | null> = {
	'Detect automatically': null,
	English: 'en',
	Spanish: 'es',
	French: 'fr',
	German: 'de',
	Italian: 'it',
	Portuguese: 'pt',
	Dutch: 'nl',
	Polish: 'pl',
	Russian: 'ru',
	Ukrainian: 'uk',
	Turkish: 'tr',
	Arabic: 'ar',
	Hindi: 'hi',
	Indonesian: 'id',
	Vietnamese: 'vi',
	Japanese: 'ja',
	Korean: 'ko',
	Chinese: 'zh',
};
export const LANGUAGES = Object.keys(LANGUAGE_CODES);

export interface TranscribeOptions {
	language: string;
	/**
	 * 'new' adds a "Transcript" track. A whole-video run onto a track adds to its cues; a
	 * range run replaces the track's cues inside the range (one undo step).
	 */
	target: 'new' | TrackId;
	/** Transcribe only this stretch (the in/out range), or null for the whole video. */
	range: { start: Ms; end: Ms } | null;
	model: ModelId;
	wordTimings: boolean;
	flagLowConfidence: boolean;
	/** Put each speaker on their own new track (whole-video runs only). */
	separateSpeakers: boolean;
	/** How many people speak, or null to detect it. */
	speakers: number | null;
}

export interface Step {
	id: StepId;
	label: string;
	status: StepStatus;
	detail: string;
}

/** Progress events an engine reports while it works. */
export type EngineEvent =
	| { type: 'step'; step: StepId; status: StepStatus; detail?: string }
	| { type: 'progress'; mediaMs: Ms; line?: { at: Ms; text: string } }
	| { type: 'download'; received: number; total: number };

/**
 * What the backend implements (Tauri command running whisper locally). Must honor `signal`
 * and resolve with the recognized cues, or reject with a user-facing Error.
 */
export interface TranscriptionEngine {
	isDownloaded(model: ModelId): boolean;
	/** Check which models are downloaded again (files may have changed outside the app). */
	refresh(): Promise<void>;
	/** Downloaded Whisper models by name, with their size in bytes. */
	downloaded(): ReadonlyMap<string, number>;
	/** Delete a downloaded model by whisper name. */
	delete(name: string): Promise<void>;
	/** The GPU transcription runs on, or null for the CPU. */
	device(): Promise<string | null>;
	run(
		opts: TranscribeOptions,
		durationMs: Ms,
		signal: AbortSignal,
		emit: (e: EngineEvent) => void,
	): Promise<Cue[]>;
}

export function bytes(n: number): string {
	return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

/** A cue is in a range when its middle is, as for the other in/out range operations. */
function inside(c: { start: Ms; end: Ms }, r: { start: Ms; end: Ms }): boolean {
	const mid = (c.start + c.end) / 2;
	return mid >= r.start && mid < r.end;
}

/**
 * Keep a range run's cues inside the range, so they can't overlap the cues on either side:
 * cues mostly outside go, the rest are trimmed to it (and their words with them).
 */
function clipToRange(cues: Cue[], r: { start: Ms; end: Ms }): Cue[] {
	return cues
		.filter((c) => inside(c, r))
		.map((c) => {
			const start = Math.max(c.start, r.start);
			const end = Math.min(c.end, r.end);
			const words = c.words
				?.filter((w) => inside(w, { start, end }))
				.map((w) => ({ ...w, start: Math.max(w.start, start), end: Math.min(w.end, end) }));
			return { ...c, start, end, ...(words && { words }) };
		});
}

/** "About 30 s" / "About 4 min": an estimate, rounded to what's worth showing. */
function roughly(ms: Ms): string {
	return ms < 50_000
		? `About ${Math.max(5, Math.round(ms / 5000) * 5)} s`
		: `About ${Math.max(1, Math.round(ms / 60_000))} min`;
}

function formatDuration(ms: Ms): string {
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * Auto-transcribe job state (PLAN §5.11). Lives outside the dialog so the job keeps
 * running in the background and the toolbar can show its progress.
 */
@Injectable({ providedIn: 'root' })
export class Transcription {
	private readonly store = inject(ProjectStore);
	private readonly files = inject(ProjectFiles);
	private readonly media = inject(MediaSource);
	private readonly speakerSeparation = inject(SpeakerSeparation);
	/**
	 * Transcription runs Whisper locally, so it only exists in the desktop app; the browser
	 * build hides every way into it.
	 */
	readonly available = isDesktop;
	private readonly engine: TranscriptionEngine | null = isDesktop
		? new WhisperEngine(
				() => this.media.path(),
				() => this.store.project().settings,
				() => this.downloads.update((n) => n + 1),
			)
		: null;

	/** The GPU transcription runs on, or null for the CPU (also before it's known). */
	readonly gpu = signal<string | null>(null);
	readonly phase = signal<Phase>('setup');
	/** Bumped when model downloads change, so `isDownloaded` reads stay reactive. */
	readonly downloads = signal(0);
	readonly options = signal<TranscribeOptions>({
		language: 'English',
		target: 'new',
		range: null,
		model: 'balanced',
		wordTimings: true,
		flagLowConfidence: true,
		separateSpeakers: false,
		speakers: null,
	});
	readonly steps = signal<Step[]>([]);
	readonly mediaMs = signal<Ms>(0);
	readonly lines = signal<{ at: Ms; text: string }[]>([]);
	readonly error = signal<{ title: string; detail: string } | null>(null);
	readonly result = signal<{
		trackName: string;
		trackColor: string;
		cues: number;
		/** Cues the range run replaced. */
		replaced: number;
		lowConfidence: number;
		speedWarnings: number;
		took: string;
		/** Set when the run separated speakers. */
		speakers?: SpeakerResult;
	} | null>(null);
	private startedAt = 0;
	private abort: AbortController | null = null;

	/** Length of what's transcribed: the range, or the whole video. */
	readonly durationMs = computed(() => {
		const r = this.options().range;
		return r ? r.end - r.start : this.store.duration();
	});
	/** Model download progress while the download step runs; null otherwise. */
	readonly download = signal<{ received: number; total: number } | null>(null);
	/** Stop was pressed; the engine takes a moment to finish the chunk it's on. */
	readonly stopping = signal(false);
	/** The speaker step is running (it reports no progress of its own). */
	readonly separating = signal(false);
	/** This run puts each speaker on their own track. */
	readonly separatesSpeakers = computed(() => {
		const o = this.options();
		return o.separateSpeakers && !o.range;
	});
	/** Fraction done: of the download while downloading, else of the media. */
	readonly progress = computed(() => {
		const d = this.download();
		if (d) return d.total ? Math.min(1, d.received / d.total) : 0;
		return Math.min(1, this.mediaMs() / Math.max(1, this.durationMs()));
	});
	readonly running = computed(() => this.phase() === 'running');

	/** Name for a new track: "Transcript", then "Transcript 2", "Transcript 3"… */
	readonly nextTrackName = computed(() => {
		const names = new Set(this.store.project().tracks.map((t) => t.name));
		if (!names.has('Transcript')) return 'Transcript';
		let n = 2;
		while (names.has(`Transcript ${n}`)) n++;
		return `Transcript ${n}`;
	});
	/** The new track's name for the job that's running or just finished. */
	private readonly trackName = signal('Transcript');

	readonly summary = computed(() => {
		const o = this.options();
		const model = MODELS.find((m) => m.id === o.model)!;
		const name = o.target === 'new' ? '' : (this.store.track(o.target)?.name ?? 'track');
		const target = this.separatesSpeakers()
			? 'A new track per speaker'
			: o.target === 'new'
				? `New track: ${this.trackName()}`
				: o.range
					? `Range on ${name}`
					: `Add to ${name}`;
		const language = LANGUAGE_CODES[o.language] ? o.language : 'Any language';
		return `${model.name} model • ${language} • ${target}`;
	});

	/** Remaining-time estimate from the chosen model's speed. */
	readonly remaining = computed(() => {
		const model = MODELS.find((m) => m.id === this.options().model)!;
		const left = (this.durationMs() - this.mediaMs()) * this.speed(model);
		return `${roughly(left).toLowerCase()} left`;
	});

	/** Setup subtitle: where transcription runs. */
	readonly privacyNote = computed(() => {
		const gpu = this.gpu();
		return `Runs on this computer${gpu ? `'s ${gpu}` : ''}. Your video is never uploaded.`;
	});

	constructor() {
		void this.engine?.device().then((d) => this.gpu.set(d));
	}

	private speed(model: ModelInfo): number {
		return this.gpu() ? model.gpuSpeed : model.speed;
	}

	isDownloaded(model: ModelId): boolean {
		this.downloads();
		return !!this.engine?.isDownloaded(model);
	}

	/** Downloaded models the dialog doesn't offer (e.g. a hidden tier's), with their total size. */
	readonly unused = computed(() => {
		this.downloads();
		const offered = new Set(MODELS.filter((m) => !m.hidden).map((m) => m.whisper));
		const models = [...(this.engine?.downloaded() ?? [])].filter(([n]) => !offered.has(n));
		if (!models.length) return null;
		return {
			names: models.map(([n]) => n),
			size: bytes(models.reduce((sum, [, b]) => sum + b, 0)),
		};
	});

	/** Check which models are downloaded again, unless a job is downloading one. */
	refreshModels(): void {
		if (!this.running()) void this.engine?.refresh();
	}

	/** A model delete is in progress. */
	readonly deleting = signal(false);
	readonly deleteError = signal<string | null>(null);

	/** Delete downloaded models by whisper name, to free up space. */
	async deleteModels(names: string[]): Promise<void> {
		if (!this.engine) return;
		this.deleting.set(true);
		this.deleteError.set(null);
		try {
			for (const name of names) await this.engine.delete(name);
		} catch (e) {
			this.deleteError.set(String(e));
		} finally {
			this.deleting.set(false);
		}
	}

	estimate(model: ModelInfo): string {
		const what = this.options().range ? 'range' : 'video';
		return `${roughly(this.durationMs() * this.speed(model))} for this ${what}.`;
	}

	setOptions(changes: Partial<TranscribeOptions>): void {
		this.options.update((o) => ({ ...o, ...changes }));
	}

	reset(): void {
		if (this.running()) return;
		this.phase.set('setup');
		this.error.set(null);
		this.result.set(null);
	}

	async start(): Promise<void> {
		if (!this.engine) return;
		const opts = this.options();
		const model = MODELS.find((m) => m.id === opts.model)!;
		this.trackName.set(this.nextTrackName());
		this.steps.set([
			{
				id: 'download',
				label: `Download ${model.name} model`,
				status: 'waiting',
				detail: 'Waiting',
			},
			{ id: 'extract', label: 'Extract audio', status: 'waiting', detail: 'Waiting' },
			{ id: 'transcribe', label: 'Transcribe speech', status: 'waiting', detail: 'Waiting' },
			{ id: 'align', label: 'Align word timings', status: 'waiting', detail: 'Waiting' },
			...(this.separatesSpeakers()
				? [
						{
							id: 'speakers' as const,
							label: 'Separate speakers',
							status: 'waiting' as const,
							detail: 'Waiting',
						},
					]
				: []),
		]);
		this.mediaMs.set(0);
		this.download.set(null);
		this.stopping.set(false);
		this.separating.set(false);
		this.lines.set([]);
		this.error.set(null);
		this.result.set(null);
		this.phase.set('running');
		this.startedAt = performance.now();
		const stepStarted = new Map<StepId, number>();
		this.abort = new AbortController();

		const signal = this.abort.signal;
		const setStep = (step: StepId, status: StepStatus, detail: string) =>
			this.steps.update((steps) =>
				steps.map((s) => (s.id === step ? { ...s, status, detail } : s)),
			);
		try {
			const cues = await this.engine.run(opts, this.durationMs(), signal, (e) => {
				if (e.type === 'download') {
					this.download.set({ received: e.received, total: e.total });
					return;
				}
				if (e.type === 'progress') {
					this.mediaMs.set(e.mediaMs);
					if (e.line) this.lines.update((l) => [...l, e.line!].slice(-3));
					return;
				}
				if (e.step === 'download' && e.status !== 'running') this.download.set(null);
				if (e.status === 'running' && !stepStarted.has(e.step))
					stepStarted.set(e.step, performance.now());
				// Finished compute steps show how long they took.
				const took =
					e.status === 'done' && !e.detail && stepStarted.has(e.step)
						? formatDuration(performance.now() - stepStarted.get(e.step)!)
						: undefined;
				this.steps.update((steps) =>
					steps.map((s) =>
						s.id === e.step
							? { ...s, status: e.status, detail: e.detail || took || s.detail }
							: s,
					),
				);
			});
			let turns: SpeakerTurn[] | null = null;
			if (this.separatesSpeakers() && cues.length) {
				const started = performance.now();
				setStep('speakers', 'running', '');
				this.separating.set(true);
				try {
					turns = await this.speakerSeparation.turns(opts.speakers, signal, (e) => {
						if (e.type === 'download') {
							this.download.set({ received: e.received, total: e.total });
							setStep(
								'speakers',
								'running',
								`Downloading ${bytes(e.received)} of ${e.total ? bytes(e.total) : SPEAKER_MODELS_SIZE}`,
							);
						} else if (e.type === 'separating') {
							this.download.set(null);
							setStep('speakers', 'running', '');
						}
					});
				} catch (err) {
					if ((err as Error).name !== 'AbortError') setStep('speakers', 'error', '');
					throw err;
				}
				setStep('speakers', 'done', formatDuration(performance.now() - started));
			}
			this.finish(cues, turns);
		} catch (err) {
			if ((err as Error).name === 'AbortError') {
				this.phase.set('setup');
				return;
			}
			const [title, detail = ''] = String((err as Error).message ?? err).split('|');
			this.error.set({ title, detail });
			this.phase.set('error');
		} finally {
			this.abort = null;
			this.download.set(null);
			this.stopping.set(false);
			this.separating.set(false);
			this.downloads.update((n) => n + 1);
		}
	}

	stop(): void {
		if (!this.abort) return;
		this.stopping.set(true);
		this.abort.abort();
	}

	/**
	 * The part of the range a range run can fill: a kept cue on either side may reach into it,
	 * and new cues stop where it does (so words it already has aren't repeated).
	 */
	private freeSpan(target: TranscribeOptions['target'], range: { start: Ms; end: Ms }) {
		let { start, end } = range;
		if (target === 'new') return { start, end };
		for (const c of this.store.track(target)?.cues ?? []) {
			if (inside(c, range)) continue;
			if (c.start < range.start) start = Math.max(start, c.end);
			else end = Math.min(end, c.start);
		}
		return { start, end };
	}

	private finish(cues: Cue[], turns: SpeakerTurn[] | null): void {
		const opts = this.options();
		if (opts.range) cues = clipToRange(cues, this.freeSpan(opts.target, opts.range));
		let trackId = opts.target;
		let trackName: string;
		let trackColor: string;
		let replaced = 0;
		let speakers: SpeakerResult | undefined;
		let trackIds: TrackId[] = [];
		if (turns) {
			const track = createTrack(this.trackName(), this.files.nextTrackColor());
			track.cues = cues;
			const split = this.speakerSeparation.split(track, turns, !opts.speakers);
			this.store.apply('Auto-transcribe', SpeakerSeparation.replace(null, split));
			speakers = SpeakerSeparation.result(split);
			trackIds = split.tracks.map((t) => t.id);
			trackName = `${split.tracks.length} speaker tracks`;
			trackColor = split.tracks[0]?.color ?? track.color;
		} else if (opts.target === 'new') {
			const track = createTrack(this.trackName(), this.files.nextTrackColor());
			track.cues = cues;
			trackId = track.id;
			trackName = track.name;
			trackColor = track.color;
			this.store.apply('Auto-transcribe', addTrack(track));
		} else {
			const t = this.store.track(opts.target)!;
			trackName = t.name;
			trackColor = t.color;
			const range = opts.range;
			const inRange = (c: Cue) => !!range && inside(c, range);
			replaced = t.cues.filter(inRange).length;
			this.store.apply(range ? 'Auto-transcribe range' : 'Auto-transcribe', (p) => {
				const target = p.tracks.find((x) => x.id === opts.target)!;
				if (range) target.cues = target.cues.filter((c) => !inRange(c));
				target.cues.push(...cues);
				target.cues.sort((a, b) => a.start - b.start);
			});
		}
		const lowConfidence = opts.flagLowConfidence
			? cues.reduce(
					(n, c) => n + (c.words?.filter((w) => (w.confidence ?? 1) < 0.5).length ?? 0),
					0,
				)
			: 0;
		if (!trackIds.length) trackIds = [trackId as TrackId];
		const speedWarnings = this.store
			.problems()
			.filter((p) => trackIds.includes(p.trackId) && p.kind === 'cps').length;
		this.result.set({
			trackName,
			trackColor,
			cues: cues.length,
			replaced,
			lowConfidence,
			speedWarnings,
			took: formatDuration(performance.now() - this.startedAt),
			speakers,
		});
		this.phase.set('done');
	}
}
