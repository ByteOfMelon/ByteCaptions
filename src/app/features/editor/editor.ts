import { Component, OnDestroy, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
	LucideCaptions,
	LucideCheck,
	LucideCircleAlert,
	LucideRedo2,
	LucideSearch,
	LucideUndo2,
} from '@lucide/angular';
import { ProjectStore } from '../../state/project-store';
import { Button, IconButton } from '../../ui/button/button';
import { Kbd } from '../../ui/kbd/kbd';
import { Tooltip } from '../../ui/tooltip/tooltip';
import { SidePanel } from '../cuelist/side-panel';
import { Inspector } from '../inspector/inspector';
import { Playback } from '../player/playback';
import { PreviewPanel } from '../player/preview-panel';
import { Timeline } from '../timeline/timeline';
import { Dialogs } from '../../ui/dialog/dialog';
import { EditorUi } from '../../state/editor-ui';
import { FileDrop, dropKind } from '../../state/file-drop';
import { PickedFile } from '../../state/file-io';
import { ProjectFiles } from '../../state/project-files';
import { Notice } from '../../ui/notice/notice';
import { Transcription } from '../../state/transcription';
import { CommandPalette } from '../palette/command-palette';
import { EditorCommands } from './editor-commands';
import { EditorDialogs } from './editor-dialogs';

/** Keys handled while focus is in a text field are limited to these. */
const FIELD_SAFE = new Set([
	'ctrl+z',
	'ctrl+shift+z',
	'ctrl+y',
	'ctrl+k',
	'ctrl+s',
	'ctrl+e',
	'ctrl+o',
	'ctrl+g',
]);

/** The main editor: toolbar, cue list / preview / inspector, and the timeline (PLAN §5). */
@Component({
	selector: 'bc-editor',
	imports: [
		RouterLink,
		Notice,
		Button,
		IconButton,
		Kbd,
		Tooltip,
		SidePanel,
		PreviewPanel,
		Inspector,
		Timeline,
		LucideCaptions,
		LucideUndo2,
		LucideRedo2,
		LucideSearch,
		LucideCheck,
		LucideCircleAlert,
	],
	templateUrl: './editor.html',
	styleUrl: './editor.css',
	host: { '(window:keydown)': 'onKey($event)' },
})
export class Editor implements OnDestroy {
	protected readonly store = inject(ProjectStore);
	protected readonly commands = inject(EditorCommands);
	protected readonly editorDialogs = inject(EditorDialogs);
	protected readonly transcription = inject(Transcription);
	protected readonly Math = Math;
	private readonly playback = inject(Playback);
	private readonly dialogs = inject(Dialogs);
	protected readonly files = inject(ProjectFiles);
	private readonly drop = inject(FileDrop);
	private readonly onDrop = (file: PickedFile) => void this.openDropped(file);
	private readonly ui = inject(EditorUi);

	protected readonly undoTip = computed(() =>
		this.store.undoLabel() ? `Undo ${this.store.undoLabel()}` : 'Undo',
	);
	protected readonly redoTip = computed(() =>
		this.store.redoLabel() ? `Redo ${this.store.redoLabel()}` : 'Redo',
	);

	constructor() {
		this.drop.handler = this.onDrop;
	}

	ngOnDestroy(): void {
		if (this.drop.handler === this.onDrop) this.drop.handler = null;
	}

	/** Video: becomes the preview. Captions: a new track. Project: replaces this one. */
	private async openDropped(file: PickedFile): Promise<void> {
		switch (dropKind(file.name)) {
			case 'video':
				return this.files.linkVideo(file);
			case 'captions':
				await this.files.importCaptions(file);
				return;
			case 'project':
				await this.files.open(file);
				return;
			default:
				this.files.error.set(
					`${file.name} isn't a video, project or caption file ByteCaptions can open.`,
				);
		}
	}

	protected openPalette(startMode: 'search' | 'timecode' = 'search'): void {
		if (!this.dialogs.isOpen)
			this.dialogs.open(CommandPalette, { placement: 'top', inputs: { startMode } });
	}

