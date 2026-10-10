import { Injectable, computed, inject } from '@angular/core';
import {
	LucideArrowDown,
	LucideArrowLeftToLine,
	LucideArrowRightToLine,
	LucideArrowUp,
	LucideBookmark,
	LucideBookmarkPlus,
	LucideChevronFirst,
	LucideChevronLast,
	LucideCloudUpload,
	LucideRepeat,
	LucideX,
	LucideClipboardPaste,
	LucideClock,
	LucideCopy,
	LucideDelete,
	LucideFileInput,
	LucideFolderOpen,
	LucideFoldHorizontal,
	LucideMagnet,
	LucideMerge,
	LucideMonitor,
	LucideMove,
	LucideSquareDashedMousePointer,
	LucideMoon,
	LucideSun,
	LucideTriangleAlert,
	LucideType,
	LucideCaptions,
	LucidePalette,
	LucidePause,
	LucidePlay,
	LucidePlus,
	LucideRedo2,
	LucideReplace,
	LucideSave,
	LucideScissors,
	LucideKeyboard,
	LucideSettings,
	LucideSlidersHorizontal,
	LucidePanelsTopLeft,
	LucideTimer,
	LucideTrash2,
	LucideUndo2,
	LucideUpload,
	type LucideIconData,
} from '@lucide/angular';
import { EditorUi } from '../../state/editor-ui';
import { isDesktop } from '../../state/file-io';
import { ProjectFiles } from '../../state/project-files';
import { ProjectStore } from '../../state/project-store';
import { ThemePreference, ThemeService } from '../../theme/theme.service';
import { EditorCommands } from './editor-commands';
import { EditorDialogs } from './editor-dialogs';
import { Playback } from '../player/playback';
import { Markers } from '../markers/markers';
import { PanelLayout } from '../../state/panel-layout';
import { confirmResetLayout } from '../settings/settings-dialog';
import { YouTube } from '../../state/youtube';

export interface Command {
	id: string;
	label: string;
	icon: LucideIconData;
	keys?: string;
	/** Commands about the selected cue are listed under "For cue N" */
	scope?: 'cue';
	/** Opens the timecode prompt in the palette instead of running */
	prompt?: 'timecode';
	enabled?: () => boolean;
	run: () => void;
}

const THEMES: { id: ThemePreference; label: string; icon: LucideIconData }[] = [
	{ id: 'system', label: 'Match system', icon: LucideMonitor.icon },
	{ id: 'light', label: 'Light', icon: LucideSun.icon },
	{ id: 'dark', label: 'Dark', icon: LucideMoon.icon },
];

/**
 * Every command the palette and menu bar can run
 */
@Injectable({ providedIn: 'root' })
export class CommandRegistry {
	private readonly store = inject(ProjectStore);
	private readonly cmd = inject(EditorCommands);
	private readonly dialogs = inject(EditorDialogs);
	private readonly files = inject(ProjectFiles);
	private readonly ui = inject(EditorUi);
	private readonly theme = inject(ThemeService);
	private readonly layout = inject(PanelLayout);
	private readonly playback = inject(Playback);
	private readonly markers = inject(Markers);
	private readonly youtube = inject(YouTube);

