import { Component, input, model } from '@angular/core';

export interface TabItem<T = string> {
	value: T;
	label: string;
	disabled?: boolean;
}

/** Segmented tab bar (Cues / Transcript / Problems). Arrow keys move between tabs. */
@Component({
	selector: 'bc-tabs',
	template: `
		@for (tab of tabs(); track tab.value; let i = $index) {
			<button
				type="button"
				role="tab"
				[id]="idPrefix() + '-tab-' + tab.value"
				[attr.aria-controls]="idPrefix() + '-panel-' + tab.value"
				[attr.aria-selected]="tab.value === value()"
				[tabindex]="tab.value === value() ? 0 : -1"
				[disabled]="tab.disabled"
				(click)="value.set(tab.value)"
				(keydown.arrowright)="move(i, 1, $event)"
				(keydown.arrowleft)="move(i, -1, $event)"
			>
				{{ tab.label }}
			</button>
		}
	`,
	styles: `
		:host {
			display: inline-flex;
			gap: var(--spacing-xs);
			padding: var(--spacing-xs);
			border-radius: var(--radius-control);
			background: var(--color-panel);
			box-shadow: inset 0 0 0 var(--outline-width) var(--color-outline);
		}
		button {
			height: 28px;
			padding: var(--spacing-xs) var(--spacing-md);
			border: none;
			border-radius: var(--radius-small);
			background: transparent;
			color: var(--color-text-faded);
			font: 500 16px / var(--line-height) var(--font-ui);
			white-space: nowrap;
			cursor: pointer;
		}
		button:hover:not(:disabled) {
			background: var(--color-card);
			color: var(--color-text);
		}
		button[aria-selected='true'] {
			background: var(--color-selected);
			color: var(--color-text);
			font-weight: 800;
		}
		/* Narrower tabs, so four fit in the cue list at its minimum width. */
		:host(.compact) button {
			padding-inline: var(--spacing-sm);
		}
		/* Inside a panel the bar sits one step darker, on the page background. */
		:host(.on-panel) {
			background: var(--color-bg);
		}
		button:disabled {
			opacity: 0.5;
			cursor: default;
		}
		button:focus-visible {
			outline: none;
			box-shadow: var(--focus-ring);
		}
	`,
	host: { role: 'tablist' },
})
export class Tabs<T = string> {
	readonly tabs = input.required<TabItem<T>[]>();
	readonly value = model.required<T>();
	readonly idPrefix = input('bc-tabs');

	protected move(i: number, dir: 1 | -1, e: Event): void {
		const tabs = this.tabs();

		for (let j = 1; j <= tabs.length; j++) {
			const next = tabs[(i + dir * j + tabs.length) % tabs.length];

			if (!next.disabled) {
				this.value.set(next.value);
				const host = (e.target as HTMLElement).parentElement;
				queueMicrotask(() =>
					host?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(),
				);

				return;
			}
		}
	}
}
