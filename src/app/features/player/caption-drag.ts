import { Anchor, Position } from '../../core/model/types';
import { positionForAnchor } from '../inspector/anchor-picker';

/** How far/how long the pointer must move with the click down before a caption starts moving */
export const DRAG_START_PX = 10;
export const DRAG_START_MS = 150;
/** An axis within this many percent of the anchor's preset position snaps onto it */
export const SNAP_PERCENT = 4;

/** A caption window's box */
export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** SRV3 percent from frame percent, the inverse of ytSafeArea */
const fromSafeArea = (framePercent: number) => (framePercent - 2) / 0.96;
const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Where each axis snaps to */
const SNAP_TO = [[0, 10], [50], [90, 100]];

/**
 * The position for a caption window dropped at `box`
 */
export function positionFromBox(box: Box, current: Position): Position {
	const col = third(box.left + box.width / 2);
	const row = third(box.top + box.height / 2);
	const preset = positionForAnchor((row * 3 + col) as Anchor) as Position;
	const x = snap(fromSafeArea(box.left + (box.width * col) / 2), SNAP_TO[col]);
	const y = snap(fromSafeArea(box.top + (box.height * row) / 2), SNAP_TO[row]);

	return {
		...current,
		...preset,
		x: x.value,
		y: y.value,
		name: x.snapped && y.snapped ? preset.name : 'Custom',
	};
}

function snap(raw: number, targets: number[]): { value: number; snapped: boolean } {
	const value = clamp(raw);
	const near = targets
		.filter((t) => Math.abs(value - t) <= SNAP_PERCENT)
		.sort((a, b) => Math.abs(value - a) - Math.abs(value - b))[0];

	return near === undefined
		? { value: Math.round(value), snapped: false }
		: { value: near, snapped: true };
}

function third(percent: number): 0 | 1 | 2 {
	return percent < 100 / 3 ? 0 : percent < 200 / 3 ? 1 : 2;
}
