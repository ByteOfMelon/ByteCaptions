import { Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

/** Focuses (and optionally selects) the element when it is rendered. */
@Directive({ selector: '[bcAutofocus]' })
export class Autofocus {
	readonly selectAll = input(false, {
		alias: 'bcAutofocus',
		transform: (v: unknown) => v === '' || v === 'select' || v === true,
	});

	constructor() {
		const el =
			inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef).nativeElement;
		afterNextRender(() => {
			el.focus();
			if (this.selectAll()) el.select?.();
		});
	}
}
