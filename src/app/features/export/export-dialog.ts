import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { LucideFolder } from '@lucide/angular';
import { FORMATS, FormatId } from '../../core/formats';
import { exportSrv3 } from '../../core/formats/srv3';
import { Project, TrackId } from '../../core/model/types';
import { EditorUi } from '../../state/editor-ui';
import {
	SaveTarget,
	basename,
	canPickSaveTarget,
	confirmAction,
	dirname,
	fileExists,
	isDesktop,
	pickSaveTarget,
	writeText,
} from '../../state/file-io';
import { ProjectFiles } from '../../state/project-files';
import { ProjectStore } from '../../state/project-store';
import { Button } from '../../ui/button/button';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Field } from '../../ui/field/field';
import { Notice } from '../../ui/notice/notice';
import { ShowEnd } from '../../ui/show-end/show-end';
import { TrackChecklist } from './track-checklist';
import { TrackProblems } from './track-problems';

const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
const sep = (p: string) => (p.includes('\\') ? '\\' : '/');

const CARDS: { id: FormatId; name: string; description: string }[] = [
	{ id: 'srv3', name: 'SRV3', description: 'Best for YouTube. Keeps all styling and positions.' },
	{ id: 'vtt', name: 'VTT', description: 'Other web players. Keeps most styling.' },
	{ id: 'srt', name: 'SRT', description: 'Most video players. Text only.' },
	{ id: 'sbv', name: 'SBV', description: 'Older YouTube format. Text only.' },
];

@Component({
	selector: 'bc-export-dialog',
	imports: [Dialog, Button, Field, Notice, ShowEnd, TrackChecklist, TrackProblems, LucideFolder],
	templateUrl: './export-dialog.html',
	styleUrl: './export-dialog.css',
})
export class ExportDialog implements OnInit {
	private readonly store = inject(ProjectStore);
	private readonly ui = inject(EditorUi);
	protected readonly ref = inject(DialogRef);
	/** Tracks to start with, defaults to the visible ones */
	readonly trackIds = input<TrackId[]>();
	protected readonly cards = CARDS;
	protected readonly canBrowse = canPickSaveTarget();

	protected readonly format = signal<FormatId>('srv3');
	protected readonly included = signal<ReadonlySet<TrackId>>(
		new Set(
			this.store
				.project()
				.tracks.filter((t) => !t.muted)
				.map((t) => t.id),
		),
	);
	private readonly files = inject(ProjectFiles);
	/** Browser save handle from Browse (desktop uses the path in the field) */
	private handle: FileSystemFileHandle | undefined;
	/** Path chosen in the save dialog */
	private browsedPath: string | null = null;
	/** What the user typed or browsed to */
	protected readonly fileName = signal('');
	protected readonly error = signal<string | null>(null);
	protected readonly busy = signal(false);

	protected readonly project = this.store.project;

	ngOnInit(): void {
		const ids = this.trackIds();

		if (ids?.length) this.included.set(new Set(ids));
	}
	protected readonly subtitle = computed(() => {
		const s = Math.round(this.store.duration() / 1000);

		return `${this.project().name} • ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});
	protected readonly loses = computed(() => FORMATS[this.format()].loses);
	protected readonly styleNotice = computed(() =>
		this.format() === 'srt' || this.format() === 'sbv'
			? {
					title: "This format doesn't support styling",
					detail: 'Colors, font changes, and positions will not be exported.',
				}
			: { title: 'Some styling will be lost', detail: this.loses().join(' • ') },
	);

	protected readonly path = computed(() => {
		if (this.fileName()) return this.fileName();

		const name = `${this.project().name}.${FORMATS[this.format()].extensions.at(-1)}`;
		const near = this.files.currentPath() ?? this.project().media?.path;

		return isDesktop && near && isAbsolute(near) ? `${dirname(near)}${sep(near)}${name}` : name;
	});

	private readonly subset = computed<Project>(() => {
		const ids = this.included();
		const p = this.project();

		return {
			...p,
			tracks: p.tracks
				.filter((t) => ids.has(t.id))
				.map((t) => ({ ...t, muted: false, solo: false })),
		};
	});

	protected readonly heavy = computed(() => {
		if (this.format() !== 'srv3' || !this.included().size) return null;

		const { weight, lines, bytes } = exportSrv3(this.subset()).stats;

		if (weight < 0.8) return null;

		return {
			over: weight >= 1,
			title:
				weight >= 1
					? 'This file may be too large for YouTube'
					: 'This file is close to the size YouTube can show',
			detail: `${lines} lines • ${(bytes / 1024).toFixed(0)} KB • ${Math.round(weight * 100)}% of the safe size. Merging cues or using fewer styles makes it smaller.`,
		};
	});

	protected setFormat(id: FormatId): void {
		this.format.set(id);
		const name = this.fileName();

		if (name)
			this.fileName.set(name.replace(/\.[^.]+$/, '') + '.' + FORMATS[id].extensions.at(-1));

		this.handle = undefined;
	}

	protected async browse(): Promise<void> {
		const target = await pickSaveTarget(this.path(), this.filter());

		if (!target) return;

		this.handle = target.handle;
		this.browsedPath = target.path ?? null;
		this.fileName.set(target.path ?? target.name);
	}

	private filter() {
		const f = FORMATS[this.format()];

		return { name: f.label, extensions: [...f.extensions] };
	}

	protected review(): void {
		this.ui.sideTab.set('problems');
		this.ref.close();
	}

	protected async export(): Promise<void> {
		if (!this.included().size) return;

		const subset = this.subset();

		let target: SaveTarget | null = isDesktop
			? isAbsolute(this.path())
				? { name: basename(this.path()), path: this.path() }
				: await pickSaveTarget(this.path(), this.filter())
			: { name: basename(this.path()), path: null, handle: this.handle };

		if (!target) return;

		if (
			isDesktop &&
			isAbsolute(this.path()) &&
			this.path() !== this.browsedPath &&
			(await fileExists(target.path!)) &&
			!(await confirmAction(
				`${target.name} already exists. Replace it?`,
				'Replace file',
				'Replace',
			))
		)
			return;

		this.busy.set(true);

		try {
			await writeText(target, FORMATS[this.format()].export(subset));
			this.ref.close(target.path ?? target.name);
		} catch (e) {
			this.error.set(`Couldn't write ${target.name}. ${e instanceof Error ? e.message : e}`);
		} finally {
			this.busy.set(false);
		}
	}
}
