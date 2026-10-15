import { Position } from '../../core/model/types';
import { positionFromBox } from './caption-drag';

// The project default (defaultPosition), at the very bottom
const bottomCenter: Position = {
	name: 'Bottom center',
	anchor: 7,
	x: 50,
	y: 100,
	align: 'center',
	direction: 'horizontal',
};

// Frame percent of SRV3 percent (ytSafeArea)
const f = (p: number) => 2 + p * 0.96;

describe('positionFromBox', () => {
	it('snaps back onto the preset when dropped near it', () => {
		// Bottom-center anchor point lands 2% off the default on both axes
		const box = { left: f(52) - 15, top: f(98) - 10, width: 30, height: 10 };

		expect(positionFromBox(box, bottomCenter)).toEqual(bottomCenter);
	});

	it('picks the anchor of the third the box is in, and snaps to that corner', () => {
		const box = { left: f(11), top: f(9), width: 20, height: 8 };

		expect(positionFromBox(box, bottomCenter)).toEqual({
			...bottomCenter,
			name: 'Top left',
			anchor: 0,
			x: 10,
			y: 10,
			align: 'left',
		});
	});

	it('snaps one axis and keeps the other custom', () => {
		const box = { left: f(50) - 15, top: f(75) - 10, width: 30, height: 10 };
		const pos = positionFromBox(box, bottomCenter);

		expect(pos).toMatchObject({ anchor: 7, x: 50, y: 75, name: 'Custom' });
	});

	it("snaps to the picker's inset preset too", () => {
		const box = { left: f(51) - 15, top: f(89) - 10, width: 30, height: 10 };

		expect(positionFromBox(box, bottomCenter)).toMatchObject({
			x: 50,
			y: 90,
			name: 'Bottom center',
		});
	});

	it('snaps into the very corner when dragged past it', () => {
		const box = { left: -5, top: -5, width: 20, height: 8 };

		expect(positionFromBox(box, bottomCenter)).toMatchObject({
			anchor: 0,
			x: 0,
			y: 0,
			name: 'Top left',
		});
	});

	it('keeps the position inside the frame', () => {
		const box = { left: 90, top: 97, width: 30, height: 10 };
		const pos = positionFromBox(box, bottomCenter);

		expect(pos.anchor).toBe(8);
		expect(pos.x).toBeLessThanOrEqual(100);
		expect(pos.y).toBeLessThanOrEqual(100);
	});

	it('keeps the text direction', () => {
		const box = { left: f(50) - 15, top: f(50) - 5, width: 30, height: 10 };

		expect(positionFromBox(box, { ...bottomCenter, direction: 'verticalRtl' }).direction).toBe(
			'verticalRtl',
		);
	});
});
