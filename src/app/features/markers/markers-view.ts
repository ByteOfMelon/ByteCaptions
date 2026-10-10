import { Component, computed, inject, signal } from '@angular/core';
import { LucideSearch } from '@lucide/angular';
import { MARKER_COLORS } from '../../core/model/defaults';
import { formatClock, formatTimecode } from '../../core/time/timecode';
import { EditorUi } from '../../state/editor-ui';
import { ProjectStore } from '../../state/project-store';
import { CountPipe } from '../../ui/count/count';
import { Field } from '../../ui/field/field';
import { Markers } from './markers';

/** Markers tab, shows every marker in time order */
@Component({
	selector: 'bc-markers-view',
	imports: [CountPipe, Field, LucideSearch],
	templateUrl: './markers-view.html',
	styleUrl: './markers-view.css',
})
export class MarkersView {
	private readonly store = inject(ProjectStore);
	private readonly ui = inject(EditorUi);
	protected readonly markers = inject(Markers);
	protected readonly query = signal('');

	protected readonly rows = computed(() => {
		const q = this.query().trim().toLowerCase();
		const fps = this.store.project().fps;
		const ms = this.ui.timeUnits() === 'ms';

		return this.markers
			.list()
			.map((m, i) => ({
				marker: m,
				number: i + 1,
				time: ms ? formatClock(m.at) : formatTimecode(m.at, fps),
				color: MARKER_COLORS[m.color],
			}))
			.filter((r) => !q || r.marker.note.toLowerCase().includes(q));
	});
}
