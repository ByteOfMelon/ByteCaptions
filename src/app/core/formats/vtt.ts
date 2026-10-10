/**
 * WebVTT export, aiming to work on as many players as possible:
 * - Bold, italic, underline and ruby use plain tags, which nearly every player shows.
 * - Colours, fonts, size, backgrounds and edges go in a STYLE block with a class per look.
 *   Browser players (and players built on them) show it; others ignore it and show plain text.
 * - Speakers become voice tags when more than one track is exported.
 * - Karaoke becomes timestamp tags, styled with ::cue(:past) / ::cue(:future).
 */
import { karaokeSteps } from '../model/karaoke';
import { sliceRuns } from '../model/runs';
import { CaptionStyle, EdgeType, Project, TextRun, YtFont } from '../model/types';
import { formatClock } from '../time/timecode';
import { FlatCue, flatten } from './flatten';
import { PlainExportOptions } from './plain';

export interface VttExportOptions extends PlainExportOptions {
	/** Whether to have colors, fonts, size, backgrounds and edges in a STYLE block */
	styles?: boolean;
	/** Whether to have voice tags naming each cue's track, when more than one track has cues */
	voices?: boolean;
}

const FONTS: Record<YtFont, string> = {
	default: 'Roboto, Arial, sans-serif',
	propSans: 'Roboto, Arial, sans-serif',
	monoSerif: '"Courier New", Courier, monospace',
	propSerif: '"Times New Roman", Times, serif',
	monoSans: '"Lucida Console", "DejaVu Sans Mono", monospace',
	casual: '"Comic Sans MS", "Comic Neue", cursive',
	cursive: '"Monotype Corsiva", "URW Chancery L", cursive',
	smallCaps: '"Carrois Gothic SC", sans-serif; font-variant: small-caps',
};

