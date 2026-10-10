import { Component, computed, inject, input, output } from '@angular/core';
import { TrackId } from '../../core/model/types';
import { ProjectStore } from '../../state/project-store';
import { Button } from '../../ui/button/button';
import { Notice } from '../../ui/notice/notice';

/** Warns about errors and warnings in the tracks about to be exported or uploaded */
@Component({
	selector: 'bc-track-problems',
	imports: [Button, Notice],
	template: `
		@if (counts().errors + counts().warnings) {
			<bc-notice
				[tone]="counts().errors ? 'danger' : 'warning'"
				[heading]="title()"
				[detail]="detail()"
			>
				<button bcButton noticeAction variant="ghost" (click)="review.emit()">
					Review
				</button>
			</bc-notice>
		}
	`,
	styles: `
		:host {
			display: contents;
		}
	`,
})
export class TrackProblems {
	private readonly store = inject(ProjectStore);
	readonly tracks = input.required<ReadonlySet<TrackId>>();
	readonly detail = input.required<string>();
	readonly review = output();

	protected readonly counts = computed(() => {
		const ids = this.tracks();
		const list = this.store.problems().filter((p) => ids.has(p.trackId));

		return {
			errors: list.filter((p) => p.severity === 'error').length,
			warnings: list.filter((p) => p.severity !== 'error').length,
		};
	});
	protected readonly title = computed(() => {
		const { errors, warnings } = this.counts();
		const parts = [
			errors && `${errors} error${errors > 1 ? 's' : ''}`,
			warnings && `${warnings} warning${warnings > 1 ? 's' : ''}`,
		].filter(Boolean);

		return `${parts.join(' and ')} in these tracks`;
	});
}
