import { defaultStyle } from './defaults';
import { mobileOverride, mobileStyle } from './mobile';

describe('mobile rule', () => {
	it('keeps what the iOS app draws and drops the rest', () => {
		const s = mobileStyle({
			...defaultStyle(),
			scale: 1.5,
			bold: true,
			italic: true,
			offset: 'subscript',
			font: 'casual',
			textColor: '#FFFF00',
			bgColor: '#1E3A8A',
			bgOpacity: 0,
			edge: 'glow',
		});
		expect(s).toEqual(
			expect.objectContaining({
				scale: 1.5,
				bold: false,
				italic: true,
				offset: 'regular',
				font: 'default',
				textColor: '#FFFF00',
				bgColor: '#080808',
				bgOpacity: 0.75,
				edge: 'glow',
			}),
		);
	});

	it('shows sizes under 100% at 100%', () => {
		expect(mobileStyle({ ...defaultStyle(), scale: 0.75 }).scale).toBe(1);
		expect(mobileOverride({ scale: 0.75, bold: true, textColor: '#FF0000' })).toEqual({
			scale: 1,
			textColor: '#FF0000',
		});
	});
});
