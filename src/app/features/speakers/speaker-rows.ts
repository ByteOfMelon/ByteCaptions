import { Component, computed, inject, input } from '@angular/core';
import { LucideVolume2 } from '@lucide/angular';
import { updateTrack } from '../../core/commands/edits';
import { ProjectStore } from '../../state/project-store';
import { SpeakerResult } from '../../state/speaker-separation';
import { Button } from '../../ui/button/button';
import { Field } from '../../ui/field/field';
import { Playback } from '../player/playback';

/**
 * The speakers a separation found, one row per new track
 */
@Component({
	selector: 'bc-speaker-rows',
	imports: [Button, Field, LucideVolume2],
	template: `
		@for (row of rows(); track row.trackId) {
			<div class="row">
				<span class="color" [style.background]="row.color"></span>
				<bc-field #f class="name">
					<input
						[id]="f.fieldId"
						[attr.aria-label]="'Name of ' + row.name"
						[value]="row.name"
						(change)="rename(row.trackId, $any($event.target).value)"
						(keydown.enter)="$any($event.target).blur()"
					/>
				</bc-field>
				<span class="text-small text-faded count">{{ row.detail }}</span>
				<button bcButton variant="ghost" (click)="listen(row.sample)">
					<svg lucideVolume2 class="icon"></svg>
					Listen
				</button>
			</div>
		}
	`,
	styles: `
		:host {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-sm);
		}
		.row {
			display: flex;
			align-items: center;
			gap: var(--spacing-sm);
		}
		.color {
			flex-shrink: 0;
			width: 4px;
			height: 28px;
			border-radius: var(--radius-small);
		}
		.name {
			flex: 1;
			min-width: 0;
		}
		.count {
			flex: 0 0 104px;
			text-align: right;
			white-space: nowrap;
		}
		.icon {
			width: 16px;
			height: 16px;
		}
	`,
})
export class SpeakerRows {
	private readonly store = inject(ProjectStore);
	private readonly playback = inject(Playback);
	readonly result = input.required<SpeakerResult>();

	protected readonly rows = computed(() =>
		this.result().rows.flatMap((r) => {
			const t = this.store.track(r.trackId);

			if (!t) return [];

			const min = Math.round(r.talkMs / 60_000);
			const talk = min ? `${min} min` : `${Math.round(r.talkMs / 1000)} s`;

			return [
				{
					...r,
					name: t.name,
					color: t.color,
					detail: `${r.cues} ${r.cues === 1 ? 'cue' : 'cues'} • ${talk}`,
				},
			];
		}),
	);

	protected rename(trackId: string, name: string): void {
		name = name.trim();
		const t = this.store.track(trackId);

		if (!t || !name || name === t.name) return;

		this.store.apply('Rename track', updateTrack(trackId, { name }));
	}

	protected listen(cueId: string): void {
		const cue = this.store.find(cueId)?.cue;

		if (cue) this.playback.playSpan(cue.start, cue.end);
	}
}
