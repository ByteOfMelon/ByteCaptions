import { Injectable, inject } from '@angular/core';
import { Dialogs } from '../../ui/dialog/dialog';
import { Transcription } from '../../state/transcription';
import { CueId, StyleId, TrackId } from '../../core/model/types';
import { ExportDialog } from '../export/export-dialog';
import { StylePresetsDialog } from '../presets/style-presets-dialog';
import { ShiftTimingDialog } from '../timeline/shift-timing-dialog';
import { TranscribeDialog } from '../transcribe/transcribe-dialog';
import { EditorCommands } from './editor-commands';

/** Opens the editor's modal dialogs; one place so toolbar, palette and shortcuts agree. */
@Injectable({ providedIn: 'root' })
export class EditorDialogs {
	private readonly dialogs = inject(Dialogs);
	private readonly commands = inject(EditorCommands);
	private readonly transcription = inject(Transcription);

	export(trackIds?: TrackId[]): void {
		this.dialogs.open(ExportDialog, { inputs: trackIds ? { trackIds } : {} });
	}

	async shiftTiming(ids: CueId[]): Promise<void> {
		const ref = this.dialogs.open<ShiftTimingDialog, number>(ShiftTimingDialog, {
			inputs: { count: ids.length },
		});
		const ms = await ref.closed;
		if (typeof ms === 'number') this.commands.shiftTiming(ids, ms);
	}

	transcribe(): void {
		if (this.transcription.available) this.dialogs.open(TranscribeDialog);
	}

	presets(initialStyleId?: StyleId): void {
		this.dialogs.open(StylePresetsDialog, { inputs: initialStyleId ? { initialStyleId } : {} });
	}
}
