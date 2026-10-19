import { createCue } from './defaults';
import { freeSpan } from './cue';

const cues = [createCue(0, 1000, 'a'), createCue(1500, 3000, 'b'), createCue(3000, 4000, 'c')];
const frame = 1000 / 30;

describe('freeSpan', () => {
	it('uses the wanted length when there is room', () => {
		expect(freeSpan(cues, 5000, 2000, frame)).toEqual({ start: 5000, end: 7000 });
	});

	it('stops at the next cue', () => {
		expect(freeSpan(cues, 1100, 2000, frame)).toEqual({ start: 1100, end: 1500 });
	});

	it('starts after a cue it lands in, skipping touching cues', () => {
		expect(freeSpan(cues, 2000, 2000, frame)).toEqual({ start: 4000, end: 6000 });
	});

	it('stops at the end of the video', () => {
		expect(freeSpan(cues, 4500, 2000, frame, 5000)).toEqual({ start: 4500, end: 5000 });
	});

	it('gives nothing when there is less than a frame free', () => {
		expect(freeSpan(cues, 1490, 2000, frame)).toBeNull();
		expect(freeSpan(cues, 4990, 2000, frame, 5000)).toBeNull();
	});
});
