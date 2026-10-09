import { Component, inject } from '@angular/core';
import { Transcription } from '../../state/transcription';
import { Dialog } from '../../ui/dialog/dialog';
import { Kbd } from '../../ui/kbd/kbd';

interface Shortcut {
	label: string;
	/** Keys joined with `+`, as `bc-kbd` takes them. */
	keys: string;
}

interface ShortcutGroup {
	name: string;
	shortcuts: Shortcut[];
}

/** The editor's shortcuts (see Editor.onKey), labelled as the command palette labels them. */
@Component({
	selector: 'bc-shortcuts-dialog',
	imports: [Dialog, Kbd],
	templateUrl: './shortcuts-dialog.html',
	styleUrl: './shortcuts-dialog.css',
})
export class ShortcutsDialog {
	private readonly transcription = inject(Transcription);

	protected readonly columns: ShortcutGroup[][] = [
		[
			{
				name: 'Playback',
				shortcuts: [
					{ label: 'Play or pause', keys: 'Space' },
					{ label: 'Shuttle back, pause, forward', keys: 'J+K+L' },
					{ label: 'Step one frame', keys: '←+→' },
					{ label: 'Step one second', keys: 'Shift+←+→' },
					{ label: 'Previous or next cue', keys: '↑+↓' },
					{ label: 'Mark in or out', keys: 'I+O' },
					{ label: 'Go to in or out', keys: 'Shift+I+O' },
					{ label: 'Clear in and out', keys: 'Alt+X' },
					{ label: 'Loop playback on or off', keys: 'Ctrl+L' },
				],
			},
			{
				name: 'Editing',
				shortcuts: [
					{ label: 'New cue at playhead', keys: 'Enter' },
					{ label: 'Split at playhead', keys: 'S' },
					{ label: 'Merge with next cue', keys: 'M' },
					{ label: 'Set start to playhead', keys: '[' },
					{ label: 'Set end to playhead', keys: ']' },
					{ label: 'Nudge one frame', keys: 'Alt+←+→' },
					{ label: 'Duplicate', keys: 'Ctrl+D' },
					{ label: 'Delete', keys: 'Del' },
					{ label: 'Ripple delete', keys: 'Shift+Del' },
					{ label: 'Select all on track', keys: 'Ctrl+A' },
					{ label: 'Rename track', keys: 'F2' },
					{ label: 'Undo', keys: 'Ctrl+Z' },
					{ label: 'Redo', keys: 'Ctrl+Shift+Z' },
				],
			},
		],
		[
			{
				name: 'Timeline',
				shortcuts: [
					{ label: 'Zoom in', keys: 'Ctrl+=' },
					{ label: 'Zoom out', keys: 'Ctrl+-' },
					{ label: 'Zoom to fit', keys: 'Ctrl+0' },
					{ label: 'Draw a new cue', keys: 'Alt+Drag' },
					{ label: 'Move the in/out range', keys: 'Alt+Drag ruler' },
					{ label: 'Snapping on or off', keys: 'N' },
					{ label: 'Clear selection', keys: 'Esc' },
				],
			},
			{
				name: 'File and app',
				shortcuts: [
					{ label: 'Command palette', keys: 'Ctrl+K' },
					{ label: 'Go to timecode', keys: 'Ctrl+G' },
					{ label: 'Find and replace', keys: 'Ctrl+H' },
					{ label: 'Next problem', keys: 'F8' },
					{ label: 'Previous problem', keys: 'Shift+F8' },
					{ label: 'New project from video', keys: 'Ctrl+N' },
					{ label: 'Save', keys: 'Ctrl+S' },
					{ label: 'Save as', keys: 'Ctrl+Shift+S' },
					{ label: 'Open project', keys: 'Ctrl+O' },
					{ label: 'Import captions', keys: 'Ctrl+I' },
					{ label: 'Export', keys: 'Ctrl+E' },
					// Transcription isn't in every build (e.g. the web).
					...(this.transcription.available
						? [{ label: 'Auto-transcribe', keys: 'Ctrl+T' }]
						: []),
					{ label: 'Settings', keys: 'Ctrl+,' },
					{ label: 'Keyboard shortcuts', keys: '?' },
				],
			},
		],
	];
}
