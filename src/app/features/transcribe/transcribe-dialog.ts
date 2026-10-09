import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { LucideCheck, LucideCircle, LucideLoaderCircle, LucideX } from '@lucide/angular';
import { TrackId } from '../../core/model/types';
import { formatClock, formatTimecode } from '../../core/time/timecode';
import { EditorUi } from '../../state/editor-ui';
import { ProjectStore } from '../../state/project-store';
import { LANGUAGES, MODELS, ModelId, Transcription } from '../../state/transcription';
import { Button } from '../../ui/button/button';
import { Playback } from '../player/playback';
import { Toggle } from '../../ui/controls/controls';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Notice } from '../../ui/notice/notice';
import { Select } from '../../ui/select/select';
import { Tooltip } from '../../ui/tooltip/tooltip';

/** Auto-transcribe (PLAN §5.11): setup → running → done / error. Closing keeps it running. */
@Component({
	selector: 'bc-transcribe-dialog',
	imports: [
		NgTemplateOutlet,
		Dialog,
		Button,
		Toggle,
		Select,
		Notice,
		Tooltip,
		LucideCheck,
		LucideCircle,
		LucideLoaderCircle,
		LucideX,
	],
	templateUrl: './transcribe-dialog.html',
	styleUrl: './transcribe-dialog.css',
})
export class TranscribeDialog {
	protected readonly job = inject(Transcription);
	private readonly store = inject(ProjectStore);
	private readonly ui = inject(EditorUi);
	protected readonly ref = inject(DialogRef);
	protected readonly models = MODELS.filter((m) => !m.hidden);
	protected readonly Math = Math;

	private readonly playback = inject(Playback);

	protected readonly languageOptions = LANGUAGES.map((l) => ({ value: l, label: l }));
	/** Tracks a range run can replace cues on. */
	private readonly unlocked = computed(() =>
		this.store.project().tracks.filter((t) => !t.locked),
	);
	/** A range run redoes part of a track, so it only offers existing tracks (when there are). */
	private readonly rangeOnTrack = computed(
		() => !!this.job.options().range && this.unlocked().length > 0,
	);
	protected readonly targetOptions = computed(() =>
		this.rangeOnTrack()
			? this.unlocked().map((t) => ({ value: t.id, label: t.name }))
			: [
					{ value: 'new', label: `New track: ${this.job.nextTrackName()}` },
					...this.store
						.project()
						.tracks.map((t) => ({ value: t.id, label: `Add to ${t.name}` })),
				],
	);

	/** The in/out range when one is set; the dialog then offers to transcribe just that. */
	protected readonly range = this.playback.range;
	protected readonly scopeOptions = computed(() => {
		const r = this.range();
		if (!r) return [];
		const tc = (ms: number) =>
			this.ui.timeUnits() === 'ms'
				? formatClock(ms)
				: formatTimecode(ms, this.store.project().fps);
		return [
			{
				value: 'range',
				label: `In/out range • ${tc(r.start)} → ${tc(r.end)} (${length(r.end - r.start)})`,
			},
			{ value: 'all', label: 'Whole video' },
		];
	});
	/** What a range run will do to the chosen track. */
	protected readonly rangeNote = computed(() => {
		const o = this.job.options();
		const r = o.range;
		if (!r || o.target === 'new') return null;
		const t = this.store.track(o.target);
		if (!t) return null;
		const n = t.cues.filter((c) => {
			const mid = (c.start + c.end) / 2;
			return mid >= r.start && mid < r.end;
		}).length;
		if (!n) return `Adds cues to ${t.name} inside the range.`;
		const what = n === 1 ? 'the cue' : `the ${n} cues`;
		return `Replaces ${what} on ${t.name} inside the range. Undo brings ${n === 1 ? 'it' : 'them'} back.`;
	});

	protected readonly selectedModel = computed(() =>
		MODELS.find((m) => m.id === this.job.options().model)!,
	);
	protected readonly needsDownload = computed(
		() => !this.job.isDownloaded(this.job.options().model),
	);
	protected readonly unusedDetail = computed(() => {
		const names = this.job.unused()?.names ?? [];
		const list =
			names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
		return `Whisper ${list} ${names.length > 1 ? 'are' : 'is'} no longer offered here.`;
	});
	protected readonly position = computed(
		() =>
			`${formatClock(this.job.mediaMs()).slice(0, 8)} of ${formatClock(this.job.durationMs()).slice(0, 8)}`,
	);

	constructor() {
		this.job.refreshModels();
		// Opening with a range set defaults to transcribing just that.
		if (!this.job.running() && this.job.phase() === 'setup')
			this.setScope(this.range() ? 'range' : 'all');
	}

	protected setScope(scope: string): void {
		this.job.setOptions({ range: scope === 'range' ? this.range() : null });
		const target = this.job.options().target;
		const valid = this.targetOptions().some((o) => o.value === target);
		if (!valid) this.job.setOptions({ target: this.defaultTrack() ?? 'new' });
	}

	/** The selected cue's track if it can be changed, else the first one that can. */
	private defaultTrack(): TrackId | null {
		const primary = this.store.primary()?.track;
		if (primary && !primary.locked) return primary.id;
		return this.unlocked()[0]?.id ?? null;
	}

	protected downloaded(id: ModelId): boolean {
		return this.job.isDownloaded(id);
	}

	protected time(ms: number): string {
		return formatClock(ms).slice(0, 8);
	}

	protected start(): void {
		void this.job.start();
	}

	protected useFast(): void {
		this.job.setOptions({ model: 'fast' });
		this.start();
	}

	protected reviewProblems(): void {
		this.ui.sideTab.set('problems');
		this.finish();
	}

	/** Leaving the Done state returns the job to setup for next time. */
	protected finish(): void {
		this.job.reset();
		this.ref.close();
	}

	protected cancel(): void {
		if (this.job.phase() === 'error') this.job.reset();
		this.ref.close();
	}
}

/** "6.5 s" / "2 min 5 s". */
function length(ms: number): string {
	const s = Math.round(ms / 100) / 10;
	return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}
