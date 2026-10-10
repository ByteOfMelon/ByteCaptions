import { createCue, createProject, createTrack } from '../model/defaults';
import { Project } from '../model/types';

/** Small two-track project exercising styles, positions, runs and karaoke */
export function sampleProject(): Project {
	const p = createProject('Sample');
	p.styles['style_yellow'] = {
		...p.styles['style_default'],
		name: 'Yellow bold',
		bold: true,
		textColor: '#FFFF00',
		edge: 'glow',
		edgeColor: '#000000',
	};
	p.positions['pos_top'] = {
		name: 'Top left',
		anchor: 0,
		x: 10,
		y: 5,
		align: 'left',
		direction: 'horizontal',
	};

	const dialogue = p.tracks[0];
	dialogue.id = 'trk_dialogue';
	dialogue.cues = [
		{ ...createCue(0, 2000, 'Hello & welcome'), id: 'c1' },
		{
			...createCue(2500, 4000, ''),
			id: 'c2',
			runs: [{ text: 'This is ' }, { text: 'important', styleOverride: { italic: true } }],
		},
	];

	const sign = createTrack('Signs', '#FF8C42');
	sign.id = 'trk_signs';
	sign.defaultStyleId = 'style_yellow';
	sign.defaultPositionId = 'pos_top';
	sign.cues = [{ ...createCue(1000, 3000, 'ON SCREEN'), id: 's1' }];

	const lyrics = createTrack('Lyrics', '#B06CFF');
	lyrics.id = 'trk_lyrics';
	lyrics.cues = [
		{
			...createCue(5000, 6500, 'la la la'),
			id: 'k1',
			karaoke: true,
			words: [
				{ text: 'la', start: 5000, end: 5400 },
				{ text: 'la', start: 5500, end: 5900 },
				{ text: 'la', start: 6000, end: 6400 },
			],
		},
	];

	p.tracks.push(sign, lyrics);
	return p;
}
