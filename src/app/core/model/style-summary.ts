import { CaptionStyle, YtFont } from './types';

const FONT_NAME: Record<YtFont, string> = {
	default: 'Default font',
	propSans: 'Proportional Sans',
	monoSerif: 'Monospaced Serif',
	propSerif: 'Proportional Serif',
	monoSans: 'Monospaced Sans',
	casual: 'Casual',
	cursive: 'Cursive',
	smallCaps: 'Small Capitals',
};

const percent = (n: number) => `${Math.round(n * 100)}%`;

/**
 * One liner describing a style preset
 */
export function styleSummary(s: CaptionStyle): string {
	const text = colorName(s.textColor) + (s.textOpacity < 1 ? ` ${percent(s.textOpacity)}` : '');
	const colors =
		s.bgOpacity <= 0
			? `${capitalize(text)}, no background`
			: `${capitalize(text)} on ${colorName(s.bgColor)} ${percent(s.bgOpacity)}`;

	return [
		FONT_NAME[s.font],
		percent(s.scale),
		s.bold && 'Bold',
		s.italic && 'Italic',
		s.underline && 'Underline',
		colors,
	]
		.filter(Boolean)
		.join(' • ');
}

/** A plain name for a #RRGGBB color: black, gray, white, or a hue name */
export function colorName(hex: string): string {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);

	if (!m) return 'custom';

	const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const light = (max + min) / 2;
	const chroma = max - min;

	if (chroma < 0.15) return light < 0.15 ? 'black' : light > 0.85 ? 'white' : 'gray';

	let hue =
		max === r
			? ((g - b) / chroma) % 6
			: max === g
				? (b - r) / chroma + 2
				: (r - g) / chroma + 4;
	hue = (hue * 60 + 360) % 360;

	if (hue < 15 || hue >= 345) return light > 0.75 ? 'pink' : 'red';

	if (hue < 45) return light < 0.35 ? 'brown' : 'orange';

	if (hue < 70) return 'yellow';

	if (hue < 160) return 'green';

	if (hue < 200) return 'cyan';

	if (hue < 255) return 'blue';

	if (hue < 290 || light < 0.35) return 'purple';

	return light > 0.75 ? 'pink' : 'magenta';
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
