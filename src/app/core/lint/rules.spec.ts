import { createCue, createProject } from '../model/defaults';
import { lintProject, readingSpeed } from './rules';

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
		const [a] = lintProject(project(createCue(0, 2000, 'One'), createCue(1500, 3000, 'Two')));
		expect(a.kind).toBe('overlap');
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
});
