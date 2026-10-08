import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { LucideCheck, LucideCircle, LucideLoaderCircle, LucideX } from '@lucide/angular';
import { formatClock } from '../../core/time/timecode';
import { EditorUi } from '../../state/editor-ui';
import { ProjectStore } from '../../state/project-store';
import { LANGUAGES, MODELS, ModelId, Transcription } from '../../state/transcription';
import { Button } from '../../ui/button/button';
import { Toggle } from '../../ui/controls/controls';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Notice } from '../../ui/notice/notice';
import { Select } from '../../ui/select/select';

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

	protected readonly languageOptions = LANGUAGES.map((l) => ({ value: l, label: l }));
	protected readonly targetOptions = computed(() => [
		{ value: 'new', label: 'New track: Transcript' },
		...this.store.project().tracks.map((t) => ({ value: t.id, label: `Add to ${t.name}` })),
	]);

	protected readonly selectedModel = computed(() =>
		MODELS.find((m) => m.id === this.job.options().model)!,
	);
	protected readonly needsDownload = computed(
		() => !this.job.isDownloaded(this.job.options().model),
	);
	protected readonly position = computed(
		() =>
			`${formatClock(this.job.mediaMs()).slice(0, 8)} of ${formatClock(this.job.durationMs()).slice(0, 8)}`,
	);

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
