import { Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Regular text button
 */
@Component({
	selector: 'button[bcButton], a[bcButton]',
	template: `
		@if (progress() !== null) {
			<span class="progress" [style.width.%]="progress()"></span>
		}
		<span class="content"><ng-content /></span>
	`,
	styleUrl: './button.css',
	host: {
		'[class]': '"bc-button " + variant()',
		'[class.in-progress]': 'progress() !== null',
		'[attr.aria-busy]': 'progress() !== null || null',
	},
})
export class Button {
	readonly variant = input<ButtonVariant>('secondary');
	readonly progress = input<number | null>(null);
}

/**
 * Square icon-only button
 */
@Component({
	selector: 'button[bcIconButton]',
	template: `<ng-content />`,
	styleUrl: './button.css',
	host: {
		'[class]': '"bc-button icon " + variant()',
		'[class.on]': 'pressed()',
		'[attr.aria-pressed]': 'pressed() ?? null',
	},
})
export class IconButton {
	readonly variant = input<ButtonVariant>('secondary');
	readonly pressed = input<boolean | undefined>(undefined);
}
