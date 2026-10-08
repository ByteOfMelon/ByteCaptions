import { Component, input, output } from '@angular/core';
import { Anchor, Position } from '../../core/model/types';
import { ANCHOR_LABEL } from '../player/caption-render';

/** Default x/y (%) for each anchor of the 3×3 grid, inset from the frame edges. */
const ANCHOR_XY: [number, number][] = [
	[10, 10],
	[50, 10],
	[90, 10],
	[10, 50],
	[50, 50],
	[90, 50],
	[10, 90],
	[50, 90],
	[90, 90],
];

/** The changes to apply to a Position when an anchor is picked. */
export function positionForAnchor(anchor: Anchor): Partial<Position> {
	const [x, y] = ANCHOR_XY[anchor];
	return {
		anchor,
		x,
		y,
		align: (['left', 'center', 'right'] as const)[anchor % 3],
		name: ANCHOR_LABEL[anchor],
	};
}

/** "Position" block: 3×3 anchor grid plus the position's name and x/y. */
@Component({
	selector: 'bc-anchor-picker',
	template: `
		<span class="text-small" [id]="labelId">Position</span>
		<div class="row">
			<div class="anchors" role="radiogroup" [attr.aria-labelledby]="labelId">
				@for (a of anchors; track a.id) {
					<button
						type="button"
						role="radio"
						class="anchor"
						[attr.aria-label]="a.label"
						[attr.aria-checked]="position().anchor === a.id"
						(click)="positionChange.emit(positionFor(a.id))"
					></button>
				}
			</div>
			<div class="info">
				<span>{{ position().name }}</span>
				<span class="text-mono-small text-faded"
					>x {{ position().x }}% &nbsp; y {{ position().y }}%</span
				>
			</div>
		</div>
	`,
	styles: `
		:host {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}
		.row {
			display: flex;
			align-items: center;
			gap: var(--spacing-md);
		}
		.anchors {
			display: grid;
			grid-template-columns: repeat(3, 20px);
			gap: var(--spacing-xs);
			padding: var(--spacing-xs);
			border-radius: var(--radius-control);
			background: var(--color-bg);
			box-shadow: inset 0 0 0 var(--outline-width) var(--color-control-border);
		}
		.anchor {
			width: 20px;
			height: 20px;
			padding: 0;
			border: none;
			border-radius: var(--radius-small);
			background: var(--color-card);
			cursor: pointer;
		}
		.anchor:hover {
			background: var(--color-selected);
		}
		.anchor[aria-checked='true'] {
			background: var(--color-brand);
		}
		.anchor:focus-visible {
			outline: none;
			box-shadow: var(--focus-ring);
		}
		.info {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-xs);
		}
	`,
})
export class AnchorPicker {
	private static seq = 0;
	protected readonly labelId = `bc-anchor-${++AnchorPicker.seq}`;
	protected readonly anchors = ANCHOR_LABEL.map((label, i) => ({ id: i as Anchor, label }));
	protected readonly positionFor = positionForAnchor;
	readonly position = input.required<Position>();
	readonly positionChange = output<Partial<Position>>();
}
