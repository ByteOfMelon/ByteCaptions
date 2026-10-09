import { Injectable, signal } from '@angular/core';
import { TrackId } from '../core/model/types';

export type SideTab = 'cues' | 'transcript' | 'problems' | 'markers';
export type TimelineZoom = 'in' | 'out' | 'fit';

/** Editor view state shared between panels and dialogs (not part of the document). */
@Injectable({ providedIn: 'root' })
export class EditorUi {
	readonly sideTab = signal<SideTab>('cues');
	/** Track whose header name is being edited inline. */
	readonly renamingTrack = signal<TrackId | null>(null);
	/** Cue list shows its "Replace with" row (Ctrl+H). */
	readonly replaceOpen = signal(false);
	/** Timeline times as timecode frames (HH:MM:SS:FF) or milliseconds (HH:MM:SS.mmm). */
	readonly timeUnits = signal<'frames' | 'ms'>('frames');
	/** Timeline snapping (N). */
	readonly snapping = signal(true);
	/** Zooms the timeline (Ctrl+= / Ctrl+- / Ctrl+0); set by the timeline while it's showing. */
	zoomTimeline: ((step: TimelineZoom) => void) | null = null;

	openReplace(): void {
		this.sideTab.set('cues');
		this.replaceOpen.set(true);
	}
}
