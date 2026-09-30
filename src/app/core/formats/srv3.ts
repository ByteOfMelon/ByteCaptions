/**
 * YouTube SRV3 / YTT ("YouTube Timed Text", format="3").
 *
 * There is no official spec. Attribute meanings and YouTube's rendering quirks
 * follow YTSubConverter (github.com/arcusmaximus/YTSubConverter), studied as a
 * reference; this is an independent implementation.
 */
import { newId } from '../model/defaults';
import {
	Anchor,
	CaptionStyle,
	Cue,
	EdgeType,
	Position,
	Project,
	TextDirection,
	TextOffset,
	YtFont,
} from '../model/types';
import { ImportResult, flatten } from './flatten';

const ZWSP = '\u200B';

const FONTS: YtFont[] = [
	'default',
	'monoSerif',
	'propSerif',
	'monoSans',
	'propSans',
	'casual',
	'cursive',
	'smallCaps',
];
const EDGES: EdgeType[] = ['none', 'hardShadow', 'bevel', 'glow', 'softShadow'];
const OFFSETS: TextOffset[] = ['subscript', 'regular', 'superscript'];
/** Color YouTube uses for edges when `ec` is omitted. */
const DEFAULT_EDGE_COLOR = '#222222';

// ---- YouTube coordinate / scale corrections --------------------------------

/**
 * YouTube squeezes positions toward the center: displayed = 2 + value * 0.96.
 * We store displayed percentages and invert that on export.
 */
export function toYtCoord(displayPct: number): number {
	return Math.round(Math.min(100, Math.max(0, (displayPct - 2) / 0.96)));
}

export function fromYtCoord(yt: number): number {
	return Math.round((2 + yt * 0.96) * 100) / 100;
}

/** YouTube renders size as 1 + (sz/100 - 1) / 4. We store the rendered scale. */
export function toYtSize(scale: number): number {
	return Math.round(Math.max(1 + (scale - 1) * 4, 0) * 100);
}

export function fromYtSize(sz: number): number {
	return 1 + (sz / 100 - 1) / 4;
}

function opacityToByte(o: number): number {
	return Math.round(Math.min(1, Math.max(0, o)) * 255);
}

function byteToOpacity(b: number): number {
	return Math.round((b / 255) * 1000) / 1000;
}

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ---- Export ------------------------------------------------------------------

type Attrs = [string, string | number][];

function penAttrs(s: CaptionStyle): Attrs {
	const a: Attrs = [];
	const fs = FONTS.indexOf(s.font);
	if (fs > 0) a.push(['fs', fs]);
	a.push(['sz', toYtSize(s.scale)]);
	if (s.offset !== 'regular') a.push(['of', OFFSETS.indexOf(s.offset)]);
	if (s.bold) a.push(['b', 1]);
	if (s.italic) a.push(['i', 1]);
	if (s.underline) a.push(['u', 1]);
	a.push(['fc', s.textColor.toUpperCase()]);
	a.push(['fo', opacityToByte(s.textOpacity)]);
	a.push(['bc', s.bgColor.toUpperCase()]);
	a.push(['bo', opacityToByte(s.bgOpacity)]);
	if (s.edge !== 'none') {
		a.push(['et', EDGES.indexOf(s.edge)]);
		// Omitting `ec` lets the edge follow text opacity; writing it forces the
		// edge opaque. Only write it when a non-default color is needed.
		if (s.edgeColor.toUpperCase() !== DEFAULT_EDGE_COLOR)
			a.push(['ec', s.edgeColor.toUpperCase()]);
	}
	return a;
}

function wpAttrs(p: Position): Attrs {
	return [
		['ap', p.anchor],
		['ah', toYtCoord(p.x)],
		['av', toYtCoord(p.y)],
	];
}

function wsAttrs(p: Position): Attrs {
	const ju = p.align === 'left' ? 0 : p.align === 'right' ? 1 : 2;
	const [pd, sd] =
		p.direction === 'verticalRtl' ? [2, 0] : p.direction === 'verticalLtr' ? [2, 1] : [0, 0];
	return [
		['ju', ju],
		['pd', pd],
		['sd', sd],
	];
}

