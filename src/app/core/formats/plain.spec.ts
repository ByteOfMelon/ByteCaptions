import { sampleProject } from '../testing/fixtures';
import { createCue, createProject } from '../model/defaults';
import { exportSbv, exportSrt, importSbv, importSrt, importVtt } from './plain';
import { exportVtt } from './vtt';
import { styleRange } from '../model/runs';
import { sniffFormat } from './index';

describe('SRT', () => {
	it('exports all visible tracks in time order', () => {
		expect(exportSrt(sampleProject())).toBe(
			[
				'1\n00:00:00,000 --> 00:00:02,000\nHello & welcome\n',
				'2\n00:00:01,000 --> 00:00:03,000\n<b>ON SCREEN</b>\n',
				'3\n00:00:02,500 --> 00:00:04,000\nThis is important\n',
				'4\n00:00:05,000 --> 00:00:06,500\nla la la\n',
			].join('\n'),
		);
	});

	it('skips muted tracks and honors solo', () => {
		const p = sampleProject();
		p.tracks[1].muted = true;
		expect(exportSrt(p)).not.toContain('ON SCREEN');
		p.tracks[1].muted = false;
		p.tracks[2].solo = true;
		expect(exportSrt(p)).toBe('1\n00:00:05,000 --> 00:00:06,500\nla la la\n');
	});

	it('imports with CRLF, BOM, tags and multi-line text', () => {
		const src =
			'\uFEFF1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>Line one</i>\r\nLine two\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,250\r\nNext\r\n';
		const { cues, warnings } = importSrt(src);
		expect(warnings).toEqual([]);
		expect(cues.map((c) => [c.start, c.end, c.runs[0].text])).toEqual([
			[1500, 3000, 'Line one\nLine two'],
			[60000, 62250, 'Next'],
		]);
	});

	it('round-trips', () => {
		const out = exportSrt(sampleProject(), { basicTags: false });
		const back = createProject();
		back.tracks[0].cues = importSrt(out).cues;
		expect(exportSrt(back, { basicTags: false })).toBe(out);
	});
});

describe('WebVTT', () => {
	it('exports header, escaping and non-default positions', () => {
		const vtt = exportVtt(sampleProject());
		expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
		expect(vtt).toContain('Hello &amp; welcome');
		expect(vtt).toMatch(
			/00:00:01\.000 --> 00:00:03\.000 line:5% position:10% align:start\n<v Signs><c\.s\d+><b>ON SCREEN<\/b><\/c>/,
		);
	});

	it('keeps formatting on part of a line, with a class per look', () => {
		const p = sampleProject();
		const cue = createCue(0, 1000, 'big red dog');
		cue.runs = styleRange(cue.runs, 4, 7, { bold: true, textColor: '#FF0000' });
		p.tracks = [{ ...p.tracks[0], cues: [cue] }];
		const vtt = exportVtt(p);
		expect(vtt).toMatch(/<c\.s1>big <\/c><c\.s2><b>red<\/b><\/c><c\.s1> dog<\/c>/);
		expect(vtt).toContain('::cue(.s2) { color: rgba(255, 0, 0, 1)');
		expect(vtt).not.toContain('<v ');
	});

	it('writes karaoke as timestamp tags', () => {
		const p = sampleProject();
		const cue = {
			...createCue(1000, 2000, 'big red'),
			karaoke: true,
			words: [
				{ text: 'big', start: 1000, end: 1300 },
				{ text: 'red', start: 1300, end: 2000 },
			],
		};
		p.tracks = [{ ...p.tracks[0], cues: [cue] }];
		const vtt = exportVtt(p, { styles: false });
		expect(vtt).toContain('\n<c>big</c><00:00:01.300><c> red</c>\n');
		expect(vtt).not.toContain('STYLE');
	});

	it('imports and ignores NOTE/STYLE blocks', () => {
		const src =
			'WEBVTT\n\nSTYLE\n::cue { color: red }\n\nNOTE hi\n\nid1\n00:01.000 --> 00:02.500 line:10%\n<v Bob>Hi &amp; bye</v>\n';
		const { cues, warnings } = importVtt(src);
		expect(cues.map((c) => [c.start, c.end, c.runs[0].text])).toEqual([
			[1000, 2500, 'Hi & bye'],
		]);
		expect(warnings).toContain('VTT STYLE blocks were ignored');
	});
});

describe('SBV', () => {
	it('round-trips', () => {
		const sbv = exportSbv(sampleProject());
		expect(sbv.split('\n')[0]).toBe('0:00:00.000,0:00:02.000');
		const back = createProject();
		back.tracks[0].cues = importSbv(sbv).cues;
		expect(exportSbv(back)).toBe(sbv);
	});
});

describe('sniffFormat', () => {
	it('detects each format', () => {
		expect(sniffFormat('WEBVTT\n')?.id).toBe('vtt');
		expect(sniffFormat('1\n00:00:01,000 --> 00:00:02,000\nx')?.id).toBe('srt');
		expect(sniffFormat('0:00:01.000,0:00:02.000\nx')?.id).toBe('sbv');
		expect(sniffFormat('<?xml version="1.0"?><timedtext format="3">')?.id).toBe('srv3');
		expect(sniffFormat('hello')).toBeUndefined();
	});
});
