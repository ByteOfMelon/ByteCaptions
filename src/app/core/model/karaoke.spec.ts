import { exportSrv3 } from '../formats/srv3';
import { sampleProject } from '../testing/fixtures';
import { createCue } from './defaults';
import { karaokeRuns, karaokeSteps, sungAt } from './karaoke';
import { styleRange } from './runs';
import { Cue } from './types';

function song(): Cue {
	const cue: Cue = {
		...createCue(1000, 2000, 'big red\ndog'),
		karaoke: true,
		words: [
			{ text: 'big', start: 1100, end: 1300 },
			{ text: 'red', start: 1300, end: 1600 },
			{ text: 'dog', start: 1600, end: 1900 },
		],
	};
	cue.runs = styleRange(cue.runs, 0, 3, { bold: true });
	return cue;
}

describe('karaoke', () => {
	it('steps from the cue start through each word, keeping line breaks', () => {
		expect(karaokeSteps(song())).toEqual([
			{ start: 1000, end: 1300, sung: 3 },
			{ start: 1300, end: 1600, sung: 7 },
			{ start: 1600, end: 2000, sung: 11 },
		]);
	});

	it('colours sung text on top of its own formatting', () => {
		const cue = song();
		expect(sungAt(cue, 1450)).toBe(7);
		expect(karaokeRuns(cue, 7)).toEqual([
			{ text: 'big', styleOverride: { bold: true, textColor: '#FFFF00' } },
			{ text: ' red', styleOverride: { textColor: '#FFFF00' } },
			{ text: '\ndog' },
		]);
	});

	it('exports one line per word with formatting kept', () => {
		const p = sampleProject();
		p.tracks[0].cues = [{ ...song(), karaokeColor: '#00FF66' }];
		const { xml } = exportSrv3(p);
		expect(xml.match(/<p /g)?.length).toBeGreaterThanOrEqual(3);
		expect(xml).toContain('fc="#00FF66"');
		expect(xml).toContain('b="1"');
	});
});
