import { sampleProject } from './testing/fixtures';
import { SCHEMA_VERSION } from './model/types';
import { parseProject, serializeProject } from './project/serialize';
import { formatClock, formatTimecode, parseTime, snapToFrame } from './time/timecode';

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