	protected onKey(e: KeyboardEvent): void {
		if (e.defaultPrevented || e.isComposing || this.dialogs.isOpen) return;
		const key = [
			e.ctrlKey || e.metaKey ? 'ctrl' : '',
			e.shiftKey ? 'shift' : '',
			e.altKey ? 'alt' : '',
			e.key.toLowerCase(),
		]
			.filter(Boolean)
			.join('+');
		const t = e.target as HTMLElement;
		const inField = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
		if (inField && !FIELD_SAFE.has(key)) return;
		// Let menus, listboxes and sliders keep their own arrow / space handling.
		const inWidget = !!t.closest(
			'[role="menu"], [role="listbox"], [role="tablist"], [role="radiogroup"], button, input[type="range"]',
		);

		const run = (fn: () => void) => {
			e.preventDefault();
			fn();
		};
		switch (key) {
			case 'ctrl+k':
				return run(() => this.openPalette());
			case 'ctrl+g':
				return run(() => this.openPalette('timecode'));
			case 'ctrl+e':
				return run(() => this.editorDialogs.export());
			case 'ctrl+t':
				return this.transcription.available
					? run(() => this.editorDialogs.transcribe())
					: undefined;
			case 'ctrl+s':
				return run(() => void this.files.save());
			case 'ctrl+o':
				return run(() => void this.files.open());
			case 'ctrl+i':
				return run(() => void this.files.importCaptions());
			case 'f8':
				return run(() => this.commands.goToProblem(1));
			case 'shift+f8':
				return run(() => this.commands.goToProblem(-1));
			case 'ctrl+z':
				return run(() => this.commands.undo());
			case 'ctrl+shift+z':
			case 'ctrl+y':
				return run(() => this.commands.redo());
			case ' ':
				if (!t.closest('button, [role="menu"], [role="listbox"]'))
					run(() => this.commands.togglePlay());
				return;
			case 'j':
				return run(() => this.playback.shuttleBy(-1));
			case 'k':
				return run(() => this.playback.pause());
			case 'l':
				return run(() => this.playback.shuttleBy(1));
			case 's':
			case 'ctrl+b':
				return run(() => this.commands.splitAtPlayhead());
			case 'm':
				return run(() => this.commands.merge());
			case '[':
				return run(() => this.commands.setStartToPlayhead());
			case ']':
				return run(() => this.commands.setEndToPlayhead());
			case 'delete':
			case 'backspace':
				return run(() => this.commands.deleteSelected());
			case 'shift+delete':
			case 'shift+backspace':
				return run(() => this.commands.rippleDeleteSelected());
			case 'n':
				return run(() => this.ui.snapping.update((on) => !on));
			case 'ctrl+=':
			case 'ctrl++':
			case 'ctrl+shift++':
				return run(() => this.ui.zoomTimeline?.('in'));
			case 'ctrl+-':
				return run(() => this.ui.zoomTimeline?.('out'));
			case 'ctrl+0':
				return run(() => this.ui.zoomTimeline?.('fit'));
			case 'escape':
				return run(() => this.store.clearSelection());
			case 'ctrl+c':
				if (!this.store.selection().size || getSelection()?.toString()) return;
				return run(() => this.commands.copy());
			case 'ctrl+x':
				if (!this.store.selection().size || getSelection()?.toString()) return;
				return run(() => this.commands.cut());
			case 'ctrl+v':
				return this.commands.canPaste ? run(() => this.commands.paste()) : undefined;
			case 'ctrl+d':
				return run(() => this.commands.duplicateSelected());
			case 'ctrl+a':
				return run(() => this.commands.selectAllOnTrack());
			case 'f2': {
				const track = this.store.primary()?.track ?? this.store.project().tracks[0];
				return track ? run(() => this.ui.renamingTrack.set(track.id)) : undefined;
			}
			case 'alt+arrowleft':
				return run(() => this.commands.nudge(-1));
			case 'alt+arrowright':
				return run(() => this.commands.nudge(1));
		}
		if (inWidget) return;
		switch (key) {
			case 'enter':
				return run(() => this.commands.newCueAt());
			case 'arrowleft':
				return run(() => this.playback.stepFrames(-1));
			case 'arrowright':
				return run(() => this.playback.stepFrames(1));
			case 'shift+arrowleft':
				return run(() => this.playback.stepSeconds(-1));
			case 'shift+arrowright':
				return run(() => this.playback.stepSeconds(1));
			case 'arrowup':
				return run(() => this.playback.jumpCue(-1));
			case 'arrowdown':
				return run(() => this.playback.jumpCue(1));
		}
	}
}
