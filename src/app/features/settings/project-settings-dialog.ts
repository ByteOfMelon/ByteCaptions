import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { LucideFolder } from '@lucide/angular';
import { defaultSettings } from '../../core/model/defaults';
import { MediaRef, ProjectSettings } from '../../core/model/types';
import { PickedFile, VIDEO_FILTER, openFile } from '../../state/file-io';
import { ProjectFiles } from '../../state/project-files';
import { ProjectStore } from '../../state/project-store';
import { Button } from '../../ui/button/button';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Field, NumberField } from '../../ui/field/field';
import { Select } from '../../ui/select/select';
import { Tabs } from '../../ui/tabs/tabs';

export type SettingsTab = 'general' | 'rules';

const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

/** Project settings: name, frame rate and video (General), and the caption rules Problems checks. */
@Component({
	selector: 'bc-project-settings-dialog',
	imports: [Dialog, Button, Field, NumberField, Select, Tabs, LucideFolder],
	templateUrl: './project-settings-dialog.html',
	styleUrl: './project-settings-dialog.css',
})
export class ProjectSettingsDialog implements OnInit {
	private readonly store = inject(ProjectStore);
	private readonly files = inject(ProjectFiles);
	protected readonly ref = inject(DialogRef);
	readonly initialTab = input<SettingsTab>('general');

	protected readonly tabs = [
		{ value: 'general' as SettingsTab, label: 'General' },
		{ value: 'rules' as SettingsTab, label: 'Caption rules' },
	];
	protected readonly tab = signal<SettingsTab>('general');

	private readonly project = this.store.project();
	protected readonly name = signal(this.project.name);
	protected readonly fps = signal(this.project.fps);
	/** A newly browsed video, applied on Save. */
	private readonly video = signal<{ file: PickedFile; ref: MediaRef } | null>(null);
	protected readonly videoPath = computed(
		() => this.video()?.ref.path ?? this.project.media?.path ?? '',
	);

	// Durations are edited in seconds; the project stores ms.
	protected readonly maxChars = signal(this.project.settings.maxCharsPerLine);
	protected readonly maxLines = signal(this.project.settings.maxLines);
	protected readonly maxCps = signal(this.project.settings.maxCps);
	protected readonly minGap = signal(this.project.settings.minGapMs);
	protected readonly minDuration = signal(this.project.settings.minDurationMs / 1000);
	protected readonly maxDuration = signal(this.project.settings.maxDurationMs / 1000);

	protected readonly fpsOptions = computed(() =>
		[...new Set([...FRAME_RATES, this.project.fps])]
			.sort((a, b) => a - b)
			.map((v) => ({ value: v, label: `${v} fps` })),
	);

	protected readonly subtitle = computed(() => {
		const s = Math.round(this.store.duration() / 1000);
		return `${this.project.name} • ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	protected readonly nameError = computed(() =>
		this.name().trim() ? null : 'Project name can’t be empty.',
	);
	/** The duration changed last shows the error when min isn't below max. */
	protected readonly lastDuration = signal<'min' | 'max'>('min');
	protected readonly durationError = computed(() => {
		if (this.minDuration() < this.maxDuration()) return null;
		return this.lastDuration() === 'min'
			? { min: 'Must be shorter than max duration.', max: null }
			: { min: null, max: 'Must be longer than min duration.' };
	});
	protected readonly isDefault = computed(() => {
		const d = defaultSettings();
		return (
			this.maxChars() === d.maxCharsPerLine &&
			this.maxLines() === d.maxLines &&
			this.maxCps() === d.maxCps &&
			this.minGap() === d.minGapMs &&
			this.minDuration() * 1000 === d.minDurationMs &&
			this.maxDuration() * 1000 === d.maxDurationMs
		);
	});

	ngOnInit(): void {
		this.tab.set(this.initialTab());
	}

	protected async browse(): Promise<void> {
		const file = await openFile(VIDEO_FILTER);
		if (file) this.video.set({ file, ref: await this.files.videoRef(file) });
	}

	protected resetRules(): void {
		const d = defaultSettings();
		this.maxChars.set(d.maxCharsPerLine);
		this.maxLines.set(d.maxLines);
		this.maxCps.set(d.maxCps);
		this.minGap.set(d.minGapMs);
		this.minDuration.set(d.minDurationMs / 1000);
		this.maxDuration.set(d.maxDurationMs / 1000);
	}

	/** Applies every change as one undo step. */
	protected save(): void {
		if (this.durationError() || this.nameError()) return;
		const name = this.name().trim();
		const settings: ProjectSettings = {
			maxCharsPerLine: this.maxChars(),
			maxLines: this.maxLines(),
			maxCps: this.maxCps(),
			minGapMs: this.minGap(),
			minDurationMs: Math.round(this.minDuration() * 1000),
			maxDurationMs: Math.round(this.maxDuration() * 1000),
		};
		const video = this.video();
		const p = this.project;
		const changed =
			name !== p.name ||
			this.fps() !== p.fps ||
			!!video ||
			(Object.keys(settings) as (keyof ProjectSettings)[]).some(
				(k) => settings[k] !== p.settings[k],
			);
		if (changed)
			this.store.apply('Project settings', (draft) => {
				draft.name = name;
				draft.fps = this.fps();
				draft.settings = settings;
				if (video) draft.media = video.ref;
			});
		if (video) this.files.loadVideo(video.file);
		this.ref.close();
	}
}
