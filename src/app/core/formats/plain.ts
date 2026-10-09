/** SRT, WebVTT and SBV: plain-text formats with little or no styling. */
import { createCue } from '../model/defaults';
import { Cue, Project } from '../model/types';
import { formatClock, formatSbv, parseTime } from '../time/timecode';
import { FlatCue, ImportResult, flatten, normalizeNewlines } from './flatten';

export interface PlainExportOptions {
	/** Keep bold/italic/underline as <b>/<i>/<u> tags (SRT/VTT). Default true. */
	basicTags?: boolean;
}

function tagged(fc: FlatCue, opts: PlainExportOptions): string {
	let t = fc.text;
	if (opts.basicTags === false) return t;
	const s = fc.style;
	if (s.underline) t = `<u>${t}</u>`;
	if (s.italic) t = `<i>${t}</i>`;
	if (s.bold) t = `<b>${t}</b>`;
	return t;
}

export function exportSrt(project: Project, opts: PlainExportOptions = {}): string {
	return flatten(project)
		.map(
			(fc, i) =>
				`${i + 1}\n${formatClock(fc.cue.start, ',')} --> ${formatClock(fc.cue.end, ',')}\n${tagged(fc, opts)}\n`,
		)
		.join('\n');
}

export function exportSbv(project: Project): string {
	return flatten(project)
		.map((fc) => `${formatSbv(fc.cue.start)},${formatSbv(fc.cue.end)}\n${fc.text}\n`)
		.join('\n');
}

const TAG_RE = /<\/?(?:b|i|u|c|v|lang|ruby|rt)(?:[.\s][^>]*)?>/gi;

function stripTags(t: string): string {
	return t
		.replace(TAG_RE, '')
		.replace(/\{\\[^}]*\}/g, '') // stray ASS overrides sometimes found in SRT
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
}

function blocks(src: string): string[][] {
	return normalizeNewlines(src)
		.split(/\n{2,}/)
		.map((b) =>
			b.split('\n').filter((l, i, a) => l.trim() !== '' || (i > 0 && i < a.length - 1)),
		)
		.filter((b) => b.length > 0);
}

const ARROW = /^\s*(\S+)\s*-->\s*(\S+)(.*)$/;

export function importSrt(src: string): ImportResult {
	const cues: Cue[] = [];
	const warnings: string[] = [];
	for (const b of blocks(src)) {
		const i = b.findIndex((l) => ARROW.test(l));
		if (i < 0) continue;
		const m = ARROW.exec(b[i])!;
		const start = parseTime(m[1]);
		const end = parseTime(m[2]);
		if (start == null || end == null) {
			warnings.push(`Skipped cue with invalid time: "${b[i]}"`);
			continue;
		}
		cues.push(createCue(start, end, stripTags(b.slice(i + 1).join('\n'))));
	}
	return { cues, warnings };
}

export function importVtt(src: string): ImportResult {
	const text = normalizeNewlines(src);
	if (!/^WEBVTT/.test(text)) return { cues: [], warnings: ['Missing WEBVTT header'] };
	const cues: Cue[] = [];
	const warnings: string[] = [];
	let styled = false;
	for (const b of blocks(text).slice(1)) {
		if (/^(NOTE|STYLE|REGION)\b/.test(b[0])) {
			styled ||= b[0].startsWith('STYLE');
			continue;
		}
		const i = b.findIndex((l) => ARROW.test(l));
		if (i < 0) continue;
		const m = ARROW.exec(b[i])!;
		const start = parseTime(m[1]);
		const end = parseTime(m[2]);
		if (start == null || end == null) {
			warnings.push(`Skipped cue with invalid time: "${b[i]}"`);
			continue;
		}
		cues.push(createCue(start, end, stripTags(b.slice(i + 1).join('\n'))));
	}
	if (styled) warnings.push('VTT STYLE blocks were ignored');
	return { cues, warnings };
}

export function importSbv(src: string): ImportResult {
	const cues: Cue[] = [];
	const warnings: string[] = [];
	for (const b of blocks(src)) {
		const m = /^\s*([\d:.]+),([\d:.]+)\s*$/.exec(b[0]);
		if (!m) continue;
		const start = parseTime(m[1]);
		const end = parseTime(m[2]);
		if (start == null || end == null) {
			warnings.push(`Skipped cue with invalid time: "${b[0]}"`);
			continue;
		}
		cues.push(createCue(start, end, b.slice(1).join('\n')));
	}
	return { cues, warnings };
}