/** Dedupes attribute sets into numbered definitions. */
class Table {
	private ids = new Map<string, number>();
	readonly rows: Attrs[] = [];
	id(attrs: Attrs): number {
		const key = JSON.stringify(attrs);
		let id = this.ids.get(key);
		if (id === undefined) {
			id = this.rows.length;
			this.ids.set(key, id);
			this.rows.push(attrs);
		}
		return id;
	}
}

function attrString(a: Attrs): string {
	return a.map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
}

interface Section {
	text: string;
	pen: number;
}

interface Line {
	start: number;
	end: number;
	wp: number;
	ws: number;
	sections: Section[];
}

export interface Srv3Stats {
	lines: number;
	sections: number;
	bytes: number;
	/** 0–1+, rough "weight" relative to a conservative safe budget. */
	weight: number;
}

/** Conservative budget; tune once real-world limits are measured. See PLAN §4.1. */
export const SRV3_ELEMENT_BUDGET = 20_000;

export function exportSrv3(project: Project): { xml: string; stats: Srv3Stats } {
	const pens = new Table();
	const wps = new Table();
	const wss = new Table();
	const lines: Line[] = [];

	for (const fc of flatten(project)) {
		const { cue, style, position } = fc;
		const wp = wps.id(wpAttrs(position));
		const ws = wss.id(wsAttrs(position));
		const runPen = (override?: Partial<CaptionStyle>) =>
			pens.id(penAttrs({ ...style, ...override }));

		if (cue.karaoke && cue.words?.length) {
			const hl = (cue.karaokeStyleId && project.styles[cue.karaokeStyleId]) || {
				...style,
				textColor: '#FFFF00',
			};
			const sung = pens.id(penAttrs(hl));
			const unsung = runPen();
			const words = cue.words;
			// One line per word: words up to i highlighted, the rest normal.
			for (let i = 0; i < words.length; i++) {
				const start = i === 0 ? cue.start : words[i].start;
				const end = i + 1 < words.length ? words[i + 1].start : cue.end;
				if (end <= start) continue;
				const before = words
					.slice(0, i + 1)
					.map((w) => w.text)
					.join(' ');
				const after = words
					.slice(i + 1)
					.map((w) => w.text)
					.join(' ');
				const sections: Section[] = [{ text: before, pen: sung }];
				if (after) sections.push({ text: ' ' + after, pen: unsung });
				lines.push({ start, end, wp, ws, sections });
			}
			continue;
		}

		const sections = cue.runs
			.filter((r) => r.text.length > 0)
			.map((r) => ({ text: r.text, pen: runPen(r.styleOverride) }));
		lines.push({ start: cue.start, end: cue.end, wp, ws, sections: mergeSections(sections) });
	}

	const out: string[] = [];
	out.push('<?xml version="1.0" encoding="utf-8"?>');
	out.push('<timedtext format="3">');
	out.push('<head>');
	pens.rows.forEach((a, id) => out.push(`<pen id="${id}"${attrString(a)} />`));
	wss.rows.forEach((a, id) => out.push(`<ws id="${id}"${attrString(a)} />`));
	wps.rows.forEach((a, id) => out.push(`<wp id="${id}"${attrString(a)} />`));
	out.push('</head>');
	out.push('<body>');
	let sectionCount = 0;
	for (const line of lines) {
		const s = writeLine(line);
		if (s) {
			out.push(s);
			sectionCount += line.sections.length;
		}
	}
	out.push('</body>');
	out.push('</timedtext>');
	const xml = out.join('\n') + '\n';
	const elements =
		lines.length + sectionCount + pens.rows.length + wps.rows.length + wss.rows.length;
	return {
		xml,
		stats: {
			lines: lines.length,
			sections: sectionCount,
			bytes: new TextEncoder().encode(xml).length,
			weight: elements / SRV3_ELEMENT_BUDGET,
		},
	};
}

function mergeSections(sections: Section[]): Section[] {
	const out: Section[] = [];
	for (const s of sections) {
		const last = out.at(-1);
		if (last && last.pen === s.pen) last.text += s.text;
		else out.push({ ...s });
	}
	return out;
}

