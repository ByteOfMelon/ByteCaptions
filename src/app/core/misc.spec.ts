import { sampleProject } from './testing/fixtures';
import { SCHEMA_VERSION } from './model/types';
import { parseProject, serializeProject } from './project/serialize';
import { formatClock, formatTimecode, parseTime, snapToFrame } from './time/timecode';
import { formatBytes, formatLength, formatSpan } from './units/units';

describe('timecode', () => {
	it('formats', () => {
		expect(formatClock(3_723_045, ',')).toBe('01:02:03,045');
		expect(formatClock(-5)).toBe('00:00:00.000');
		expect(formatTimecode(1500, 30)).toBe('00:00:01:15');
	});

	it('parses', () => {
		expect(parseTime('01:02:03,045')).toBe(3_723_045);
		expect(parseTime('02:03.5')).toBe(123_500);
		expect(parseTime('0:00:01.000')).toBe(1000);
		expect(parseTime('00:00:01:15', 30)).toBe(1500);
		expect(parseTime('nope')).toBeNull();
	});

	it('snaps to frames', () => {
		expect(snapToFrame(1010, 25)).toBe(1000);
		expect(snapToFrame(1025, 25)).toBe(1040);
	});
});

describe('project file', () => {
	it('round-trips', () => {
		const p = sampleProject();
		expect(parseProject(serializeProject(p))).toEqual(p);
	});

	it('rejects bad files with readable errors', () => {
		expect(() => parseProject('{')).toThrow(/not valid JSON/);
		expect(() => parseProject('{"schemaVersion":1}')).toThrow(/missing tracks/);
		const valid = JSON.parse(serializeProject(sampleProject()));
		expect(() => parseProject(JSON.stringify({ ...valid, styles: null }))).toThrow(
			/missing tracks/,
		);
		expect(() => parseProject(JSON.stringify({ ...valid, tracks: [null] }))).toThrow(
			/not an object/,
		);
		expect(() => parseProject(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }))).toThrow(
			/newer version/,
		);
	});

	it('fills in missing settings', () => {
		const p = sampleProject();
		const raw = JSON.parse(serializeProject(p));
		delete raw.settings.maxCps;
		expect(parseProject(JSON.stringify(raw)).settings.maxCps).toBe(20);
	});
});

describe('units', () => {
	it('formats sizes', () => {
		expect(formatBytes(0)).toBe('0 KB');
		expect(formatBytes(350_000)).toBe('350 KB');
		expect(formatBytes(999_600)).toBe('1 MB');
		expect(formatBytes(42_400_000)).toBe('42 MB');
		expect(formatBytes(1_500_000_000)).toBe('1.5 GB');
	});

	it('formats lengths as a clock', () => {
		expect(formatLength(42_000)).toBe('0:42');
		expect(formatLength(17 * 60_000 + 42_000)).toBe('17:42');
		expect(formatLength(3_725_000)).toBe('1:02:05');
	});

	it('formats spans', () => {
		expect(formatSpan(6_540)).toBe('6.5 s');
		expect(formatSpan(42_300)).toBe('42 s');
		expect(formatSpan(119_600)).toBe('2 min 0 s');
		expect(formatSpan(125_000)).toBe('2 min 5 s');
		expect(formatSpan(3_840_000)).toBe('1 h 4 min');
	});
});
