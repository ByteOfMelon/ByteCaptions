import { defaultStyle } from './defaults';
import { colorName, styleSummary } from './style-summary';

describe('styleSummary', () => {
	it('describes the default style', () => {
		expect(styleSummary(defaultStyle())).toBe('Default font • 100% • White on black 75%');
	});

	it('lists font, size, emphasis, then colors, and notes no background', () => {
		const s = {
			...defaultStyle(),
			font: 'propSans' as const,
			italic: true,
			textColor: '#FFFF00',
			bgOpacity: 0,
		};

		expect(styleSummary(s)).toBe('Proportional Sans • 100% • Italic • Yellow, no background');
	});

	it('includes every emphasis and a text opacity', () => {
		const s = {
			...defaultStyle(),
			scale: 1.5,
			bold: true,
			italic: true,
			underline: true,
			textColor: '#00FFFF',
			textOpacity: 0.5,
			bgColor: '#0000FF',
			bgOpacity: 1,
		};

		expect(styleSummary(s)).toBe(
			'Default font • 150% • Bold • Italic • Underline • Cyan 50% on blue 100%',
		);
	});

	it('uses • as the separator', () => {
		expect(styleSummary(defaultStyle())).not.toContain('·');
	});
});

describe('colorName', () => {
	it.each([
		['#080808', 'black'],
		['#FFFFFF', 'white'],
		['#808080', 'gray'],
		['#FF0000', 'red'],
		['#FFA500', 'orange'],
		['#FFFF00', 'yellow'],
		['#00FF00', 'green'],
		['#00FFFF', 'cyan'],
		['#0000FF', 'blue'],
		['#800080', 'purple'],
		['#FF00FF', 'magenta'],
		['nonsense', 'custom'],
	])('%s is %s', (hex, name) => {
		expect(colorName(hex)).toBe(name);
	});
});
