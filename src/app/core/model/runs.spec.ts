import { TextRun } from './types';
import { normalizeRuns, rangeOverride, replaceText, splitRuns, styleRange } from './runs';

const plain = (text: string): TextRun[] => [{ text }];
const bold = { bold: true };

describe('styleRange', () => {
	it('formats part of a word', () => {
		expect(styleRange(plain('gaming'), 0, 4, bold)).toEqual([
			{ text: 'gami', styleOverride: bold },
			{ text: 'ng' },
		]);
	});

	it('merges with existing formatting and joins equal neighbours', () => {
		const runs = styleRange(plain('a big word'), 2, 5, bold);
		expect(styleRange(runs, 0, 10, { italic: true })).toEqual([
			{ text: 'a ', styleOverride: { italic: true } },
			{ text: 'big', styleOverride: { bold: true, italic: true } },
			{ text: ' word', styleOverride: { italic: true } },
		]);
	});

	it('removes one property with undefined, or everything with clear', () => {
		const runs = styleRange(plain('word'), 0, 4, { bold: true, textColor: '#FF0000' });
		expect(styleRange(runs, 0, 4, { bold: undefined })).toEqual([
			{ text: 'word', styleOverride: { textColor: '#FF0000' } },
		]);
		expect(styleRange(runs, 0, 4, 'clear')).toEqual([{ text: 'word' }]);
	});
});

describe('replaceText', () => {
	const runs = styleRange(plain('the gaming industry'), 4, 10, bold);

	it('keeps formatting around an edit', () => {
		expect(replaceText(runs, 'the gaming business')).toEqual([
			{ text: 'the ' },
			{ text: 'gaming', styleOverride: bold },
			{ text: ' business' },
		]);
	});

	it('gives typed text the formatting before it', () => {
		expect(replaceText(runs, 'the gamings industry')).toEqual([
			{ text: 'the ' },
			{ text: 'gamings', styleOverride: bold },
			{ text: ' industry' },
		]);
	});

	it('uses the formatting after it at the very start', () => {
		const b = styleRange(plain('word'), 0, 4, bold);
		expect(replaceText(b, 'A word')).toEqual([{ text: 'A word', styleOverride: bold }]);
	});
});

describe('splitRuns and rangeOverride', () => {
	it('splits and trims with formatting kept', () => {
		const runs = styleRange(plain('one two three'), 4, 7, bold);
		expect(splitRuns(runs, 7)).toEqual([
			[{ text: 'one ' }, { text: 'two', styleOverride: bold }],
			[{ text: 'three' }],
		]);
		expect(normalizeRuns([{ text: '' }])).toEqual([{ text: '' }]);
	});

	it('reports only formatting shared by the whole range', () => {
		let runs = styleRange(plain('ab'), 0, 2, { italic: true });
		runs = styleRange(runs, 0, 1, bold);
		expect(rangeOverride(runs, 0, 2)).toEqual({ italic: true });
		expect(rangeOverride(runs, 0, 1)).toEqual({ italic: true, bold: true });
	});
});
