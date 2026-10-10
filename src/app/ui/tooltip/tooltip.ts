import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { keyCaps } from '../kbd/keys';

/**
 * Hover/focus tooltip: `<button bcIconButton bcTooltip="Split at playhead" tooltipKeys="Ctrl+B">`.
 * Rendered into <body> so panels with overflow:hidden don't clip it.
 */
@Directive({
	selector: '[bcTooltip]',
	host: {
		'(mouseenter)': 'show()',
		'(focusin)': 'show()',
		'(mouseleave)': 'hide()',
		'(focusout)': 'hide()',
		'(keydown.escape)': 'hide()',
	},
})
export class Tooltip implements OnDestroy {
	readonly text = input.required<string>({ alias: 'bcTooltip' });
	readonly keys = input<string>(undefined, { alias: 'tooltipKeys' });
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private el: HTMLElement | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;

	protected show(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.render(), 400);
	}

	protected hide(): void {
		clearTimeout(this.timer);
		this.el?.remove();
		this.el = null;
	}

	ngOnDestroy(): void {
		this.hide();
	}

	private render(): void {
		this.hide();

		if (!this.text()) return;

		const el = document.createElement('div');
		el.className = 'bc-tooltip';
		el.role = 'tooltip';
		el.textContent = this.text();

		for (const k of keyCaps(this.keys() ?? '')) {
			const kbd = document.createElement('kbd');
			kbd.textContent = k;
			el.append(kbd);
		}

		document.body.append(el);
		const r = this.host.nativeElement.getBoundingClientRect();
		const t = el.getBoundingClientRect();
		const gap = 4;
		let top = r.top - t.height - gap;

		if (top < gap) top = r.bottom + gap;

		const left = Math.min(
			Math.max(gap, r.left + r.width / 2 - t.width / 2),
			innerWidth - t.width - gap,
		);
		el.style.top = `${top}px`;
		el.style.left = `${left}px`;
		this.el = el;
	}
}

let nextErrorId = 0;

/**
 * Error message for an inline editor with no room for helper text (cue times, track names):
 * `<input [bcErrorTip]="error()" />`. While set, a tooltip in danger text stays below the host,
 * and the host is marked invalid and described by it.
 */
@Directive({
	selector: '[bcErrorTip]',
	host: {
		'[attr.aria-invalid]': 'message() ? "true" : null',
		'[attr.aria-describedby]': 'message() ? id : null',
	},
})
export class ErrorTip implements OnDestroy {
	readonly message = input<string | null>(null, { alias: 'bcErrorTip' });
	protected readonly id = `bc-error-tip-${nextErrorId++}`;
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private el: HTMLElement | null = null;
	// Panels scroll under a fixed tooltip; follow the host.
	private readonly place = () => this.position();

	constructor() {
		effect(() => {
			const message = this.message();

			if (!message) return this.remove();

			if (!this.el) {
				this.el = document.createElement('div');
				this.el.className = 'bc-tooltip error';
				this.el.id = this.id;
				this.el.role = 'alert';
				document.body.append(this.el);
				addEventListener('scroll', this.place, true);
				addEventListener('resize', this.place);
			}

			this.el.textContent = message;
			this.position();
		});
	}

	ngOnDestroy(): void {
		this.remove();
	}

	private position(): void {
		if (!this.el) return;

		const r = this.host.nativeElement.getBoundingClientRect();
		const t = this.el.getBoundingClientRect();
		const gap = 8;
		const below = r.bottom + gap;
		this.el.style.top = `${below + t.height > innerHeight ? r.top - t.height - gap : below}px`;
		this.el.style.left = `${Math.min(Math.max(4, r.left), innerWidth - t.width - 4)}px`;
	}

	private remove(): void {
		this.el?.remove();
		this.el = null;
		removeEventListener('scroll', this.place, true);
		removeEventListener('resize', this.place);
	}
}
