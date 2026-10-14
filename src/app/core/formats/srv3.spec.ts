import { cueText } from '../model/cue';
import { createProject } from '../model/defaults';
import { sampleProject } from '../testing/fixtures';
import {
	exportSrv3,
	srv3Weight,
	fromYtCoord,
	fromYtSize,
	importSrv3,
	toYtCoord,
	toYtSize,
} from './srv3';

describe('SRV3 coordinate and size corrections', () => {
	it('inverts YouTube position squeeze', () => {
		expect(toYtCoord(2)).toBe(0);
		expect(toYtCoord(98)).toBe(100);
		expect(toYtCoord(50)).toBe(50);
		expect(toYtCoord(0)).toBe(0); // clamped
		expect(fromYtCoord(toYtCoord(26))).toBeCloseTo(26, 0);
	});

	it('inverts YouTube size compression', () => {
		expect(toYtSize(1)).toBe(100);
		expect(toYtSize(1.25)).toBe(200);
		expect(toYtSize(0.5)).toBe(0); // can't go below 0.75 rendered
		expect(fromYtSize(200)).toBe(1.25);
	});
});

describe('SRV3 export', () => {
	const { xml, stats } = exportSrv3(sampleProject());

	it('matches golden output', () => {
		expect(xml).toBe(
			[
				'<?xml version="1.0" encoding="utf-8"?>',
				'<timedtext format="3">',
				'<head>',
				'<pen id="0" sz="100" fc="#FFFFFF" fo="255" bc="#080808" bo="191" />',
				'<pen id="1" sz="100" b="1" fc="#FFFF00" fo="255" bc="#080808" bo="191" et="3" ec="#000000" />',
				'<pen id="2" sz="100" i="1" fc="#FFFFFF" fo="255" bc="#080808" bo="191" />',
				'<pen id="3" sz="100" fc="#FFFF00" fo="255" bc="#080808" bo="191" />',
				'<ws id="0" ju="2" pd="0" sd="0" />',
				'<ws id="1" ju="0" pd="0" sd="0" />',
				'<wp id="0" ap="7" ah="50" av="100" />',
				'<wp id="1" ap="0" ah="8" av="3" />',
				'</head>',
				'<body>',
				'<p t="1" d="1999" p="0" wp="0" ws="0">Hello &amp; welcome</p>',
				'<p t="1000" d="2000" p="1" wp="1" ws="1">ON SCREEN</p>',
				'<p t="2500" d="1500" wp="0" ws="0"><s p="0">This is </s>\u200B<s p="2">important</s></p>',
				'<p t="5000" d="500" wp="0" ws="0"><s p="3">la</s>\u200B<s p="0"> la la</s></p>',
				'<p t="5500" d="500" wp="0" ws="0"><s p="3">la la</s>\u200B<s p="0"> la</s></p>',
				'<p t="6000" d="500" p="3" wp="0" ws="0">la la la</p>',
				'</body>',
				'</timedtext>',
				'',
			].join('\n'),
		);
	});

	it('reports stats', () => {
		expect(stats.lines).toBe(6);
		expect(stats.sections).toBe(9);
		expect(stats.weight).toBeGreaterThan(0);
		expect(stats.weight).toBeLessThan(0.01);
	});

	it('weighs the project the same as the export does, without writing it', () => {
		expect(srv3Weight(sampleProject())).toBe(stats.weight);
	});

	it('drops zero-length lines', () => {
		const p = createProject();
		p.tracks[0].cues = [{ id: 'z', start: 0, end: 1, runs: [{ text: 'x' }] }];
		expect(exportSrv3(p).xml).not.toContain('<p ');
	});
});

describe('SRV3 import', () => {
	it('round-trips text, timing, styles and positions', () => {
		const original = sampleProject();
		original.tracks[2].cues[0].karaoke = false; // karaoke expands to multiple lines
		const { xml } = exportSrv3(original);
		const imported = importSrv3(xml);
		expect(imported.warnings).toEqual([]);

		const p = createProject();
		p.styles = imported.styles!;
		p.positions = imported.positions!;
		p.tracks[0].cues = imported.cues;
		expect(imported.cues.map((c) => cueText(c))).toEqual([
			'Hello & welcome',
			'ON SCREEN',
			'This is important',
			'la la la',
		]);
		expect(imported.cues[2].runs[1]).toEqual({
			text: 'important',
			styleOverride: { italic: true },
		});
		const sign = imported.cues[1];
		expect(p.styles[sign.styleId!]).toMatchObject({
			bold: true,
			textColor: '#FFFF00',
			edge: 'glow',
		});
		expect(p.positions[sign.positionId!]).toMatchObject({ anchor: 0, align: 'left' });
		expect(p.positions[sign.positionId!].x).toBeCloseTo(10, 0);

		expect(exportSrv3(p).xml).toBe(xml);
	});

	it('rejects non-SRV3 input', () => {
		expect(importSrv3('<tt></tt>').warnings[0]).toMatch(/Not an SRV3/);
		expect(importSrv3('not xml').warnings[0]).toMatch(/not valid XML/);
	});

	it('uses YouTube defaults for missing attributes', () => {
		const r = importSrv3(
			'<timedtext format="3"><body><p t="100" d="900">hi</p></body></timedtext>',
		);
		const style = r.styles![r.cues[0].styleId!];
		expect(style).toMatchObject({ textColor: '#FFFFFF', bgColor: '#080808', scale: 1 });
		expect(r.positions![r.cues[0].positionId!]).toMatchObject({
			anchor: 7,
			x: 50,
			align: 'center',
		});
	});
});
