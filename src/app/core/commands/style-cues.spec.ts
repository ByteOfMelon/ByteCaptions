import { produce } from 'immer';
import { sampleProject } from '../testing/fixtures';
import { styleCues } from './edits';

const cue = (p: ReturnType<typeof sampleProject>, id: string) =>
	p.tracks.flatMap((t) => t.cues).find((c) => c.id === id)!;

describe('styleCues', () => {
	it('formats only the chosen cue and leaves the preset alone', () => {
		const before = sampleProject();
		const after = produce(before, styleCues(['c1'], { textColor: '#FF0000' }));

		expect(cue(after, 'c1').runs).toEqual([
			{ text: 'Hello & welcome', styleOverride: { textColor: '#FF0000' } },
		]);
		expect(after.styles).toEqual(before.styles);
		expect(cue(after, 'c2')).toEqual(cue(before, 'c2'));
	});

	it('keeps existing word formatting', () => {
		const after = produce(sampleProject(), styleCues(['c2'], { bold: true }));

		expect(cue(after, 'c2').runs).toEqual([
			{ text: 'This is ', styleOverride: { bold: true } },
			{ text: 'important', styleOverride: { italic: true, bold: true } },
		]);
	});

	it("drops the override when set back to the preset's value", () => {
		const red = produce(sampleProject(), styleCues(['c1'], { textColor: '#FF0000' }));
		const back = produce(red, styleCues(['c1'], { textColor: '#FFFFFF' }));

		expect(cue(back, 'c1').runs).toEqual([{ text: 'Hello & welcome' }]);
	});

	it('clears all formatting back to the preset', () => {
		const after = produce(sampleProject(), styleCues(['c2'], 'clear'));

		expect(cue(after, 'c2').runs).toEqual([{ text: 'This is important' }]);
	});
});
