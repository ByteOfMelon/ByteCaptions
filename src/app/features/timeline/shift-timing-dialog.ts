import { Component, computed, inject, input, signal } from '@angular/core';
import { Button } from '../../ui/button/button';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Field } from '../../ui/field/field';

/** Asks for a timing offset in seconds; closes with the offset in ms, or nothing on cancel. */
@Component({
	selector: 'bc-shift-timing-dialog',
	imports: [Dialog, Button, Field],
	template: `
		<bc-dialog heading="Shift timing" [subtitle]="subtitle()" [width]="400">
			<bc-field
				label="Offset in seconds"
				helper="Negative values move cues earlier."
				[error]="error()"
				mono
				#f
			>
				<input
					[id]="f.fieldId"
					inputmode="decimal"
					bcAutofocus
					(focus)="$any($event.target).select()"
					[value]="text()"
					(input)="text.set($any($event.target).value)"
					(keydown.enter)="apply()"
				/>
			</bc-field>
			<div dialogFooter>
				<button bcButton (click)="ref.close()">Cancel</button>
				<button bcButton variant="primary" [disabled]="!!error()" (click)="apply()">
					Shift
				</button>
			</div>
		</bc-dialog>
	`,
})
export class ShiftTimingDialog {
	protected readonly ref = inject<DialogRef<number>>(DialogRef);
	readonly count = input(1);

	protected readonly text = signal('+0.50');
	private readonly seconds = computed(() => Number(this.text().trim().replace(',', '.')));
	protected readonly error = computed(() =>
		this.text().trim() && Number.isFinite(this.seconds()) ? null : 'Enter a number.',
	);
	protected readonly subtitle = computed(() =>
		this.count() === 1 ? '1 cue' : `${this.count()} cues`,
	);

	protected apply(): void {
		if (!this.error()) this.ref.close(Math.round(this.seconds() * 1000));
	}
}
