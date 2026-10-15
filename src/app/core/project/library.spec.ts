import { defaultStyle } from '../model/defaults';
import {
	importNames,
	parseLibrary,
	sameLook,
	serializeLibrary,
	uniqueName,
	withUniqueNames,
} from './library';

const dialogue = { ...defaultStyle(), name: 'Dialogue', bold: true, textColor: '#FFFF00' };

describe('preset library files', () => {
	it('round-trips presets', () => {
		expect(parseLibrary(serializeLibrary([dialogue]))).toEqual([dialogue]);
	});

	it('rejects files that are not a library', () => {
		expect(() => parseLibrary('not json')).toThrow(/isn't a ByteCaptions preset library/);
		expect(() => parseLibrary('{"tracks":[]}')).toThrow(/isn't a ByteCaptions preset library/);
	});

	it('rejects libraries from a newer version', () => {
		const file = JSON.stringify({ format: 'bytecaptions-library', version: 99, styles: [] });

		expect(() => parseLibrary(file)).toThrow(/newer version/);
	});

	it('fills in missing or wrong fields and drops presets without a name', () => {
		const file = JSON.stringify({
			format: 'bytecaptions-library',
			version: 1,
			styles: [{ name: 'Sign', bold: 'yes', scale: 1.5, extra: 1 }, { bold: true }, null],
		});

		expect(parseLibrary(file)).toEqual([{ ...defaultStyle(), name: 'Sign', scale: 1.5 }]);
	});
});

describe('uniqueName', () => {
	it('keeps a free name', () => {
		expect(uniqueName('Dialogue', ['Default'])).toBe('Dialogue');
	});

	it('numbers a taken name', () => {
		expect(uniqueName('Dialogue', ['Dialogue'])).toBe('Dialogue 2');
		expect(uniqueName('Dialogue', ['Dialogue', 'Dialogue 2'])).toBe('Dialogue 3');
	});

	it('counts on from a number already in the name', () => {
		expect(uniqueName('Dialogue 2', ['Dialogue', 'Dialogue 2'])).toBe('Dialogue 3');
	});

	it('ignores case', () => {
		expect(uniqueName('dialogue', ['Dialogue'])).toBe('dialogue 2');
	});
});

describe('withUniqueNames', () => {
	it('renames against existing names and each other', () => {
		const names = withUniqueNames([dialogue, dialogue], ['Dialogue']).map((s) => s.name);

		expect(names).toEqual(['Dialogue 2', 'Dialogue 3']);
	});

	it('copies, leaving the originals unchanged', () => {
		const [copy] = withUniqueNames([dialogue], []);
		copy.bold = false;

		expect(dialogue.bold).toBe(true);
	});
});

describe('importNames', () => {
	const sign = { ...defaultStyle(), name: 'Sign' };

	it('keeps names that are free in the project', () => {
		expect(importNames([sign], () => true, ['Default'])).toEqual(['Sign']);
	});

	it('numbers a name the project already has', () => {
		expect(importNames([dialogue], () => true, ['Dialogue'])).toEqual(['Dialogue 2']);
	});

	it('avoids names given to earlier selected presets only', () => {
		const styles = [dialogue, { ...dialogue }, { ...dialogue }];

		expect(importNames(styles, (i) => i !== 1, ['Dialogue'])).toEqual([
			'Dialogue 2',
			'Dialogue 3',
			'Dialogue 3',
		]);
	});
});

describe('sameLook', () => {
	it('ignores the name', () => {
		expect(sameLook(dialogue, { ...dialogue, name: 'Other' })).toBe(true);
	});

	it('notices any other difference', () => {
		expect(sameLook(dialogue, { ...dialogue, bgOpacity: 0.5 })).toBe(false);
	});
});
