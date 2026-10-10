import { Component, computed, inject, input, model } from '@angular/core';
import { TrackId } from '../../core/model/types';
import { ProjectStore } from '../../state/project-store';
import { Checkbox } from '../../ui/controls/controls';
import { CountPipe } from '../../ui/count/count';

let nextId = 0;

/** The "Tracks" checklist the Export and YouTube dialogs combine into one file. */
@Component({
	selector: 'bc-track-checklist',
	imports: [Checkbox, CountPipe],
	template: `
		<span class="text-small" [id]="labelId">Tracks</span>
		<div class="tracks" role="group" [attr.aria-labelledby]="labelId">
			@for (t of tracks(); track t.id) {
				<label class="track">
					<bc-checkbox
						[checked]="selected().has(t.id)"
						(checkedChange)="toggle(t.id, $event)"
					/>
					<span class="color" [style.background]="t.color"></span>
					<span class="name">{{ t.name }}</span>
					<span class="text-mono-small text-faded">{{
						t.cues.length | count: 'cue'
					}}</span>
				</label>
			}
		</div>
		<span class="text-small text-faded">{{ hint() }}</span>
	`,
	styles: `
		:host {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-sm);
		}
		.tracks {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-xs);
			padding: var(--spacing-xs);
			border-radius: var(--radius-control);
			background: var(--color-bg);
		}
		.track {
			display: flex;
			align-items: center;
			gap: var(--spacing-sm);
			height: 36px;
			padding: 0 var(--spacing-sm);
			border-radius: var(--radius-small);
			cursor: pointer;
		}
		.track:hover {
			background: var(--color-card);
		}
		.color {
			flex-shrink: 0;
			width: 4px;
			height: 20px;
			border-radius: var(--radius-small);
		}
		.name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	`,
})
export class TrackChecklist {
	private readonly store = inject(ProjectStore);
	protected readonly tracks = computed(() => this.store.project().tracks);
	readonly selected = model.required<ReadonlySet<TrackId>>();
	/** What happens to the selected tracks. */
	readonly hint = input.required<string>();
	protected readonly labelId = `track-checklist-${nextId++}`;

	protected toggle(id: TrackId, on: boolean): void {
		const next = new Set(this.selected());

		if (on) next.add(id);
		else next.delete(id);

		this.selected.set(next);
	}
}
