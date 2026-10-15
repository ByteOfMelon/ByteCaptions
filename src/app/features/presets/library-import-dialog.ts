import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { styleSummary } from '../../core/model/style-summary';
import { CaptionStyle } from '../../core/model/types';
import { importNames } from '../../core/project/library';
import { PresetLibrary } from '../../state/preset-library';
import { Button } from '../../ui/button/button';
import { Checkbox } from '../../ui/controls/controls';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { StyleChip } from '../player/style-chip';

/**
 * Pick library presets to copy into the project
 */
@Component({
	selector: 'bc-library-import-dialog',
	imports: [Dialog, Button, Checkbox, StyleChip],
	template: `
		<bc-dialog heading="Import from library" [width]="560">
			@if (rows().length) {
				<div class="toolbar">
					<span class="text-small text-faded">
						{{ chosen().length }} of {{ rows().length }} selected
					</span>
					<button bcButton variant="ghost" (click)="selectAll(true)">Select all</button>
					<button bcButton variant="ghost" (click)="selectAll(false)">Select none</button>
				</div>
			}
			<div
				class="list"
				role="listbox"
				aria-label="Library presets"
				aria-multiselectable="true"
			>
				@for (r of rows(); track r.id) {
					<div
						class="row"
						role="option"
						tabindex="0"
						[attr.aria-selected]="r.selected"
						(click)="toggle(r.id)"
						(keydown.space)="$event.preventDefault(); toggle(r.id)"
						(keydown.enter)="toggle(r.id)"
					>
						<bc-checkbox
							[checked]="r.selected"
							(click)="$event.stopPropagation()"
							(checkedChange)="toggle(r.id)"
						/>
						<bc-style-chip large [style]="r.style" />
						<span class="text">
							<span class="name">{{ r.style.name }}</span>
							<span class="text-small text-faded line">{{ r.summary }}</span>
							@if (r.addedAs !== r.style.name) {
								<span class="text-small warning line"
									>Will be added as {{ r.addedAs }}</span
								>
							}
						</span>
					</div>
				} @empty {
					<div class="empty">
						<span class="text-body-bold">Your style library is empty</span>
						<span class="text-small text-faded">
							Add presets with Save to library, or import a .bclib file in Settings →
							Style Library.
						</span>
					</div>
				}
			</div>

			<div dialogFooter>
				<button bcButton (click)="ref.close()">Cancel</button>
				<button bcButton variant="primary" [disabled]="!chosen().length" (click)="import()">
					{{ importLabel() }}
				</button>
			</div>
		</bc-dialog>
	`,
	styles: `
		.toolbar {
			display: flex;
			align-items: center;
			gap: var(--spacing-xs);
		}
		.toolbar span {
			flex: 1;
		}
		.list {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-xs);
			height: 360px;
			padding: var(--spacing-sm);
			overflow-y: auto;
			border-radius: var(--radius-panel);
			background: var(--color-bg);
		}
		.row {
			display: flex;
			align-items: center;
			gap: var(--spacing-md);
			padding: var(--spacing-sm);
			border-radius: var(--radius-control);
			cursor: pointer;
		}
		.row:hover {
			background: var(--color-card);
		}
		.row[aria-selected='true'] {
			background: var(--color-selected);
		}
		.row:focus-visible {
			outline: none;
			box-shadow: var(--focus-ring);
		}
		.text {
			display: flex;
			flex: 1;
			flex-direction: column;
			min-width: 0;
		}
		.name,
		.line {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.warning {
			color: var(--color-warning);
		}
		.empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: var(--spacing-xs);
			height: 100%;
			padding: var(--spacing-xl);
			text-align: center;
		}
	`,
})
export class LibraryImportDialog implements OnInit {
	private readonly library = inject(PresetLibrary);
	protected readonly ref = inject<DialogRef<CaptionStyle[]>>(DialogRef);

	readonly existingNames = input<string[]>([]);

	private readonly selected = signal(new Set<string>());

	protected readonly rows = computed(() => {
		const list = this.library.list();
		const selected = this.selected();
		const names = importNames(
			list.map((p) => p.style),
			(i) => selected.has(list[i].id),
			this.existingNames(),
		);

		return list.map((p, i) => ({
			...p,
			summary: styleSummary(p.style),
			selected: selected.has(p.id),
			addedAs: names[i],
		}));
	});
	protected readonly chosen = computed(() => this.rows().filter((r) => r.selected));
	protected readonly importLabel = computed(() => {
		const n = this.chosen().length;

		return n ? `Import ${n} preset${n === 1 ? '' : 's'}` : 'Import';
	});

	ngOnInit(): void {
		void this.library.load();
	}

	protected toggle(id: string): void {
		this.selected.update((s) => {
			const next = new Set(s);

			if (!next.delete(id)) next.add(id);

			return next;
		});
	}

	protected selectAll(on: boolean): void {
		this.selected.set(new Set(on ? this.rows().map((r) => r.id) : []));
	}

	protected import(): void {
		this.ref.close(
			this.chosen().map((r) => ({ ...structuredClone(r.style), name: r.addedAs })),
		);
	}
}
