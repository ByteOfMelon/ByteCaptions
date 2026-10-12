import { createCue, createProject } from '../model/defaults';
import { planPaste } from './paste';

// Cues at 1000–2000 and 2500–4000
function tracks() {
	const p = createProject();
	p.tracks[0].id = 't1';
	p.tracks[0].cues = [createCue(1000, 2000, 'a'), createCue(2500, 4000, 'b')];

	return p.tracks;
}

describe('planPaste', () => {
	it('pastes at the playhead when there is room', () => {
		expect(planPaste([{ track: 't1', start: 0, end: 500 }], tracks(), 0)).toEqual([
			{ start: 0, end: 500 },
		]);
	});

	it('trims a paste into a gap that is too short', () => {
		expect(planPaste([{ track: 't1', start: 0, end: 800 }], tracks(), 2100)).toEqual([
			{ start: 2100, end: 2500 },
		]);
	});

	it('moves a paste on top of a cue to the first gap that fits it', () => {
		expect(planPaste([{ track: 't1', start: 0, end: 400 }], tracks(), 1500)).toEqual([
			{ start: 2000, end: 2400 },
		]);
		expect(planPaste([{ track: 't1', start: 0, end: 800 }], tracks(), 1500)).toEqual([
			{ start: 4000, end: 4800 },
		]);
	});

	it('ignores cues on other tracks', () => {
		expect(planPaste([{ track: 'other', start: 0, end: 800 }], tracks(), 1500)).toEqual([
			{ start: 1500, end: 2300 },
		]);
	});
});
