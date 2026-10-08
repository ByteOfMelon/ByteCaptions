import { Directive, ElementRef, OnDestroy, inject, input } from '@angular/core';

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
		for (const k of this.keys()?.split('+') ?? []) {
			const kbd = document.createElement('kbd');
			kbd.textContent = k.trim();
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
