import { createCue, createTrack } from '../model/defaults';
import { Cue } from '../model/types';
import { SpeakerTurn, UNSURE_BELOW, assignSpeakers, splitBySpeaker } from './speakers';

/** A cue with one 300 ms word per token, starting at `from`. */
function cue(text: string, from: number): Cue {
	const tokens = text.split(' ');
	const c = createCue(from, from + tokens.length * 300, text);
	c.words = tokens.map((t, i) => ({ text: t, start: from + i * 300, end: from + i * 300 + 280 }));

	return c;
}

const turns: SpeakerTurn[] = [
	{ start: 0, end: 3000, speaker: 0 },
	{ start: 3000, end: 6000, speaker: 1 },
	{ start: 6000, end: 9000, speaker: 0 },
];

describe('assignSpeakers', () => {
	it('gives each cue the speaker its words overlap most', () => {
		const cues = [cue('one two three four', 0), cue('five six seven eight', 3200)];
		expect(assignSpeakers(cues, turns)).toEqual([
			{ speaker: 0, purity: 1 },
			{ speaker: 1, purity: 1 },
		]);
	});

	it('reports a mixed cue as impure', () => {
		const [g] = assignSpeakers([cue('a b c d e f', 2100)], turns);
		expect(g.purity).toBeLessThan(UNSURE_BELOW);
	});

	it('falls back to the nearest turn when nothing overlaps', () => {
		const [g] = assignSpeakers([cue('late', 9500)], turns);
		expect(g).toEqual({ speaker: 0, purity: 0 });
	});

	it('moves a short unsure fragment to the speaker around it, and flags it', () => {
		const cues = [
			cue('so we went to', 1800),
			cue('yeah', 3100),
			cue('the shop and then', 3500),
		];
		const t: SpeakerTurn[] = [
			{ start: 0, end: 3150, speaker: 0 },
			{ start: 3150, end: 3450, speaker: 1 },
			{ start: 3450, end: 5000, speaker: 0 },
		];
		const g = assignSpeakers(cues, t);
		expect(g.map((x) => x.speaker)).toEqual([0, 0, 0]);
		expect(g[1].purity).toBeLessThan(UNSURE_BELOW);
	});
});

describe('assignSpeakers with a detected count', () => {
	it('folds a speaker with only a stray cue or two into the others', () => {
		const cues = Array.from({ length: 10 }, (_, i) => cue('word word', i * 1000));
		const t: SpeakerTurn[] = [
			{ start: 0, end: 5000, speaker: 0 },
			{ start: 5000, end: 6000, speaker: 2 },
			{ start: 6000, end: 10000, speaker: 1 },
		];
		const kept = assignSpeakers(cues, t);
		expect(kept[5].speaker).toBe(2);
		const folded = assignSpeakers(cues, t, { foldMinor: true });
		expect(new Set(folded.map((g) => g.speaker))).toEqual(new Set([0, 1]));
		expect(folded[5].purity).toBeLessThan(UNSURE_BELOW);
	});
});

describe('splitBySpeaker', () => {
	it('makes a track per speaker, most talkative first, copying the source track', () => {
		const source = createTrack('Transcript');
		source.defaultStyleId = 'sty_x';
		source.cues = [cue('a', 0), cue('b c d e f g', 1000), cue('h', 4000)];
		const split = splitBySpeaker(
			source,
			[
				{ speaker: 0, purity: 1 },
				{ speaker: 1, purity: 1 },
				{ speaker: 0, purity: 0.5 },
			],
			['red', 'blue'],
		);
		expect(split.tracks.map((t) => [t.name, t.color, t.cues.length])).toEqual([
			['Speaker 1', 'red', 1],
			['Speaker 2', 'blue', 2],
		]);
		expect(split.tracks[0].defaultStyleId).toBe('sty_x');
		expect(split.tracks[1].cues[1].speakerUnsure).toBe(true);
		expect(split.unsure).toBe(1);
		expect(split.samples).toEqual([source.cues[1].id, source.cues[0].id]);
	});
});