function writeLine(line: Line): string | null {
	if (line.sections.length === 0) return null;
	let t = Math.round(line.start);
	let d = Math.round(line.end - line.start);
	// The Android app ignores positioning (or hides the line) at t=0.
	if (t <= 0) {
		d -= -t + 1;
		t = 1;
	}
	if (d <= 0) return null;
	const head = `<p t="${t}" d="${d}"`;
	const pos = ` wp="${line.wp}" ws="${line.ws}"`;
	if (line.sections.length === 1) {
		return `${head} p="${line.sections[0].pen}"${pos}>${esc(line.sections[0].text)}</p>`;
	}
	// YouTube's server drops the first section's pen unless the line has text
	// outside any section, so insert a zero-width space after the first one.
	const body = line.sections
		.map((s, i) => `<s p="${s.pen}">${esc(s.text)}</s>${i === 0 ? ZWSP : ''}`)
		.join('');
	return `${head}${pos}>${body}</p>`;
}

// ---- Import ------------------------------------------------------------------

function int(el: Element, name: string): number | undefined {
	const v = el.getAttribute(name);
	if (v == null || v === '') return undefined;
	const n = Number.parseInt(v, 10);
	return Number.isNaN(n) ? undefined : n;
}

function color(el: Element, name: string, fallback: string): string {
	const v = el.getAttribute(name);
	return v && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : fallback;
}

function readPen(el: Element | undefined): CaptionStyle {
	const g = (n: string) => (el ? int(el, n) : undefined);
	const et = g('et') ?? 0;
	return {
		name: 'Imported',
		font: FONTS[g('fs') ?? 0] ?? 'default',
		scale: fromYtSize(g('sz') ?? 100),
		bold: g('b') === 1,
		italic: g('i') === 1,
		underline: g('u') === 1,
		offset: OFFSETS[g('of') ?? 1] ?? 'regular',
		textColor: el ? color(el, 'fc', '#FFFFFF') : '#FFFFFF',
		textOpacity: byteToOpacity(g('fo') ?? 254),
		bgColor: el ? color(el, 'bc', '#080808') : '#080808',
		bgOpacity: byteToOpacity(g('bo') ?? 192),
		edge: EDGES[et] ?? 'none',
		edgeColor: el ? color(el, 'ec', DEFAULT_EDGE_COLOR) : DEFAULT_EDGE_COLOR,
	};
}

function readPosition(wp: Element | undefined, ws: Element | undefined): Position {
	const ju = ws ? int(ws, 'ju') : undefined;
	const pd = ws ? (int(ws, 'pd') ?? 0) : 0;
	const sd = ws ? (int(ws, 'sd') ?? 0) : 0;
	let direction: TextDirection = 'horizontal';
	if (pd === 2 || pd === 3) direction = sd === 0 ? 'verticalRtl' : 'verticalLtr';
	const ap = (wp ? int(wp, 'ap') : undefined) ?? 7;
	return {
		name: 'Imported',
		anchor: (ap >= 0 && ap <= 8 ? ap : 7) as Anchor,
		x: wp ? fromYtCoord(int(wp, 'ah') ?? 50) : 50,
		y: wp ? fromYtCoord(int(wp, 'av') ?? 100) : 100,
		align: ju === 0 ? 'left' : ju === 1 ? 'right' : 'center',
		direction,
	};
}

function styleKey(s: CaptionStyle): string {
	const { name: _name, ...rest } = s;
	return JSON.stringify(rest);
}

function diff(base: CaptionStyle, s: CaptionStyle): Partial<CaptionStyle> | undefined {
	const out: Partial<CaptionStyle> = {};
	let any = false;
	for (const k of Object.keys(s) as (keyof CaptionStyle)[]) {
		if (k !== 'name' && s[k] !== base[k]) {
			(out as Record<string, unknown>)[k] = s[k];
			any = true;
		}
	}
	return any ? out : undefined;
}