function escape(t: string): string {
	return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rgba(hex: string, opacity: number): string {
	const n = parseInt(hex.replace('#', ''), 16);
	const a = Math.round(opacity * 100) / 100;
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function shadow(edge: EdgeType, color: string): string | null {
	switch (edge) {
		case 'hardShadow':
			return `2px 2px 0 ${color}`;
		case 'softShadow':
			return `2px 2px 4px ${color}`;
		case 'glow':
			return `0 0 4px ${color}, 0 0 4px ${color}`;
		case 'bevel':
			return `1px 1px 0 ${color}, -1px -1px 0 ${color}`;
		default:
			return null;
	}
}

/** The CSS for how a run looks, apart from bold/italic/underline */
function lookCss(s: CaptionStyle): string {
	const rules = [
		`color: ${rgba(s.textColor, s.textOpacity)}`,
		`background-color: ${rgba(s.bgColor, s.bgOpacity)}`,
		`font-family: ${FONTS[s.font]}`,
	];
	if (s.scale !== 1) rules.push(`font-size: ${Math.round(s.scale * 100)}%`);
	const edge = shadow(s.edge, s.edgeColor);
	if (edge) rules.push(`text-shadow: ${edge}`);
	return rules.join('; ');
}

function tags(text: string, s: CaptionStyle, basic: boolean): string {
	let t = escape(text);
	if (!basic) return t;
	if (s.underline) t = `<u>${t}</u>`;
	if (s.italic) t = `<i>${t}</i>`;
	if (s.bold) t = `<b>${t}</b>`;
	return t;
}

export function exportVtt(project: Project, opts: VttExportOptions = {}): string {
	const basic = opts.basicTags !== false;
	const styled = basic && opts.styles !== false;
	const flat = flatten(project);
	const voiced = opts.voices !== false && new Set(flat.map((fc) => fc.trackId)).size > 1;
	const names = new Map(project.tracks.map((t) => [t.id, t.name]));

	// One class per distinct look, numbered in order of first use
	const classes = new Map<string, string>();
	const classFor = (s: CaptionStyle): string => {
		const css = lookCss(s);
		let c = classes.get(css);
		if (!c) classes.set(css, (c = `s${classes.size + 1}`));
		return c;
	};
	const karaokeColors = new Set<string>();

	const cueBody = (fc: FlatCue): string => {
		const look = (r: TextRun): CaptionStyle => ({ ...fc.style, ...r.styleOverride });
		const runs = fc.cue.runs.filter((r) => r.text);
		const length = runs.reduce((n, r) => n + r.text.length, 0);

		// For karaoke - a timestamp where each word after the first starts, so that word turns from :future to :past as it's sung
		const steps = basic ? karaokeSteps(fc.cue) : null;
		const marks = new Map<number, number>();
		if (steps) {
			for (let i = 1; i < steps.length; i++) marks.set(steps[i - 1].sung, steps[i].start);
			karaokeColors.add(fc.cue.karaokeColor ?? '');
		}
		const cuts = [...new Set([0, ...marks.keys(), length])]
			.filter((n) => n >= 0 && n <= length)
			.sort((a, b) => a - b);

		// When every run looks the same, one class wraps the whole cue. Not for karaoke: players color sung text by element, so each word needs its own element after its timestamp.
		const cueClass =
			styled && !steps && new Set(runs.map((r) => lookCss(look(r)))).size <= 1
				? classFor(look(runs[0] ?? { text: '' }))
				: null;

		let out = '';
		for (let i = 0; i < cuts.length - 1; i++) {
			if (i && marks.has(cuts[i])) out += `<${formatClock(marks.get(cuts[i])!)}>`;
			// Neighboring runs that come out the same are written as one
			const pieces: { text: string; style: CaptionStyle; ruby?: string; key: string }[] = [];
			for (const r of sliceRuns(runs, cuts[i], cuts[i + 1])) {
				const s = look(r);
				const key = `${s.bold}${s.italic}${s.underline}${styled && !cueClass ? lookCss(s) : ''}`;
				const last = pieces.at(-1);
				if (last && !last.ruby && !r.ruby && last.key === key) last.text += r.text;
				else pieces.push({ text: r.text, style: s, ruby: r.ruby, key });
			}
			for (const p of pieces) {
				let t = tags(p.text, p.style, basic);
				if (basic && p.ruby) t = `<ruby>${t}<rt>${escape(p.ruby)}</rt></ruby>`;
				// Karaoke words get the k class, so only they can take the sung colour
				const cls = [
					styled && !cueClass ? classFor(p.style) : '',
					steps && styled ? 'k' : '',
				]
					.filter(Boolean)
					.map((c) => '.' + c)
					.join('');
				if (cls || steps) t = `<c${cls}>${t}</c>`;
				out += t;
			}
		}
		if (cueClass) out = `<c.${cueClass}>${out}</c>`;
		if (voiced) out = `<v ${escape(names.get(fc.trackId) ?? '')}>${out}`;
		return out;
	};

	const body = flat.map((fc) => {
		const p = fc.position;
		const settings: string[] = [];
		// Only emit positioning when it differs from the default bottom-center
		if (!(p.anchor === 7 && p.x === 50 && p.y === 100)) {
			settings.push(`line:${Math.round(p.y)}%`, `position:${Math.round(p.x)}%`);
			if (p.align !== 'center')
				settings.push(`align:${p.align === 'left' ? 'start' : 'end'}`);
		}
		const head = `${formatClock(fc.cue.start)} --> ${formatClock(fc.cue.end)}${settings.length ? ' ' + settings.join(' ') : ''}`;
		return `${head}\n${cueBody(fc)}\n`;
	});

	const css: string[] = [];
	for (const [rules, c] of classes) css.push(`::cue(.${c}) { ${rules}; }`);
	if (styled && karaokeColors.size) {
		// For WebVTT - one color per file as it can't scope :past to a cue, so the first cue color wins out
		const color = [...karaokeColors][0] || '#FFFF00';
		css.push(`::cue(.k:past) { color: ${rgba(color, 1)}; }`);
	}
	const style = css.length ? `STYLE\n${css.join('\n')}\n\n` : '';
	return `WEBVTT\n\n${style}${body.join('\n')}`;
}
