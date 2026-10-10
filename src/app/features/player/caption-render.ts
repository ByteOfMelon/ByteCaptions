import { CaptionStyle, EdgeType, Position, YtFont } from '../../core/model/types';

/**
 * CSS approximations of how YouTube's player renders SRV3 captions.
 * Font stacks follow YouTube's own fallbacks for its fixed font list.
 */
export const YT_FONT_STACK: Record<YtFont, string> = {
	default: '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
	propSans: '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
	monoSerif: '"Courier New", Courier, "Nimbus Mono L", "Cutive Mono", monospace',
	propSerif: '"Times New Roman", Times, Georgia, Cambria, "PT Serif Caption", serif',
	monoSans: '"Deja Vu Sans Mono", "Lucida Console", Monaco, Consolas, "PT Mono", monospace',
	casual: '"Comic Sans MS", Impact, Handlee, fantasy',
	cursive: '"Monotype Corsiva", "URW Chancery L", "Apple Chancery", "Dancing Script", cursive',
	smallCaps: 'Arial, Helvetica, Verdana, "Marcellus SC", sans-serif',
};

export const YT_FONT_LABEL: Record<YtFont, string> = {
	default: 'Default',
	propSans: 'Proportional Sans',
	monoSerif: 'Monospaced Serif',
	propSerif: 'Proportional Serif',
	monoSans: 'Monospaced Sans',
	casual: 'Casual',
	cursive: 'Cursive',
	smallCaps: 'Small Capitals',
};

export const EDGE_LABEL: Record<EdgeType, string> = {
	none: 'None',
	hardShadow: 'Drop shadow',
	bevel: 'Raised',
	glow: 'Outline',
	softShadow: 'Depressed',
};

function rgba(hex: string, alpha: number): string {
	const n = parseInt(hex.replace('#', ''), 16);

	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Text-shadow for an edge type; `u` is the edge unit in px (scales with player size). */
export function edgeShadow(edge: EdgeType, color: string, u = 1): string {
	const c = color;

	switch (edge) {
		case 'hardShadow':
			return `${c} ${u}px ${u}px 0, ${c} ${1.5 * u}px ${1.5 * u}px 0, ${c} ${2 * u}px ${2 * u}px 0`;
		case 'bevel':
			return `${c} ${u}px ${u}px 0, ${c} ${1.5 * u}px ${1.5 * u}px 0`;
		case 'softShadow':
			return `${c} -${u}px -${u}px 0, ${c} -${1.5 * u}px -${1.5 * u}px 0`;
		case 'glow':
			return `${c} 0 0 ${u}px, ${c} 0 0 ${u}px, ${c} 0 0 ${u}px, ${c} 0 0 ${u}px, ${c} 0 0 ${u}px`;
		default:
			return 'none';
	}
}

/** Inline styles for a caption line span. */
export function captionTextStyle(s: CaptionStyle, edgeUnitPx = 1): Record<string, string> {
	return {
		'font-family': YT_FONT_STACK[s.font],
		'font-variant': s.font === 'smallCaps' ? 'small-caps' : 'normal',
		'font-weight': s.bold ? '700' : '400',
		'font-style': s.italic ? 'italic' : 'normal',
		'text-decoration': s.underline ? 'underline' : 'none',
		color: rgba(s.textColor, s.textOpacity),
		'background-color': rgba(s.bgColor, s.bgOpacity),
		'text-shadow': edgeShadow(s.edge, s.edgeColor, edgeUnitPx),
	};
}

/**
 * YouTube's player keeps caption windows inside a safe area: SRV3's 0–100% maps to 2–98% of
 * the video (so 93% lands at 91.3%).
 */
export function ytSafeArea(percent: number): number {
	return 2 + percent * 0.96;
}

/** Absolute placement of a caption window inside the video frame, as YouTube places it. */
export function captionWindowStyle(p: Position): Record<string, string> {
	const ax = (p.anchor % 3) * 50;
	const ay = Math.floor(p.anchor / 3) * 50;

	return {
		left: `${ytSafeArea(p.x)}%`,
		top: `${ytSafeArea(p.y)}%`,
		transform: `translate(-${ax}%, -${ay}%)`,
		'text-align': p.align,
	};
}

export const ANCHOR_LABEL = [
	'Top left',
	'Top center',
	'Top right',
	'Middle left',
	'Center',
	'Middle right',
	'Bottom left',
	'Bottom center',
	'Bottom right',
];
