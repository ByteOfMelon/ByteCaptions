import { CaptionStyle } from './types';

const MOBILE_BG = '#080808';
const MOBILE_BG_OPACITY = 0.75;

/** YouTube's mobile apps draw every caption on a black box, at one fixed size */
export function mobileStyle(s: CaptionStyle): CaptionStyle {
	return { ...s, bgColor: MOBILE_BG, bgOpacity: MOBILE_BG_OPACITY, scale: 1 };
}

/** What YouTube's mobile apps show differently for this style, empty if nothing */
export function mobileChanges(s: Partial<CaptionStyle>): ('size' | 'background')[] {
	const out: ('size' | 'background')[] = [];

	if (s.scale !== undefined && s.scale !== 1) out.push('size');

	if (
		(s.bgColor !== undefined && s.bgColor.toLowerCase() !== MOBILE_BG) ||
		(s.bgOpacity !== undefined && s.bgOpacity !== MOBILE_BG_OPACITY)
	)
		out.push('background');

	return out;
}
