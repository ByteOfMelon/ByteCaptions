import { Component, booleanAttribute, computed, input, model, signal } from '@angular/core';
import { LucideChevronsUpDown } from '@lucide/angular';

let nextId = 0;

/**
 * Labelled field shell. Project an `<input bcInput>` plus any trailing icon:
 * `<bc-field label="Save to"><input bcInput [value]="path" /><svg lucideFolder></svg></bc-field>`.
 * `error` turns the outline danger and replaces the helper text.
 */
@Component({
	selector: 'bc-field',
	template: `
		@if (label()) {
			<label class="label text-small" [attr.for]="fieldId">{{ label() }}</label>
		}
		<div class="box" [class.invalid]="!!error()" [class.mono]="mono()">
			<ng-content />
		</div>
		@if (error()) {
			<span class="helper error text-small" role="alert">{{ error() }}</span>
		} @else if (helper()) {
			<span class="helper text-small">{{ helper() }}</span>
		}
	`,
	styleUrl: './field.css',
	host: { '[class.disabled]': 'disabled()' },
})
export class Field {
	readonly label = input<string>();
	readonly helper = input<string>();
	readonly error = input<string | null>();
	readonly disabled = input(false, { transform: booleanAttribute });
	readonly mono = input(false, { transform: booleanAttribute });
	/** Give the projected input `[id]="field.fieldId"` so the label targets it. */
	readonly fieldId = `bc-field-${nextId++}`;
}

/**
 * Numeric field with a stepper and optional unit suffix ("%"). Typed values apply on Enter or blur.
 * Out-of-range or non-numeric text shows `rangeError` / "Enter a number."
 */
@Component({
	selector: 'bc-number-field',
	imports: [Field, LucideChevronsUpDown],
	template: `
		<bc-field #f [label]="label()" [error]="error()" [disabled]="disabled()">
			<input
				[id]="f.fieldId"
				inputmode="decimal"
				[value]="text()"
				[disabled]="disabled()"
				(input)="onInput($any($event.target).value)"
				(blur)="commit()"
				(keydown.enter)="commit()"
				(keydown.arrowup)="step(1, $event)"
				(keydown.arrowdown)="step(-1, $event)"
			/>
			@if (suffix()) {
				<span class="suffix">{{ suffix() }}</span>
			}
			<span class="stepper">
				<button
					type="button"
					tabindex="-1"
					aria-label="Increase"
					(click)="step(1)"
				></button>
				<button
					type="button"
					tabindex="-1"
					aria-label="Decrease"
					(click)="step(-1)"
				></button>
				<svg lucideChevronsUpDown aria-hidden="true"></svg>
			</span>
		</bc-field>
	`,
	styleUrl: './field.css',
})
export class NumberField {
	readonly label = input<string>();
	readonly value = model<number>(0);
	readonly min = input(-Infinity);
	readonly max = input(Infinity);
	readonly step$ = input(1, { alias: 'step' });
	readonly suffix = input<string>();
	readonly disabled = input(false, { transform: booleanAttribute });

	private readonly draft = signal<string | null>(null);
	protected readonly text = computed(() => this.draft() ?? String(this.value()));
	protected readonly error = computed(() => {
		const d = this.draft();
		if (d === null) return null;
		const n = Number(d);
		if (d.trim() === '' || Number.isNaN(n)) return 'Enter a number.';
		if (n < this.min() || n > this.max()) return `Must be ${this.min()}–${this.max()}.`;
		return null;
	});

	protected onInput(text: string): void {
		this.draft.set(text);
	}

	/** Typed values apply on Enter or blur, so typing "82" is one edit, not "8" then "82". */
	protected commit(): void {
		const d = this.draft();
		if (d === null || this.error()) return;
		this.draft.set(null);
		if (Number(d) !== this.value()) this.value.set(Number(d));
	}

	protected step(dir: 1 | -1, event?: Event): void {
		event?.preventDefault();
		const n = Math.min(this.max(), Math.max(this.min(), this.value() + dir * this.step$()));
		this.value.set(n);
		this.draft.set(null);
	}
}
