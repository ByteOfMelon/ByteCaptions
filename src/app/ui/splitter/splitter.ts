import { Component, booleanAttribute, input, model, signal } from '@angular/core';

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

/**
 * Resize handle that sits in the gap between two panels and sets one panel's size in px
 */
@Component({
	selector: 'bc-splitter',
	template: '',
	styleUrl: './splitter.css',
	host: {
		role: 'separator',
		tabindex: '0',
		'[attr.aria-label]': 'label()',
		'[attr.aria-orientation]': 'orientation()',
		'[attr.aria-valuenow]': 'value()',
		'[attr.aria-valuemin]': 'min()',
		'[attr.aria-valuemax]': 'max()',
		'[class]': 'orientation()',
		'[class.dragging]': 'dragging()',
		'(pointerdown)': 'onPointerDown($event)',
		'(pointermove)': 'onPointerMove($event)',
		'(pointerup)': 'onPointerUp($event)',
		'(lostpointercapture)': 'dragging.set(false)',
		'(dblclick)': 'value.set(defaultValue())',
		'(keydown)': 'onKey($event)',
	},
})
export class Splitter {
	readonly label = input.required<string>();
	readonly orientation = input<'vertical' | 'horizontal'>('vertical');
	readonly reverse = input(false, { transform: booleanAttribute });
	readonly min = input.required<number>();
	readonly max = input.required<number>();
	readonly defaultValue = input.required<number>();
	readonly value = model.required<number>();

	protected readonly dragging = signal(false);
	private start = { pos: 0, value: 0 };

	private set(v: number): void {
		this.value.set(Math.round(Math.min(this.max(), Math.max(this.min(), v))));
	}

	private pos(e: PointerEvent): number {
		return this.orientation() === 'vertical' ? e.clientX : e.clientY;
	}

	protected onPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;

		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		this.start = { pos: this.pos(e), value: this.value() };
		this.dragging.set(true);
	}

	protected onPointerMove(e: PointerEvent): void {
		if (!this.dragging()) return;

		const delta = this.pos(e) - this.start.pos;
		this.set(this.start.value + (this.reverse() ? -delta : delta));
	}

	protected onPointerUp(e: PointerEvent): void {
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		this.dragging.set(false);
	}

	protected onKey(e: KeyboardEvent): void {
		const [less, more] =
			this.orientation() === 'vertical'
				? ['ArrowLeft', 'ArrowRight']
				: ['ArrowUp', 'ArrowDown'];
		const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
		let dir = e.key === less ? -1 : e.key === more ? 1 : 0;

		if (this.reverse()) dir = -dir;

		if (dir) this.set(this.value() + dir * step);
		else if (e.key === 'Home') this.set(this.min());
		else if (e.key === 'End') this.set(this.max());
		else if (e.key === 'Enter') this.value.set(this.defaultValue());
		else return;

		e.preventDefault();
		e.stopPropagation();
	}
}
