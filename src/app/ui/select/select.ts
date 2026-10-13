import {
	Component,
	ElementRef,
	booleanAttribute,
	computed,
	effect,
	input,
	model,
	signal,
	viewChild,
} from '@angular/core';
import { LucideCheck, LucideChevronDown } from '@lucide/angular';

export interface SelectOption<T> {
	value: T;
	label: string;
}

let nextId = 0;

/** Dropdown select */
@Component({
	selector: 'bc-select',
	imports: [LucideCheck, LucideChevronDown],
	template: `
		@if (label()) {
			<span class="label text-small" [id]="id + '-label'">{{ label() }}</span>
		}
		<button
			type="button"
			class="trigger"
			role="combobox"
			aria-haspopup="listbox"
			[attr.aria-expanded]="open()"
			[attr.aria-controls]="id + '-list'"
			[attr.aria-labelledby]="label() ? id + '-label' : null"
			[attr.aria-activedescendant]="open() ? id + '-opt-' + active() : null"
			[disabled]="disabled()"
			#trigger
			(click)="toggle()"
			(keydown)="onKey($event)"
			(blur)="open.set(false)"
		>
			<span class="value">{{ selectedLabel() }}</span>
			<svg lucideChevronDown aria-hidden="true"></svg>
		</button>
		@if (open()) {
			<ul
				#list
				class="menu"
				popover="manual"
				role="listbox"
				[id]="id + '-list'"
				[style.left.px]="place().left"
				[style.width.px]="place().width"
				[style.top.px]="place().top"
				[style.bottom.px]="place().bottom"
			>
				@for (opt of options(); track $index) {
					<li
						role="option"
						[id]="id + '-opt-' + $index"
						[class.selected]="opt.value === value()"
						[class.active]="$index === active()"
						[attr.aria-selected]="opt.value === value()"
						(mousedown)="$event.preventDefault()"
						(mouseenter)="active.set($index)"
						(click)="choose($index)"
					>
						<span>{{ opt.label }}</span>
						@if (opt.value === value()) {
							<svg lucideCheck aria-hidden="true"></svg>
						}
					</li>
				}
			</ul>
		}
	`,
	styleUrl: './select.css',
})
export class Select<T = string> {
	readonly label = input<string>();
	readonly options = input.required<SelectOption<T>[]>();
	readonly value = model<T>();
	readonly disabled = input(false, { transform: booleanAttribute });

	protected readonly id = `bc-select-${nextId++}`;
	protected readonly open = signal(false);
	/** Where the open list sits */
	protected readonly place = signal<{
		left: number;
		width: number;
		top: number | null;
		bottom: number | null;
	}>({ left: 0, width: 0, top: 0, bottom: null });
	private readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');
	private readonly list = viewChild<ElementRef<HTMLElement>>('list');
	protected readonly active = signal(0);
	protected readonly selectedIndex = computed(() =>
		this.options().findIndex((o) => o.value === this.value()),
	);
	protected readonly selectedLabel = computed(
		() => this.options()[this.selectedIndex()]?.label ?? '',
	);

	constructor() {
		effect(() => this.list()?.nativeElement.showPopover());
	}

	protected toggle(): void {
		this.active.set(Math.max(0, this.selectedIndex()));

		if (!this.open()) {
			const r = this.trigger().nativeElement.getBoundingClientRect();
			const gap = 4;
			const height = Math.min(280, this.options().length * 32 + 8);
			const up = innerHeight - r.bottom < height + gap && r.top > innerHeight - r.bottom;
			this.place.set({
				left: r.left,
				width: r.width,
				top: up ? null : r.bottom + gap,
				bottom: up ? innerHeight - r.top + gap : null,
			});
		}

		this.open.update((o) => !o);
	}

	protected choose(index: number): void {
		this.value.set(this.options()[index].value);
		this.open.set(false);
	}

	protected onKey(e: KeyboardEvent): void {
		const last = this.options().length - 1;

		switch (e.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				e.preventDefault();

				if (!this.open()) return this.toggle();

				this.active.update((i) =>
					Math.min(last, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))),
				);
				break;
			case 'Home':
			case 'End':
				if (this.open()) {
					e.preventDefault();
					this.active.set(e.key === 'Home' ? 0 : last);
				}

				break;
			case 'Enter':
			case ' ':
				e.preventDefault();

				if (this.open()) this.choose(this.active());
				else this.toggle();

				break;
			case 'Escape':
				if (this.open()) e.preventDefault();

				this.open.set(false);
				break;
			case 'Tab':
				this.open.set(false);
				break;
		}
	}
}
