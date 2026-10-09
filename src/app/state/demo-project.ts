import { DEFAULT_STYLE_ID, createCue, createProject, createTrack } from '../core/model/defaults';
import { Cue, Project, WordTiming } from '../core/model/types';

/** Words the mock "transcriber" was unsure about, to exercise low-confidence UI. */
const LOW_CONFIDENCE = new Set(['Projekt', 'Sony', '2020.', 'E3']);

/** Spread words across the cue proportionally to their length, like ASR output would. */
function estimateWords(cue: Cue): WordTiming[] {
	const words = cue.runs
		.map((r) => r.text)
		.join('')
		.split(/\s+/)
		.filter(Boolean);
	const total = words.reduce((n, w) => n + w.length + 1, 0);
	let t = cue.start;
	return words.map((text) => {
		const d = ((text.length + 1) / total) * (cue.end - cue.start);
		const w: WordTiming = {
			text,
			start: Math.round(t),
			end: Math.round(t + d),
			confidence: LOW_CONFIDENCE.has(text) ? 0.42 : 0.95,
		};
		t += d;
		return w;
	});
}

/** HH:MM:SS:FF at 60 fps → ms. */
function tc(s: string): number {
	const [h, m, sec, f] = s.split(':').map(Number);
	return Math.round(((h * 60 + m) * 60 + sec) * 1000 + (f * 1000) / 60);
}

const DIALOGUE: [string, string, string][] = [
	['00:00:01:00', '00:00:03:30', 'Cyberpunk 2077 had one of the'],
	['00:00:03:40', '00:00:06:10', 'most infamous launches in gaming history.'],
	['00:00:06:30', '00:00:09:00', 'Crashes, missing features,'],
	['00:00:09:10', '00:00:12:20', 'and a refund program from Sony itself.'],
	['00:00:13:00', '00:00:15:40', 'But a lot has changed since then.'],
	['00:00:16:00', '00:00:19:00', 'Patches, an anime, and an expansion'],
	['00:00:19:10', '00:00:22:30', 'turned the game into something else entirely.'],
	['00:00:23:00', '00:00:26:00', 'So how did we get here?'],
	['00:00:26:20', '00:00:28:40', 'And more importantly,'],
	['00:00:28:50', '00:00:31:00', '…since the game’s launch'],
	['00:00:31:02', '00:00:33:18', 'Has CD Projekt Red finally'],
	['00:00:33:20', '00:00:36:04', 'fixed Cyberpunk 2077? If so,'],
	['00:00:38:05', '00:00:41:22', 'what does this mean for the\ngaming industry going forward?'],
	['00:00:42:00', '00:00:42:20', "Today, let's dive into"],
	['00:00:43:02', '00:00:45:11', 'the legacy of Cyberpunk 2077.'],
	['00:00:47:30', '00:00:51:20', 'The story of Cyberpunk 2077 starts in 2012.'],
	['00:00:52:00', '00:00:55:10', 'CD Projekt Red announced a new RPG'],
	['00:00:55:20', '00:00:58:40', 'based on the tabletop game Cyberpunk 2020.'],
	['00:00:59:00', '00:01:02:30', 'At the time, the studio was best known for'],
	['00:01:02:40', '00:01:05:50', 'The Witcher series.'],
	['00:01:06:10', '00:01:09:40', 'The Witcher 3 would go on to win'],
	['00:01:09:50', '00:01:13:00', 'over 250 Game of the Year awards.'],
	['00:01:13:30', '00:01:17:00', 'Expectations for their next game were sky high.'],
	['00:01:17:20', '00:01:20:40', 'Then came the 2018 E3 demo.'],
	['00:01:21:00', '00:01:24:30', 'Forty-eight minutes of gameplay shown behind closed doors.'],
];

const SFX: [string, string, string][] = [
	['00:00:00:00', '00:00:01:00', '[upbeat intro music]'],
	['00:00:36:10', '00:00:38:01', '[synth sting]'],
	['00:00:45:15', '00:00:47:05', '[synth music]'],
	['00:01:16:00', '00:01:17:10', '[crowd cheering]'],
];

/** Sample project mirroring the Penpot editor mockups; the editor starts with it. */
export function demoProject(): Project {
	const p = createProject('legacy-of-cyberpunk-2077');
	p.fps = 60;
	p.media = { path: '', hash: '', durationMs: tc('00:17:41:00'), width: 1920, height: 1080 };
	p.styles[DEFAULT_STYLE_ID] = { ...p.styles[DEFAULT_STYLE_ID], name: 'Dialogue' };
	p.styles['style_sfx'] = { ...p.styles[DEFAULT_STYLE_ID], name: 'Sound effect', italic: true };
	p.styles['style_speaker2'] = {
		...p.styles[DEFAULT_STYLE_ID],
		name: 'Speaker 2',
		textColor: '#FFFF00',
	};
	p.styles['style_lyrics'] = {
		...p.styles[DEFAULT_STYLE_ID],
		name: 'Song lyrics',
		italic: true,
		textColor: '#00FFFF',
	};
	p.positions['pos_bottom'] = { ...p.positions['pos_bottom'], y: 90 };

	const dialogue = p.tracks[0];
	dialogue.id = 'trk_dialogue';
	dialogue.name = 'Dialogue';
	dialogue.color = '#4a6fa5';
	dialogue.cues = DIALOGUE.map(([a, b, text], i) => {
		const cue = { ...createCue(tc(a), tc(b), text), id: `d${i + 1}` };
		return { ...cue, words: estimateWords(cue) };
	});

	const sfx = createTrack('Sound effects', '#7e60a6');
	sfx.id = 'trk_sfx';
	sfx.defaultStyleId = 'style_sfx';
	sfx.cues = SFX.map(([a, b, text], i) => ({
		...createCue(tc(a), tc(b), text),
		id: `s${i + 1}`,
	}));

	p.tracks.push(sfx);
	return p;
}
