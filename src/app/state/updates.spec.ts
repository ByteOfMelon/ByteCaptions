import { releaseNotes } from './updates';

describe('releaseNotes', () => {
	it('keeps only the text above the downloads section', () => {
		expect(releaseNotes('Adds auto-update.\n\n## Downloads\n\n| a | b |')).toBe(
			'Adds auto-update.',
		);
	});

	it('drops the unedited placeholder line', () => {
		expect(
			releaseNotes(
				'_Replace this line with the release notes before publishing._\n\n## Downloads\n',
			),
		).toBe('');
	});

	it('keeps notes with no downloads section as they are', () => {
		expect(releaseNotes('  Fixes a crash.  ')).toBe('Fixes a crash.');
	});
});
