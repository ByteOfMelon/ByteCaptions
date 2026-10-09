import {
	Component,
	DestroyRef,
	ElementRef,
	computed,
	effect,
	inject,
	input,
	signal,
	untracked,
} from '@angular/core';
import { MARKER_COLORS } from '../../core/model/defaults';
import { Marker, MarkerId } from '../../core/model/types';
import { formatClock, formatTimecode } from '../../core/time/timecode';
import { EditorUi } from '../../state/editor-ui';
import { ProjectStore } from '../../state/project-store';
import { Autofocus } from '../../ui/autofocus/autofocus';
import { Button } from '../../ui/button/button';
import { Field } from '../../ui/field/field';
import { MARKER_COLOR_NAMES, Markers } from './markers';

/**
 * Edits a marker's note and color (Markers board). The timeline positions it under the
 * marker. The note saves on Enter or when the popover closes any other way except Esc,
 * which throws the typed note away.
 */
@Component({
	selector: 'bc-marker-popover',
	imports: [Autofocus, Button, Field],
	template: `
		<span class="heading text-small text-faded">Marker {{ number() }} • {{ time() }}</span>
		<bc-field #field label="Note">
			<input
				[id]="field.fieldId"
				bcAutofocus="select"
				placeholder="What's here?"
				[value]="draft()"
				(input)="draft.set($any($event.target).value)"
				(keydown.enter)="close(true)"
			/>
		</bc-field>
		<div class="swatches" role="radiogroup" aria-label="Color" (keydown)="onSwatchKey($event)">
			@for (c of colors; track c.id) {
				<button
					type="button"
					role="radio"
					[attr.aria-label]="c.label"
					[attr.aria-checked]="marker().color === c.id"
					[tabindex]="marker().color === c.id ? 0 : -1"
					[style.background]="hex[c.id]"
					(click)="markers.setColor(marker().id, c.id)"
				></button>
			}
		</div>
		<button bcButton variant="danger" class="delete" (click)="remove()">Delete marker</button>
	`,
	styles: `
		:host {
			position: fixed;
			z-index: 900;
			display: flex;
			flex-direction: column;
			gap: var(--spacing-md);
			width: 280px;
			padding: var(--spacing-md);
			border-radius: var(--radius-control);
			background: var(--color-card);
			box-shadow: inset 0 0 0 var(--outline-width) var(--color-outline);
		}
		.swatches {
			display: flex;
			gap: var(--spacing-sm);
		}
		.swatches button {
			width: 20px;
			height: 20px;
			padding: 0;
			border: none;
			border-radius: 50%;
			cursor: pointer;
		}
		.swatches button[aria-checked='true'] {
			box-shadow:
				0 0 0 2px var(--color-card),
				0 0 0 4px var(--color-text);
		}
		.swatches button:focus-visible {
			outline: none;
			box-shadow:
				0 0 0 2px var(--color-card),
				0 0 0 4px var(--color-focus);
		}
		.delete {
			align-self: flex-start;
		}
	`,
	host: {
		role: 'dialog',
		'aria-label': 'Edit marker',
		'(keydown.escape)': 'close(false); $event.stopPropagation()',
		'(document:pointerdown)': 'onOutside($event)',
	},
})
export class MarkerPopover {
	readonly marker = input.required<Marker>();

	protected readonly markers = inject(Markers);
	private readonly store = inject(ProjectStore);
	private readonly ui = inject(EditorUi);
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
	protected readonly colors = MARKER_COLOR_NAMES;
	protected readonly hex = MARKER_COLORS;

	/** Typed note; resets only when a different marker is shown, not on color changes. */
	protected readonly draft = signal('');
	private shownId: MarkerId | null = null;
	protected readonly number = computed(() => this.markers.number(this.marker().id));
	protected readonly time = computed(() =>
		this.ui.timeUnits() === 'ms'
			? formatClock(this.marker().at)
			: formatTimecode(this.marker().at, this.store.project().fps),
	);
	private closed = false;

	constructor() {
		effect(() => {
			const m = this.marker();
			if (m.id === this.shownId) return;
			this.shownId = m.id;
			untracked(() => this.draft.set(m.note));
		});
		// Closing by switching to another marker, or the tab, still keeps the note.
		inject(DestroyRef).onDestroy(() => {
			if (!this.closed) this.markers.setNote(this.marker().id, this.draft());
		});
	}

	protected close(save: boolean): void {
		if (save) this.markers.setNote(this.marker().id, this.draft());
		this.closed = true;
		this.markers.editing.set(null);
	}

	protected remove(): void {
		this.closed = true;
		this.markers.remove(this.marker().id);
	}

	protected onOutside(e: PointerEvent): void {
		if (!this.host.contains(e.target as Node)) this.close(true);
	}

	/** Arrow keys pick the next / previous color, like a radio group. */
	protected onSwatchKey(e: KeyboardEvent): void {
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
		if (!step) return;
		e.preventDefault();
		const i = MARKER_COLOR_NAMES.findIndex((c) => c.id === this.marker().color);
		const next =
			MARKER_COLOR_NAMES[(i + step + MARKER_COLOR_NAMES.length) % MARKER_COLOR_NAMES.length];
		this.markers.setColor(this.marker().id, next.id);
		const buttons = (e.currentTarget as HTMLElement).querySelectorAll('button');
		queueMicrotask(() => buttons[MARKER_COLOR_NAMES.indexOf(next)]?.focus());
	}
}
