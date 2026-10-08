import { Component, input } from '@angular/core';
import { LucideCircleAlert, LucideInfo } from '@lucide/angular';

/**
 * Outlined inline message: icon, bold title, faded detail, optional trailing action
 * (`<button noticeAction>`).
 */
@Component({
	selector: 'bc-notice',
	imports: [LucideInfo, LucideCircleAlert],
	template: `
		@if (tone() === 'info') {
			<svg lucideInfo></svg>
		} @else {
			<svg lucideCircleAlert></svg>
		}
		<div class="text">
			<span class="text-body-bold">{{ heading() }}</span>
			@if (detail()) {
				<span class="text-small text-faded">{{ detail() }}</span>
			}
		</div>
		<ng-content select="[noticeAction]" />
	`,
	styles: `
		:host {
			display: flex;
			align-items: center;
			gap: var(--spacing-md);
			padding: var(--spacing-md);
			border-radius: var(--radius-control);
			background: var(--color-bg);
			box-shadow: inset 0 0 0 var(--outline-width) var(--tone);
		}
		:host(.info) {
			--tone: var(--color-info);
		}
		:host(.warning) {
			--tone: var(--color-warning);
		}
		:host(.danger) {
			--tone: var(--color-danger);
		}
		svg.lucide {
			flex-shrink: 0;
			width: 20px;
			height: 20px;
			color: var(--tone);
		}
		.text {
			display: flex;
			flex: 1;
			flex-direction: column;
			gap: var(--spacing-xs);
			min-width: 0;
		}
	`,
	host: { role: 'status', '[class]': 'tone()' },
})
export class Notice {
	readonly tone = input<'info' | 'warning' | 'danger'>('info');
	readonly heading = input.required<string>();
	readonly detail = input<string>();
}
