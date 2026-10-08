import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { LucideFolder } from '@lucide/angular';
import { FORMATS, FormatId } from '../../core/formats';
import { Project, TrackId } from '../../core/model/types';
import { EditorUi } from '../../state/editor-ui';
import {
	SaveTarget,
	basename,
	canPickSaveTarget,
	dirname,
	isDesktop,
	pickSaveTarget,
	writeText,
} from '../../state/file-io';
import { ProjectFiles } from '../../state/project-files';
import { ProjectStore } from '../../state/project-store';
import { Button } from '../../ui/button/button';
import { Checkbox } from '../../ui/controls/controls';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Field } from '../../ui/field/field';
import { Notice } from '../../ui/notice/notice';
import { CountPipe } from '../../ui/count/count';

const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
const sep = (p: string) => (p.includes('\\') ? '\\' : '/');

const CARDS: { id: FormatId; name: string; description: string }[] = [
	{ id: 'srv3', name: 'SRV3', description: 'Best for YouTube. Keeps all styling and positions.' },
	{ id: 'srt', name: 'SRT', description: 'Most video players. Text only.' },
	{ id: 'vtt', name: 'VTT', description: 'Other web players. Basic styling will be kept.' },
	{ id: 'sbv', name: 'SBV', description: 'Older YouTube format. Text only.' },
];

/** Export captions (PLAN §5.9): format, tracks to combine, destination, and lint warnings. */
@Component({
	selector: 'bc-export-dialog',
	imports: [CountPipe, Dialog, Button, Checkbox, Field, Notice, LucideFolder],
	templateUrl: './export-dialog.html',
	styleUrl: './export-dialog.css',
})
export class ExportDialog implements OnInit {
	private readonly store = inject(ProjectStore);
	private readonly ui = inject(EditorUi);
	protected readonly ref = inject(DialogRef);
	/** Tracks to start with ("Export this track…"); defaults to the visible ones. */
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
	/** Browser save handle from Browse (desktop uses the path in the field). */
	private handle: FileSystemFileHandle | undefined;
	/** What the user typed or browsed to; empty means the default. */
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
	/** Default: next to the project file (or the video) on desktop, a bare name in the browser. */
	protected readonly path = computed(() => {
		if (this.fileName()) return this.fileName();
		const name = `${this.project().name}.${FORMATS[this.format()].extensions.at(-1)}`;
		const near = this.files.currentPath() ?? this.project().media?.path;
		return isDesktop && near && isAbsolute(near) ? `${dirname(near)}${sep(near)}${name}` : name;
	});

	protected readonly problems = computed(() => {
		const ids = this.included();
		const list = this.store.problems().filter((p) => ids.has(p.trackId));
		return {
			errors: list.filter((p) => p.severity === 'error').length,
			warnings: list.filter((p) => p.severity !== 'error').length,
		};
	});
	protected readonly problemTitle = computed(() => {
		const { errors, warnings } = this.problems();
		const parts = [
			errors && `${errors} error${errors > 1 ? 's' : ''}`,
			warnings && `${warnings} warning${warnings > 1 ? 's' : ''}`,
		].filter(Boolean);
		return `${parts.join(' and ')} in these tracks`;
	});

	protected setFormat(id: FormatId): void {
		this.format.set(id);
		// Keep a chosen file name but swap its extension.
		const name = this.fileName();
		if (name)
			this.fileName.set(name.replace(/\.[^.]+$/, '') + '.' + FORMATS[id].extensions.at(-1));
		this.handle = undefined;
	}

	protected toggleTrack(id: TrackId, on: boolean): void {
		const next = new Set(this.included());
		if (on) next.add(id);
		else next.delete(id);
		this.included.set(next);
	}

	protected async browse(): Promise<void> {
		const target = await pickSaveTarget(this.path(), this.filter());
		if (!target) return;
		this.handle = target.handle;
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
		const ids = this.included();
		if (!ids.size) return;
		// Selected tracks combine into one file regardless of preview mute/solo.
		const p = this.project();
		const subset: Project = {
			...p,
			tracks: p.tracks
				.filter((t) => ids.has(t.id))
				.map((t) => ({ ...t, muted: false, solo: false })),
		};
		// On desktop a bare file name has no folder yet, so ask where.
		let target: SaveTarget | null = isDesktop
			? isAbsolute(this.path())
				? { name: basename(this.path()), path: this.path() }
				: await pickSaveTarget(this.path(), this.filter())
			: { name: basename(this.path()), path: null, handle: this.handle };
		if (!target) return;
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
