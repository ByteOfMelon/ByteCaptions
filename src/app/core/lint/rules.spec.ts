import { createCue, createProject } from '../model/defaults';
import { formatCps, lintPresets, lintProject, readingSpeed } from './rules';

function project(...cues: ReturnType<typeof createCue>[]) {
	const p = createProject();
	p.tracks[0].cues = cues;

	return p;
}

describe('lint', () => {
	it('computes reading speed ignoring line breaks', () => {
		expect(readingSpeed(createCue(0, 1000, 'ab\ncd'))).toBe(4);
	});

	it('is quiet for a well-formed cue', () => {
		expect(lintProject(project(createCue(0, 2000, 'Hello there')))).toEqual([]);
	});

	it('flags overlaps with a trim fix', () => {
		const two = createCue(1500, 3000, 'Two');
		const [a] = lintProject(project(createCue(0, 2000, 'One'), two));
		expect(a.kind).toBe('overlap');
		expect(a.otherCueId).toBe(two.id);
		expect(a.fix).toEqual({
			kind: 'setTiming',
			label: 'Trim to next cue',
			start: 0,
			end: 1500,
		});
	});

	it('flags fast reading speed and offers an extension when there is room', () => {
		const problems = lintProject(
			project(createCue(0, 1000, 'This line is far too long to read in a second')),
		);
		const cps = problems.find((p) => p.kind === 'cps');
		expect(cps?.fix?.kind).toBe('setTiming');
	});

	it('flags short cues', () => {
		const problems = lintProject(project(createCue(0, 300, 'Hi')));
		expect(problems.map((p) => p.kind)).toContain('tooShort');
	});

	it('flags long lines and too many lines', () => {
		const text = 'x'.repeat(50) + '\nb\nc';
		const kinds = lintProject(project(createCue(0, 6000, text))).map((p) => p.kind);
		expect(kinds).toContain('lineLength');
		expect(kinds).toContain('tooManyLines');
	});

	it('reports a preset the mobile apps draw differently once, not per cue', () => {
		const a = createCue(0, 2000, 'Hello there');
		const b = createCue(3000, 5000, 'General Kenobi');
		const p = project(a, b);
		const styleId = p.tracks[0].defaultStyleId;
		p.styles[styleId].scale = 1.5;
		p.styles[styleId].bgOpacity = 0;
		expect(lintPresets(p)).toEqual([
			{
				styleId,
				cueIds: [a.id, b.id],
				message: 'Mobile apps show 100% size and black background',
			},
		]);
		expect(lintProject(p).filter((x) => x.kind === 'mobile')).toEqual([]);
	});

	it('is quiet for presets the mobile apps draw as-is', () => {
		expect(lintPresets(project(createCue(0, 2000, 'Hello there')))).toEqual([]);
	});

	it('flags a run whose own style changes on mobile', () => {
		const cue = createCue(0, 2000, 'Hello there');
		cue.runs = [{ text: 'Hello ' }, { text: 'there', styleOverride: { scale: 2 } }];
		const [m] = lintProject(project(cue)).filter((x) => x.kind === 'mobile');
		expect(m.message).toBe('Mobile apps show 100% size');
	});

	it('does not repeat on the cue what its preset already reports', () => {
		const cue = createCue(0, 2000, 'Hello there');
		cue.runs = [
			{ text: 'Hello ' },
			{ text: 'there', styleOverride: { scale: 2, bgOpacity: 0 } },
		];
		const p = project(cue);
		p.styles[p.tracks[0].defaultStyleId].scale = 1.5;
		const mobile = lintProject(p).filter((x) => x.kind === 'mobile');
		expect(mobile.map((x) => x.message)).toEqual(['Mobile apps show black background']);
	});
});

describe('formatCps', () => {
	it('rounds up to one decimal, so a cue over the limit never reads as the limit', () => {
		expect(formatCps(20.03)).toBe('20.1');
		expect(formatCps(20.25)).toBe('20.3');
		expect(formatCps(20.3)).toBe('20.3');
		expect(formatCps(25)).toBe('25');
	});
});
