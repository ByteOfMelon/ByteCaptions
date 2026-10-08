import { Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Text button. Put a leading Lucide icon before the label as content:
 * `<button bcButton variant="primary"><svg lucidePlus></svg> New preset</button>`.
 * Set `progress` (0–100) for the progress state, e.g. "Transcribing… 4%".
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
 * Square 36×36 icon-only button. Always give it an aria-label.
 * Bind `[pressed]` for on/off tools (snapping, karaoke); "on" uses the selected fill.
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
