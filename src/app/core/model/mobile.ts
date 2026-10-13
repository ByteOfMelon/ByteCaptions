import { CaptionStyle, Position } from './types';

/**
 * How YouTube's mobile apps draw SRV3, from upload tests on the iOS app (docs/COMPAT.md). Android isn't tested yet.
 */
const MOBILE_BG = '#080808';
const MOBILE_BG_OPACITY = 0.75;

export type MobileChange = 'size' | 'background' | 'bold' | 'offset' | 'font' | 'vertical';

/** Mobile apps draw every caption on their standard box, ignore bold, offsets and fonts, and show sizes under 100% at 100% */
export function mobileStyle(s: CaptionStyle): CaptionStyle {
	return {
		...s,
		bgColor: MOBILE_BG,
		bgOpacity: MOBILE_BG_OPACITY,
		scale: Math.max(1, s.scale),
		bold: false,
		offset: 'regular',
		font: 'default',
	};
}

/** The same rule for a run's own formatting, keeping only what mobile apps still draw */
export function mobileOverride(o: Partial<CaptionStyle>): Partial<CaptionStyle> {
	const out = { ...o };
	delete out.bgColor;
	delete out.bgOpacity;
	delete out.bold;
	delete out.offset;
	delete out.font;

	if (out.scale !== undefined) out.scale = Math.max(1, out.scale);

	return out;
}

/** What YouTube's mobile apps show differently for this style, empty if nothing */
export function mobileChanges(s: Partial<CaptionStyle>): MobileChange[] {
	const out: MobileChange[] = [];

	if (s.scale !== undefined && s.scale < 1) out.push('size');

	if (
		(s.bgColor !== undefined && s.bgColor.toLowerCase() !== MOBILE_BG) ||
		(s.bgOpacity !== undefined && s.bgOpacity !== MOBILE_BG_OPACITY)
	)
		out.push('background');

	if (s.bold) out.push('bold');

	if (s.offset !== undefined && s.offset !== 'regular') out.push('offset');

	if (s.font !== undefined && s.font !== 'default') out.push('font');

	return out;
}

export function mobilePositionChanges(p: Position): MobileChange[] {
	return p.direction !== 'horizontal' ? ['vertical'] : [];
}

const PHRASES: Record<MobileChange, string> = {
	size: 'show it at 100% size',
	background: 'use their standard background',
	bold: 'drop bold',
	offset: 'drop subscript and superscript',
	font: 'use a different font',
	vertical: 'draw vertical text horizontally',
};

/** E.g. "Mobile apps drop bold and use a different font" */
export function mobileMessage(changes: Iterable<MobileChange>): string {
	const order = Object.keys(PHRASES) as MobileChange[];
	const set = new Set(changes);
	const parts = order.filter((c) => set.has(c)).map((c) => PHRASES[c]);
	const list =
		parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];

	return `Mobile apps ${list}`;
}
