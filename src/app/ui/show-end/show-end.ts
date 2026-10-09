import { Directive, ElementRef, afterEveryRender, inject } from '@angular/core';

/**
 * Keeps the end of a long value (a path's file name) in view while the input isn't being
 * edited. Scrolls rather than using `direction: rtl`, which moves a leading "/" to the end.
 */
@Directive({
	selector: 'input[bcShowEnd]',
	host: { '(blur)': 'showEnd()' },
})
export class ShowEnd {
	private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

	constructor() {
		afterEveryRender(() => {
			if (document.activeElement !== this.el) this.showEnd();
		});
	}

	protected showEnd(): void {
		this.el.scrollLeft = this.el.scrollWidth;
	}
}
