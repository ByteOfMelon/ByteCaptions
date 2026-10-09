import { WordTiming } from './types';
import { moveWordEdge, retimeWords, spreadWords, tappedWords } from './words';

const w = (text: string, start: number, end: number): WordTiming => ({ text, start, end });
const words = [w('the', 0, 100), w('big', 100, 300), w('cat', 300, 600)];

describe('spreadWords', () => {
	it('shares the time by word length, with no gaps', () => {
		expect(spreadWords(['a', 'bcd'], 0, 600)).toEqual([w('a', 0, 200), w('bcd', 200, 600)]);
	});
});

describe('retimeWords', () => {
	it('keeps every timing when only a word is fixed', () => {
		expect(retimeWords(words, 'the bog cat', 0, 600)).toEqual([
			w('the', 0, 100),
			w('bog', 100, 300),
			w('cat', 300, 600),
		]);
	});

	it('gives a deleted word’s time to the word before it', () => {
		expect(retimeWords(words, 'the cat', 0, 600)).toEqual([
			w('the', 0, 300),
			w('cat', 300, 600),
		]);
	});

	it('gives a deleted first word’s time to the next word', () => {
		expect(retimeWords(words, 'big cat', 0, 600)).toEqual([
			w('big', 0, 300),
			w('cat', 300, 600),
		]);
	});

	it('splits the word before an added word', () => {
		expect(retimeWords(words, 'the big fat cat', 0, 600)).toEqual([
			w('the', 0, 100),
			w('big', 100, 200),
			w('fat', 200, 300),
			w('cat', 300, 600),
		]);
	});

	it('splits the next word for a word added at the start', () => {
		expect(retimeWords(words, 'so the big cat', 0, 600)).toEqual([
			w('so', 0, 43),
			w('the', 43, 100),
			w('big', 100, 300),
			w('cat', 300, 600),
		]);
	});

	it('spreads text with no timings, and returns null for no words', () => {
		expect(retimeWords([], 'a bcd', 0, 600)).toEqual([w('a', 0, 200), w('bcd', 200, 600)]);
		expect(retimeWords(words, '  ', 0, 600)).toBeNull();
	});
});

describe('moveWordEdge', () => {
	it('moves the line between touching words', () => {
		expect(moveWordEdge(words, 2, 400, 10)).toEqual([
			w('the', 0, 100),
			w('big', 100, 400),
			w('cat', 400, 600),
		]);
	});

	it('keeps each word at least the minimum long', () => {
		expect(moveWordEdge(words, 1, -50, 10)[1].start).toBe(10);
	});
});

describe('tappedWords', () => {
	it('times tapped words and shares the rest of the cue', () => {
		expect(tappedWords(['the', 'big', 'cat'], [0, 100], 0, 600)).toEqual([
			w('the', 0, 100),
			w('big', 100, 350),
			w('cat', 350, 600),
		]);
	});
});
