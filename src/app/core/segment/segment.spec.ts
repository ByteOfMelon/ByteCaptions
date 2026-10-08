import { cueText } from '../model/cue';
import { defaultSettings } from '../model/defaults';
import { WordTiming } from '../model/types';
import { layoutLines, segmentWords } from './segment';

const limits = defaultSettings();

/** Words spoken back to back at `ms` each, starting at `from`. "|" marks a 1 s pause. */
function speak(text: string, from = 0, ms = 300): WordTiming[] {
	const out: WordTiming[] = [];
	let t = from;
	for (const token of text.split(' ')) {
		if (token === '|') {
			t += 1000;
			continue;
		}
		out.push({ text: token, start: t, end: t + ms - 20 });
		t += ms;
	}
	return out;
}

const texts = (words: WordTiming[], l = limits) => segmentWords(words, l).map(cueText);

describe('segmentWords', () => {
	it('keeps a short phrase in one cue on one line', () => {
		const [cue, ...rest] = segmentWords(speak('Hello there everyone'), limits);
		expect(rest).toEqual([]);
		expect(cueText(cue)).toBe('Hello there everyone');
		expect(cue.start).toBe(0);
		expect(cue.words?.length).toBe(3);
	});

	it('starts a new cue after a pause', () => {
		expect(texts(speak('First part | second part'))).toEqual(['First part', 'second part']);
	});

	it('starts a new cue at a sentence end', () => {
		expect(texts(speak('This is the first sentence. And this is the second one.'))).toEqual([
			'This is the first sentence.',
			'And this is the second one.',
		]);
	});

	it('keeps a very short sentence with the next one', () => {
		const [first] = texts(speak('Yes. That is exactly what I meant to say'));
		expect(first.startsWith('Yes. That')).toBe(true);
	});

	it('never exceeds the line and line-count limits', () => {
		const long =
			'so what we are going to do today is take a look at how the whole thing works from ' +
			'start to finish and then we will talk about what could have been done differently ' +
			'and why it matters for everyone who plays games like this one on a regular basis';
		for (const text of texts(speak(long))) {
			const lines = text.split('\n');
			expect(lines.length).toBeLessThanOrEqual(limits.maxLines);
			for (const line of lines)
				expect(line.length).toBeLessThanOrEqual(limits.maxCharsPerLine);
		}
	});

	it('prefers breaking after a comma when splitting a long passage', () => {
		const cues = texts(
			speak(
				'When the game finally launched after years of delays and promises, ' +
					'players found something very different from what was shown',
			),
		);
		expect(cues[0].replace(/\n/g, ' ').endsWith('promises,')).toBe(true);
	});

	it('splits cues that would run past the max duration', () => {
		const slow = speak('one two three four five six', 0, 2000);
		for (const cue of segmentWords(slow, limits)) {
			expect(cue.end - cue.start).toBeLessThanOrEqual(limits.maxDurationMs);
		}
	});

	it('lengthens short cues into the silence after them, but keeps the gap', () => {
		const words = [
			{ text: 'Hi', start: 0, end: 200 },
			{ text: 'there', start: 2000, end: 2300 },
		];
		const [a, b] = segmentWords(words, limits);
		expect(a.end).toBe(limits.minDurationMs);
		expect(b.start - a.end).toBeGreaterThanOrEqual(limits.minGapMs);
	});

	it('trims a cue to keep the minimum gap before the next', () => {
		const words = [
			{ text: 'End.', start: 0, end: 1000 },
			{ text: 'Next', start: 1020, end: 1500 },
		];
		const [a, b] = segmentWords(words, { ...limits, minDurationMs: 500 });
		expect(b.start - a.end).toBe(limits.minGapMs);
	});

	it('ignores empty words and sorts by time', () => {
		const words = [
			{ text: 'world', start: 300, end: 500 },
			{ text: ' ', start: 200, end: 250 },
			{ text: ' hello ', start: 0, end: 200 },
		];
		expect(texts(words)).toEqual(['hello world']);
	});

	it('returns nothing for no words', () => {
		expect(segmentWords([], limits)).toEqual([]);
	});
});

describe('layoutLines', () => {
	it('balances two lines', () => {
		const lines = layoutLines(
			speak('this sentence is long enough that it needs two lines to fit'),
			limits,
		);
		expect(lines.length).toBe(2);
		expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThan(12);
	});

	it('breaks lines after punctuation when it can', () => {
		const lines = layoutLines(
			speak('We tried everything we could, but it still did not work'),
			{
				...limits,
				maxCharsPerLine: 40,
			},
		);
		expect(lines).toEqual(['We tried everything we could,', 'but it still did not work']);
	});
});
