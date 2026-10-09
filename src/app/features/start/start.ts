import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideCaptions, LucideFilm, LucideFolderOpen, LucideUpload } from '@lucide/angular';
import { version } from '../../../../package.json';
import { formatBytes, formatLength } from '../../core/units/units';
import { FileDrop, dropKind } from '../../state/file-drop';
import { PickedFile, confirmAction, WEBSITE, openExternal, probeVideo } from '../../state/file-io';
import { ProjectFiles } from '../../state/project-files';
import { RecentProject, RecentProjects, editedLabel } from '../../state/recent-projects';
import { Recovery, RecoveryEntry } from '../../state/recovery';
import { Button } from '../../ui/button/button';
import { Dialogs } from '../../ui/dialog/dialog';
import { keyCaps } from '../../ui/kbd/keys';
import { Notice } from '../../ui/notice/notice';
import { SettingsDialog } from '../settings/settings-dialog';
import { ShortcutsDialog } from '../shortcuts/shortcuts-dialog';

/**
 * Start screen (PLAN §5.1): new project from a video, open a project, import captions,
 * and recent projects. Dropping a file anywhere on the window starts from it.
 */
@Component({
	selector: 'bc-start',
	imports: [Button, Notice, LucideCaptions, LucideFilm, LucideFolderOpen, LucideUpload],
	templateUrl: './start.html',
	styleUrl: './start.css',
	host: { '(window:keydown)': 'onKey($event)' },
})
export class Start implements OnDestroy {
	/** Shortcut text for this computer (⌘ on the Mac). */
	protected readonly keys = (k: string) => keyCaps(k, ' ').join(' ');
	private readonly files = inject(ProjectFiles);
	private readonly router = inject(Router);
	private readonly recentProjects = inject(RecentProjects);
	private readonly drop = inject(FileDrop);
	private readonly recovery = inject(Recovery);
	private readonly dialogs = inject(Dialogs);
	protected readonly version = version;
	protected readonly website = WEBSITE;
	protected readonly error = this.files.error;

	/** "17:42 • 2.1 GB" for a video being dragged in (desktop knows the file before the drop). */
	private readonly dragDetail = signal<string | null>(null);
	protected readonly dragging = computed(() => {
		const h = this.drop.hover();
		if (!h) return null;
		const video = h.kind === 'video';
		return {
			title: video ? 'Drop to start a project' : 'Drop to open',
			name: h.file?.name ?? (video ? 'Video file' : 'Video, project or caption file'),
			detail: this.dragDetail(),
		};
	});

	protected readonly recent = computed(() =>
		this.recentProjects.list().map((r) => ({
			...r,
			edited: editedLabel(r.editedAt),
			meta: `${r.cues} cue${r.cues === 1 ? '' : 's'} • ${formatLength(r.durationMs)}`,
		})),
	);

	/** Unsaved work left over from a session that closed unexpectedly. */
	protected readonly recovered = computed(() =>
		this.recovery.entries().map((entry) => ({
			entry,
			detail: `ByteCaptions closed before these changes were saved • ${editedLabel(entry.savedAt)}`,
		})),
	);

	private readonly onDrop = (file: PickedFile) => void this.openDropped(file);

	constructor() {
		this.drop.handler = this.onDrop;
		effect((onCleanup) => {
			const h = this.drop.hover();
			this.dragDetail.set(null);
			if (h?.kind !== 'video' || !h.file) return;
			let live = true;
			onCleanup(() => (live = false));
			void Promise.all([probeVideo(h.file.mediaUrl()), h.file.size()]).then(
				([info, size]) => {
					const parts = [
						info ? formatLength(info.durationMs) : null,
						size !== null ? formatBytes(size) : null,
					].filter(Boolean);
					if (live && parts.length) this.dragDetail.set(parts.join(' • '));
				},
			);
		});
	}

	ngOnDestroy(): void {
		if (this.drop.handler === this.onDrop) this.drop.handler = null;
	}

	private go(ok: boolean): void {
		if (ok) void this.router.navigateByUrl('/editor');
	}

	protected async newProject(file?: PickedFile): Promise<void> {
		this.go(await this.files.newFromVideo(file));
	}

	protected async openProject(file?: PickedFile): Promise<void> {
		this.go(await this.files.open(file));
	}

	protected async recover(entry: RecoveryEntry): Promise<void> {
		this.go(await this.recovery.recover(entry));
	}

	protected async discardRecovered(entry: RecoveryEntry): Promise<void> {
		const ok = await confirmAction(
			`Discard the unsaved changes to ${entry.name}? This can't be undone.`,
			'Discard changes',
			'Discard',
		);
		if (ok) await this.recovery.dismiss(entry);
	}

	protected async openRecent(r: RecentProject): Promise<void> {
		this.go(await this.files.openRecent(r));
	}

	/** New project with the captions as its first track. */
	protected async importCaptions(file?: PickedFile | null): Promise<void> {
		this.go(await this.files.importAsNewProject(file));
	}

	private async openDropped(file: PickedFile): Promise<void> {
		switch (dropKind(file.name)) {
			case 'video':
				return this.newProject(file);
			case 'project':
				return this.openProject(file);
			case 'captions':
				return this.importCaptions(file);
			default:
				this.files.error.set(
					`${file.name} isn't a video, project or caption file ByteCaptions can open.`,
				);
		}
	}

	protected openSettings(): void {
		this.dialogs.open(SettingsDialog);
	}

	protected openShortcuts(): void {
		this.dialogs.open(ShortcutsDialog);
	}

	protected openWebsite(e: Event): void {
		e.preventDefault();
		openExternal(this.website);
	}

	protected onKey(e: KeyboardEvent): void {
		if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
		const run = {
			n: () => this.newProject(),
			o: () => this.openProject(),
			i: () => this.importCaptions(),
			',': () => this.openSettings(),
		}[e.key.toLowerCase()];
		if (!run) return;
		e.preventDefault();
		void run();
	}
}
