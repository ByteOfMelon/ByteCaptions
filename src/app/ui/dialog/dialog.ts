import {
	ApplicationRef,
	Component,
	ElementRef,
	EnvironmentInjector,
	Injectable,
	Injector,
	Type,
	afterNextRender,
	booleanAttribute,
	createComponent,
	inject,
	input,
} from '@angular/core';
import { LucideX } from '@lucide/angular';
import { IconButton } from '../button/button';

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const OVERLAY_PADDING = 16;

/** Handle given to a dialog's content component */
export class DialogRef<R = unknown> {
	private resolve!: (r: R | undefined) => void;
	readonly closed = new Promise<R | undefined>((r) => (this.resolve = r));

	destroy: () => void = () => {};

	close(result?: R): void {
		this.destroy();
		this.resolve(result);
	}
}

export interface DialogOptions {
	inputs?: Record<string, unknown>;
	placement?: 'center' | 'top';
	dismissable?: boolean;
}

/**
 * Opens a component in a modal overlaying the current content.
 */
@Injectable({ providedIn: 'root' })
export class Dialogs {
	private readonly appRef = inject(ApplicationRef);
	private readonly env = inject(EnvironmentInjector);
	private readonly stack: DialogRef[] = [];

	get isOpen(): boolean {
		return this.stack.length > 0;
	}

	open<C, R = unknown>(component: Type<C>, opts: DialogOptions = {}): DialogRef<R> {
		const dialogRef = new DialogRef<R>();
		const previousFocus = document.activeElement as HTMLElement | null;
		const overlay = document.createElement('div');
		overlay.className = `bc-overlay ${opts.placement ?? 'center'}`;

		const injector = Injector.create({
			providers: [{ provide: DialogRef, useValue: dialogRef }],
			parent: this.env,
		});
		const ref = createComponent(component, {
			environmentInjector: this.env,
			elementInjector: injector,
		});

		for (const [k, v] of Object.entries(opts.inputs ?? {})) ref.setInput(k, v);

		const el = ref.location.nativeElement as HTMLElement;
		overlay.append(el);
		document.body.append(overlay);
		this.appRef.attachView(ref.hostView);
		ref.changeDetectorRef.detectChanges();

		const center = new ResizeObserver(() => {
			if (opts.placement === 'top') return;

			const free = overlay.clientHeight - el.offsetHeight;
			el.style.marginTop = `${Math.max(0, Math.floor(free / 2) - OVERLAY_PADDING)}px`;
		});
		center.observe(overlay);
		center.observe(el);

		const onKey = (e: KeyboardEvent) => {
			if (this.stack.at(-1) !== dialogRef) return;

			if (e.key === 'Escape' && !e.defaultPrevented) {
				e.preventDefault();
				e.stopPropagation();
				dialogRef.close();
			} else if (e.key === 'Tab') {
				const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
					(n) => n.offsetParent !== null,
				);

				if (!items.length) return;

				const first = items[0],
					last = items.at(-1)!;
				const at = document.activeElement;

				if (e.shiftKey && (at === first || at === el)) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && at === last) {
					e.preventDefault();
					first.focus();
				}
			}

			// Keep editor shortcuts from firing underneath the dialog
			e.stopPropagation();
		};
		const onPointer = (e: PointerEvent) => {
			if (e.target === overlay && opts.dismissable !== false) dialogRef.close();
		};
		overlay.addEventListener('keydown', onKey);
		overlay.addEventListener('pointerdown', onPointer);
		this.stack.push(dialogRef as DialogRef);

		dialogRef.destroy = () => {
			center.disconnect();
			this.stack.splice(this.stack.indexOf(dialogRef as DialogRef), 1);
			this.appRef.detachView(ref.hostView);
			ref.destroy();
			overlay.remove();
			previousFocus?.focus();
		};

		// Focus [bcAutofocus] if the content has one
		requestAnimationFrame(() => {
			if (el.contains(document.activeElement)) return;

			const auto = el.querySelector<HTMLElement>('[bcAutofocus]');

			if (auto) return auto.focus();

			el.tabIndex = -1;
			el.style.outline = 'none';
			el.focus();
		});

		return dialogRef;
	}
}

/**
 * Standard dialog frame
 */
@Component({
	selector: 'bc-dialog',
	imports: [IconButton, LucideX],
	template: `
		<header class="head">
			<div class="titles" [class.inline]="inlineSubtitle()">
				<h2 class="text-heading-2" [id]="titleId">{{ heading() }}</h2>
				@if (subtitle()) {
					<span class="text-small text-faded">{{ subtitle() }}</span>
				}
				<ng-content select="[dialogTitleExtra]" />
			</div>
			<button bcIconButton variant="ghost" aria-label="Close" (click)="ref.close()">
				<svg lucideX></svg>
			</button>
		</header>
		<div class="body"><ng-content /></div>
		<ng-content select="[dialogFooter]" />
	`,
	styleUrl: './dialog.css',
	host: {
		role: 'dialog',
		'aria-modal': 'true',
		'[attr.aria-labelledby]': 'titleId',
		'[style.width.px]': 'width()',
	},
})
export class Dialog {
	private static seq = 0;
	protected readonly ref = inject(DialogRef);
	protected readonly titleId = `bc-dialog-${++Dialog.seq}`;
	readonly heading = input.required<string>();
	readonly subtitle = input<string>();
	readonly width = input(640);
	/** Subtitle beside the title instead of below it */
	readonly inlineSubtitle = input(false, { transform: booleanAttribute });

	constructor() {
		const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
		afterNextRender(() => {
			if (document.activeElement && document.activeElement !== document.body) return;

			const auto = host.querySelector<HTMLElement>('[bcAutofocus]');

			if (auto) return auto.focus();

			host.tabIndex = -1;
			host.style.outline = 'none';
			host.focus();
		});
	}
}
