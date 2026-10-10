import {
	ApplicationRef,
	Component,
	ElementRef,
	EnvironmentInjector,
	Injectable,
	afterNextRender,
	booleanAttribute,
	computed,
	createComponent,
	inject,
	input,
	output,
	signal,
} from '@angular/core';
import {
	LucideCheck,
	LucideChevronRight,
	LucideDynamicIcon,
	LucideIconData,
} from '@lucide/angular';
import { Kbd } from '../kbd/kbd';

export interface MenuItem {
	kind?: 'item';
	id: string;
	label: string;
	icon?: LucideIconData;
	/** Trailing faded value, e.g. the current preset name */
	value?: string;
	keys?: string;
	checked?: boolean;
	danger?: boolean;
	disabled?: boolean;
	swatch?: string;
	submenu?: MenuEntry[];
}

export type MenuEntry = MenuItem | { kind: 'separator' } | { kind: 'header'; label: string };

function isItem(e: MenuEntry): e is MenuItem {
	return e.kind === undefined || e.kind === 'item';
}

/** Composable menu panel */
@Component({
	selector: 'bc-menu',
	imports: [Kbd, LucideCheck, LucideChevronRight, LucideDynamicIcon],
	templateUrl: './menu.html',
	styleUrl: './menu.css',
	host: {
		role: 'menu',
		tabindex: '-1',
		'(keydown)': 'onKey($event)',
	},
})
export class Menu {
	readonly items = input.required<MenuEntry[]>();
	readonly nested = input(false, { transform: booleanAttribute });
	readonly select = output<string>();
	readonly back = output<void>();

	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	protected readonly active = signal(-1);
	protected readonly openSub = signal(-1);
	private readonly focusable = computed(() =>
		this.items()
			.map((e, i) => (isItem(e) && !e.disabled ? i : -1))
			.filter((i) => i >= 0),
	);

	constructor() {
		afterNextRender(() => {
			this.host.nativeElement.focus();

			if (this.nested()) this.active.set(this.focusable()[0] ?? -1);
		});
	}

	protected asItem(e: MenuEntry): MenuItem {
		return e as MenuItem;
	}

	protected hover(i: number): void {
		this.active.set(i);
		this.openSub.set(this.asItem(this.items()[i]).submenu ? i : -1);
	}

	protected activate(i: number): void {
		const item = this.asItem(this.items()[i]);

		if (item.disabled) return;

		if (item.submenu) this.openSub.set(i);
		else this.select.emit(item.id);
	}

	protected closeSub(): void {
		this.openSub.set(-1);
		this.host.nativeElement.focus();
	}

	protected onKey(e: KeyboardEvent): void {
		// Keys inside an open submenu belong to the submenu
		if (e.target !== this.host.nativeElement) return;

		const f = this.focusable();
		const pos = f.indexOf(this.active());

		switch (e.key) {
			case 'ArrowDown':
				this.active.set(f[(pos + 1) % f.length] ?? -1);
				break;
			case 'ArrowUp':
				this.active.set(f[(pos - 1 + f.length) % f.length] ?? -1);
				break;
			case 'Home':
				this.active.set(f[0] ?? -1);
				break;
			case 'End':
				this.active.set(f[f.length - 1] ?? -1);
				break;
			case 'Enter':
			case ' ':
			case 'ArrowRight':
				if (this.active() < 0) return;

				if (e.key === 'ArrowRight' && !this.asItem(this.items()[this.active()]).submenu)
					return;

				this.activate(this.active());
				break;
			case 'ArrowLeft':
				if (!this.nested()) return;

				this.back.emit();
				break;
			case 'Escape':
				this.back.emit();
				break;
			default:
				return;
		}

		e.preventDefault();
		e.stopPropagation();
	}
}

/** Opens a context menu at a certain screen point when right-clicked */
@Injectable({ providedIn: 'root' })
export class ContextMenu {
	private readonly appRef = inject(ApplicationRef);
	private readonly injector = inject(EnvironmentInjector);
	private close: (() => void) | null = null;

	open(at: { x: number; y: number } | MouseEvent, items: MenuEntry[]): Promise<string | null> {
		if (at instanceof MouseEvent) at.preventDefault();

		this.close?.();
		const x = at instanceof MouseEvent ? at.clientX : at.x;
		const y = at instanceof MouseEvent ? at.clientY : at.y;
		const previousFocus = document.activeElement as HTMLElement | null;

		return new Promise((resolve) => {
			const ref = createComponent(Menu, { environmentInjector: this.injector });
			ref.setInput('items', items);
			const el = ref.location.nativeElement as HTMLElement;
			el.classList.add('bc-context-menu');
			el.style.left = `${x}px`;
			el.style.top = `${y}px`;
			document.body.append(el);
			this.appRef.attachView(ref.hostView);
			ref.changeDetectorRef.detectChanges();

			// Keep the menu on screen
			const r = el.getBoundingClientRect();

			if (r.right > innerWidth) el.style.left = `${Math.max(4, x - r.width)}px`;

			if (r.bottom > innerHeight) el.style.top = `${Math.max(4, y - r.height)}px`;

			const outside = (e: Event) => {
				if (!el.contains(e.target as Node)) done(null);
			};
			const done = (id: string | null) => {
				document.removeEventListener('pointerdown', outside, true);
				this.appRef.detachView(ref.hostView);
				ref.destroy();
				this.close = null;
				previousFocus?.focus();
				resolve(id);
			};
			document.addEventListener('pointerdown', outside, true);
			ref.instance.select.subscribe((id) => done(id));
			ref.instance.back.subscribe(() => done(null));
			this.close = () => done(null);
		});
	}
}