export function importSrv3(src: string): ImportResult {
	const doc = new DOMParser().parseFromString(src, 'application/xml');
	if (doc.getElementsByTagName('parsererror').length) {
		return { cues: [], warnings: ['File is not valid XML'] };
	}
	const root = doc.documentElement;
	if (root.tagName !== 'timedtext' || root.getAttribute('format') !== '3') {
		return { cues: [], warnings: ['Not an SRV3/YTT file (expected <timedtext format="3">)'] };
	}

	const byId = (tag: string) => {
		const m = new Map<number, Element>();
		for (const el of Array.from(doc.getElementsByTagName(tag))) {
			const id = int(el, 'id');
			if (id !== undefined) m.set(id, el);
		}
		return m;
	};
	const pens = byId('pen');
	const wps = byId('wp');
	const wss = byId('ws');

	const styles: Record<string, CaptionStyle> = {};
	const styleIds = new Map<string, string>();
	const internStyle = (s: CaptionStyle) => {
		const key = styleKey(s);
		let id = styleIds.get(key);
		if (!id) {
			id = newId('style');
			styleIds.set(key, id);
			styles[id] = { ...s, name: `Imported ${styleIds.size}` };
		}
		return id;
	};
	const positions: Record<string, Position> = {};
	const posIds = new Map<string, string>();
	const internPos = (p: Position) => {
		const key = JSON.stringify({ ...p, name: '' });
		let id = posIds.get(key);
		if (!id) {
			id = newId('pos');
			posIds.set(key, id);
			positions[id] = { ...p, name: `Imported ${posIds.size}` };
		}
		return id;
	};

	const penOf = (el: Element) => {
		const id = int(el, 'p');
		return id === undefined ? undefined : pens.get(id);
	};

	const cues: Cue[] = [];
	const warnings = new Set<string>();
	const body = doc.getElementsByTagName('body')[0];
	for (const p of Array.from(body?.getElementsByTagName('p') ?? [])) {
		const t = int(p, 't') ?? 0;
		const d = int(p, 'd') ?? 0;
		if (d <= 0) continue;
		const linePen = penOf(p);

		const parts: { text: string; style: CaptionStyle }[] = [];
		for (const node of Array.from(p.childNodes)) {
			if (node.nodeType === 3) {
				parts.push({ text: node.textContent ?? '', style: readPen(linePen) });
			} else if (node.nodeType === 1) {
				const el = node as Element;
				if (el.tagName === 'br') {
					parts.push({ text: '\n', style: readPen(linePen) });
					continue;
				}
				if (el.tagName !== 's') continue;
				if (int(el, 't'))
					warnings.add('Timed sections (<s t>) were imported as static text');
				const pen = penOf(el) ?? linePen;
				if (pen && int(pen, 'rb'))
					warnings.add('Ruby text is not supported yet and was flattened');
				parts.push({ text: el.textContent ?? '', style: readPen(pen) });
			}
		}
		const clean = parts
			.map((x) => ({ ...x, text: x.text.replaceAll(ZWSP, '') }))
			.filter((x) => x.text.length > 0);
		if (!clean.length) continue;

		const base = clean[0].style;
		const wpId = int(p, 'wp');
		const wsId = int(p, 'ws');
		const cue: Cue = {
			id: newId('cue'),
			start: t,
			end: t + d,
			runs: clean.map((x) => {
				const o = diff(base, x.style);
				return o ? { text: x.text, styleOverride: o } : { text: x.text };
			}),
			styleId: internStyle(base),
			positionId: internPos(
				readPosition(
					wpId !== undefined ? wps.get(wpId) : undefined,
					wsId !== undefined ? wss.get(wsId) : undefined,
				),
			),
		};
		// Merge adjacent runs with identical overrides.
		cue.runs = cue.runs.reduce<Cue['runs']>((acc, r) => {
			const last = acc.at(-1);
			if (last && JSON.stringify(last.styleOverride) === JSON.stringify(r.styleOverride)) {
				last.text += r.text;
			} else acc.push({ ...r });
			return acc;
		}, []);
		cues.push(cue);
	}
	cues.sort((a, b) => a.start - b.start);
	return { cues, styles, positions, warnings: [...warnings] };
}
