import { Component, booleanAttribute, computed, input, model } from '@angular/core';
import { LucideCheck } from '@lucide/angular';

/** Checkbox with its label as part of the clickable control. */
@Component({
	selector: 'bc-checkbox',
	imports: [LucideCheck],
	template: `
		<label class="control">
			<input
				type="checkbox"
				[checked]="checked()"
				[disabled]="disabled()"
				(change)="checked.set($any($event.target).checked)"
			/>
			<span class="box" aria-hidden="true">
				@if (checked()) {
					<svg lucideCheck></svg>
				}
			</span>
			<span class="text"><ng-content /></span>
		</label>
	`,
	styleUrl: './controls.css',
})
export class Checkbox {
	readonly checked = model(false);
	readonly disabled = input(false, { transform: booleanAttribute });
}

/** Radio option; give options in a group the same `name` and bind `group` to the selected value. */
@Component({
	selector: 'bc-radio',
	template: `
		<label class="control">
			<input
				type="radio"
				[name]="name()"
				[value]="value()"
				[checked]="group() === value()"
				[disabled]="disabled()"
				(change)="group.set(value())"
			/>
			<span class="box radio" aria-hidden="true"></span>
			<span class="text"><ng-content /></span>
		</label>
	`,
	styleUrl: './controls.css',
})
export class Radio<T = string> {
	readonly name = input.required<string>();
	readonly value = input.required<T>();
	readonly group = model<T>();
	readonly disabled = input(false, { transform: booleanAttribute });
}

@Component({
	selector: 'bc-toggle',
	template: `
		<label class="control">
			<input
				type="checkbox"
				role="switch"
				[checked]="checked()"
				[disabled]="disabled()"
				(change)="checked.set($any($event.target).checked)"
			/>
			<span class="track" aria-hidden="true"><span class="thumb"></span></span>
			<span class="text"><ng-content /></span>
		</label>
	`,
	styleUrl: './controls.css',
	host: { '[class.label-start]': 'labelStart()' },
})
export class Toggle {
	readonly checked = model(false);
	readonly disabled = input(false, { transform: booleanAttribute });
	/** Label on the left and the switch on the right, spanning the row (settings lists). */
	readonly labelStart = input(false, { transform: booleanAttribute });
}

/** Labelled range slider with the value readout on the right ("Background opacity  60%"). */
@Component({
	selector: 'bc-slider',
	template: `
		<label class="slider-header text-small">
			<span>{{ label() }}</span>
			<span class="text-mono-small">{{ display() }}</span>
		</label>
		<input
			type="range"
			[attr.aria-label]="label()"
			[min]="min()"
			[max]="max()"
			[step]="step()"
			[value]="value()"
			[disabled]="disabled()"
			[style.--fill.%]="percent()"
			(input)="value.set(+$any($event.target).value)"
		/>
	`,
	styleUrl: './controls.css',
	host: { class: 'slider' },
})
export class Slider {
	readonly label = input('');
	readonly value = model(0);
	readonly min = input(0);
	readonly max = input(100);
	readonly step = input(1);
	readonly unit = input('%');
	readonly disabled = input(false, { transform: booleanAttribute });
	protected readonly percent = computed(() => {
		const range = this.max() - this.min();
		return range ? ((this.value() - this.min()) / range) * 100 : 0;
	});
	protected readonly display = computed(() => `${this.value()}${this.unit()}`);
}

/** Hex color + opacity field. Clicking the swatch opens the OS color picker. */
@Component({
	selector: 'bc-color-field',
	template: `
		@if (label()) {
			<span class="label text-small">{{ label() }}</span>
		}
		<div class="color-box">
			<label class="pick">
				<span
					class="swatch"
					[style.background]="value()"
					[style.opacity]="opacity() / 100"
				></span>
				<input
					type="color"
					[attr.aria-label]="label()"
					[value]="value()"
					[disabled]="disabled()"
					(input)="value.set($any($event.target).value.toUpperCase())"
				/>
				<span class="hex">{{ value() }}</span>
			</label>
			@if (showOpacity()) {
				<span class="opacity-wrap">
					<input
						class="opacity"
						inputmode="numeric"
						[attr.aria-label]="(label() ?? 'Color') + ' opacity'"
						[value]="opacity()"
						[disabled]="disabled()"
						(change)="setOpacity($any($event.target))"
						(keydown.enter)="setOpacity($any($event.target))"
					/>%
				</span>
			}
		</div>
	`,
	styleUrl: './controls.css',
	host: { class: 'color-field' },
})
export class ColorField {
	readonly label = input<string>();
	readonly value = model('#FFFFFF');
	readonly opacity = model(100);
	readonly showOpacity = input(true, { transform: booleanAttribute });
	readonly disabled = input(false, { transform: booleanAttribute });

	protected setOpacity(el: HTMLInputElement): void {
		const typed = Number.parseFloat(el.value);
		const opacity = Number.isFinite(typed)
			? Math.round(Math.min(100, Math.max(0, typed)))
			: this.opacity();
		el.value = String(opacity);
		this.opacity.set(opacity);
	}
}
