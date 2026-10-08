import { Component, computed, input } from '@angular/core';

/** Shortcut keys, e.g. `<bc-kbd keys="Ctrl+Shift+Z" />`. Each key renders as its own cap. */
@Component({
	selector: 'bc-kbd',
	template: `@for (k of parts(); track $index) {
		<kbd>{{ k }}</kbd>
	}`,
	styles: `
		:host {
			display: inline-flex;
			gap: var(--spacing-xs);
			flex-shrink: 0;
		}
		kbd {
			padding: 2px 6px;
			border-radius: var(--radius-small);
			background: var(--color-panel);
			box-shadow: inset 0 0 0 var(--outline-width) var(--color-outline);
			color: var(--color-text);
			font: 400 12px / var(--line-height) var(--font-mono);
		}
	`,
})
export class Kbd {
	readonly keys = input.required<string>();
	protected readonly parts = computed(() =>
		this.keys()
			.split('+')
			.map((k) => k.trim()),
	);
}