	readonly all = computed<Command[]>(() => {
		const hasCue = () => !!this.store.primary();
		const playing = this.store.playing();
		const hasRange = () => !!this.playback.range();
		return [
			{
				id: 'split',
				label: 'Split cue at playhead',
				icon: LucideScissors.icon,
				keys: 'S',
				scope: 'cue',
				run: () => this.cmd.splitAtPlayhead(),
			},
			{
				id: 'words-spread',
				label: 'Word timing: Spread evenly',
				icon: LucideTimer.icon,
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.spreadWords(),
			},
			{
				id: 'words-tap',
				label: 'Word timing: Tap to time',
				icon: LucideTimer.icon,
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.tapToTime(),
			},
			{
				id: 'words-clear',
				label: 'Word timing: Clear',
				icon: LucideX.icon,
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.clearWords(),
			},
			{
				id: 'merge',
				label: 'Merge with next cue',
				icon: LucideMerge.icon,
				keys: 'M',
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.merge(),
			},
			{
				id: 'preset',
				label: 'Change style preset…',
				icon: LucideType.icon,
				scope: 'cue',
				enabled: hasCue,
				run: () => this.dialogs.presets(),
			},
			{
				id: 'set-start',
				label: 'Set start to playhead',
				icon: LucideTimer.icon,
				keys: '[',
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.setStartToPlayhead(),
			},
			{
				id: 'set-end',
				label: 'Set end to playhead',
				icon: LucideTimer.icon,
				keys: ']',
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.setEndToPlayhead(),
			},
			{
				id: 'delete',
				label: 'Delete cue',
				icon: LucideTrash2.icon,
				keys: 'Del',
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.deleteSelected(),
			},
			{
				id: 'cut',
				label: 'Cut cue',
				icon: LucideScissors.icon,
				keys: 'Ctrl+X',
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.cut(),
			},
			{
				id: 'copy',
				label: 'Copy cue',
				icon: LucideCopy.icon,
				keys: 'Ctrl+C',
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.copy(),
			},
			{
				id: 'paste',
				label: 'Paste at playhead',
				icon: LucideClipboardPaste.icon,
				keys: 'Ctrl+V',
				enabled: () => this.cmd.canPaste,
				run: () => this.cmd.paste(),
			},
			{
				id: 'ripple-delete',
				label: 'Ripple delete cue',
				icon: LucideDelete.icon,
				keys: 'Shift+Del',
				scope: 'cue',
				enabled: hasCue,
				run: () => this.cmd.rippleDeleteSelected(),
			},
			{
				id: 'goto',
				label: 'Go to timecode…',
				icon: LucideClock.icon,
				keys: 'Ctrl+G',
				prompt: 'timecode',
				run: () => {},
			},
			{
				id: 'replace',
				label: 'Find and replace…',
				icon: LucideReplace.icon,
				keys: 'Ctrl+H',
				run: () => this.ui.openReplace(),
			},
			{
				id: 'next-problem',
				label: 'Go to next problem',
				icon: LucideArrowDown.icon,
				keys: 'F8',
				run: () => this.cmd.goToProblem(1),
			},
			{
				id: 'prev-problem',
				label: 'Go to previous problem',
				icon: LucideArrowUp.icon,
				keys: 'Shift+F8',
				run: () => this.cmd.goToProblem(-1),
			},
			{
				id: 'play',
				label: playing ? 'Pause' : 'Play',
				icon: playing ? LucidePause.icon : LucidePlay.icon,
				keys: 'Space',
				run: () => this.cmd.togglePlay(),
			},
			{
				id: 'loop',
				label: this.playback.loop() ? 'Turn loop playback off' : 'Turn loop playback on',
				icon: LucideRepeat.icon,
				keys: 'Ctrl+L',
				run: () => this.playback.loop.update((on) => !on),
			},
			{
				id: 'mark-in',
				label: 'Mark in',
				icon: LucideArrowRightToLine.icon,
				keys: 'I',
				run: () => this.playback.setIn(),
			},
			{
				id: 'mark-out',
				label: 'Mark out',
				icon: LucideArrowLeftToLine.icon,
				keys: 'O',
				run: () => this.playback.setOut(),
			},
			{
				id: 'go-in',
				label: 'Go to in',
				icon: LucideChevronFirst.icon,
				keys: 'Shift+I',
				enabled: hasRange,
				run: () => this.playback.goTo('in'),
			},
			{
				id: 'go-out',
				label: 'Go to out',
				icon: LucideChevronLast.icon,
				keys: 'Shift+O',
				enabled: hasRange,
				run: () => this.playback.goTo('out'),
			},
			{
				id: 'select-range',
				label: 'Select cues in range',
				icon: LucideSquareDashedMousePointer.icon,
				enabled: hasRange,
				run: () => this.cmd.selectRange(),
			},
			{
				id: 'shift-range',
				label: 'Shift cues in range…',
				icon: LucideMove.icon,
				enabled: () => this.cmd.rangeCues().length > 0,
				run: () => void this.dialogs.shiftTiming(this.cmd.rangeCues().map((r) => r.cue.id)),
			},
			{
				id: 'delete-range',
				label: 'Delete cues in range',
				icon: LucideTrash2.icon,
				enabled: () => this.cmd.rangeCues().length > 0,
				run: () => this.cmd.deleteRange(false),
			},
			{
				id: 'ripple-range',
				label: 'Ripple delete range',
				icon: LucideDelete.icon,
				enabled: hasRange,
				run: () => this.cmd.deleteRange(true),
			},
			{
				id: 'clear-range',
				label: 'Clear in and out',
				icon: LucideX.icon,
				keys: 'Alt+X',
				enabled: hasRange,
				run: () => this.playback.clearRange(),
			},
			{
				id: 'add-marker',
				label: 'Add marker',
				icon: LucideBookmarkPlus.icon,
				keys: 'Shift+M',
				run: () => this.markers.addAtPlayhead(),
			},
			{
				id: 'next-marker',
				label: 'Go to next marker',
				icon: LucideBookmark.icon,
				enabled: () => this.markers.list().length > 0,
				run: () => this.markers.goTo(1),
			},
			{
				id: 'prev-marker',
				label: 'Go to previous marker',
				icon: LucideBookmark.icon,
				enabled: () => this.markers.list().length > 0,
				run: () => this.markers.goTo(-1),
			},
			{
				id: 'show-markers',
				label: 'Show markers',
				icon: LucideBookmark.icon,
				run: () => this.markers.showTab(),
			},
			{
				id: 'snapping',
				label: this.ui.snapping() ? 'Turn snapping off' : 'Turn snapping on',
				icon: LucideMagnet.icon,
				keys: 'N',
				run: () => this.ui.snapping.update((on) => !on),
			},
			{
				id: 'time-units',
				label:
					this.ui.timeUnits() === 'ms'
						? 'Show timeline times in frames'
						: 'Show timeline times in milliseconds',
				icon: LucideClock.icon,
				run: () => this.ui.timeUnits.update((u) => (u === 'ms' ? 'frames' : 'ms')),
			},
			{
				id: 'zoom-fit',
				label: 'Zoom timeline to fit',
				icon: LucideFoldHorizontal.icon,
				keys: 'Ctrl+0',
				run: () => this.ui.zoomTimeline?.('fit'),
			},
			{
				id: 'new-track',
				label: 'New track',
				icon: LucidePlus.icon,
				run: () =>
					this.ui.renamingTrack.set(this.cmd.newTrack(this.store.primary()?.track.id)),
			},
			{
				id: 'undo',
				label: 'Undo',
				icon: LucideUndo2.icon,
				keys: 'Ctrl+Z',
				enabled: () => this.store.canUndo(),
				run: () => this.cmd.undo(),
			},
			{
				id: 'redo',
				label: 'Redo',
				icon: LucideRedo2.icon,
				keys: 'Ctrl+Shift+Z',
				enabled: () => this.store.canRedo(),
				run: () => this.cmd.redo(),
			},
			// Desktop only: transcription runs Whisper locally.
			...(isDesktop
				? [
						{
							id: 'transcribe',
							label: 'Auto-transcribe…',
							icon: LucideCaptions.icon,
							keys: 'Ctrl+T',
							run: () => this.dialogs.transcribe(),
						},
					]
				: []),
			{
				id: 'export',
				label: 'Export…',
				icon: LucideUpload.icon,
				keys: 'Ctrl+E',
				run: () => this.dialogs.export(),
			},
			// Only in builds with a Google sign-in client (see BUILDING.md); never in the browser.
			...(this.youtube.available()
				? [
						{
							id: 'youtube',
							label: 'Upload to YouTube…',
							icon: LucideCloudUpload.icon,
							run: () => this.dialogs.youtube(),
						},
					]
				: []),
			{
				id: 'presets',
				label: 'Edit style presets…',
				icon: LucidePalette.icon,
				run: () => this.dialogs.presets(),
			},
			{
				id: 'project-settings',
				label: 'Project settings…',
				icon: LucideSettings.icon,
				run: () => this.dialogs.projectSettings(),
			},
			{
				id: 'settings',
				label: 'Settings…',
				icon: LucideSlidersHorizontal.icon,
				keys: 'Ctrl+,',
				run: () => this.dialogs.settings(),
			},
			{
				id: 'reset-layout',
				label: 'Reset layout…',
				icon: LucidePanelsTopLeft.icon,
				run: () => void confirmResetLayout().then((ok) => ok && this.layout.reset()),
			},
			{
				id: 'shortcuts',
				label: 'Keyboard shortcuts…',
				icon: LucideKeyboard.icon,
				keys: '?',
				run: () => this.dialogs.shortcuts(),
			},
			{
				id: 'save',
				label: 'Save project',
				icon: LucideSave.icon,
				keys: 'Ctrl+S',
				run: () => void this.files.save(),
			},
			{
				id: 'save-as',
				label: 'Save project as…',
				icon: LucideSave.icon,
				keys: 'Ctrl+Shift+S',
				run: () => void this.files.save(true),
			},
			{
				id: 'open',
				label: 'Open project…',
				icon: LucideFolderOpen.icon,
				keys: 'Ctrl+O',
				run: () => void this.files.open(),
			},
			{
				id: 'import',
				label: 'Import captions…',
				icon: LucideFileInput.icon,
				keys: 'Ctrl+I',
				run: () => void this.files.importCaptions(),
			},
			{
				id: 'tab-problems',
				label: 'Show problems',
				icon: LucideTriangleAlert.icon,
				run: () => this.ui.sideTab.set('problems'),
			},
			// The theme options other than the currently chosen one
			...THEMES.filter((t) => t.id !== this.theme.preference()).map((t) => ({
				id: `theme-${t.id}`,
				label: `Theme: ${t.label}`,
				icon: t.icon,
				run: () => this.theme.setPreference(t.id),
			})),
		];
	});

	get(id: string): Command | undefined {
		return this.all().find((c) => c.id === id);
	}
}
