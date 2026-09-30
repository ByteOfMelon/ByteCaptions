import { Ms } from '../model/types';

function pad(n: number, width = 2): string {
	return String(n).padStart(width, '0');
}

function split(ms: Ms) {
	const t = Math.max(0, Math.round(ms));
	return {
		h: Math.floor(t / 3_600_000),
		m: Math.floor((t % 3_600_000) / 60_000),
		s: Math.floor((t % 60_000) / 1000),
		ms: t % 1000,
	};
}

/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT) depending on separator. */
export function formatClock(ms: Ms, sep: ',' | '.' = '.'): string {
	const p = split(ms);
	return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}${sep}${pad(p.ms, 3)}`;
}

/** SBV style: `H:MM:SS.mmm`. */
export function formatSbv(ms: Ms): string {
	const p = split(ms);
	return `${p.h}:${pad(p.m)}:${pad(p.s)}.${pad(p.ms, 3)}`;
}

/** NLE timecode `HH:MM:SS:FF`. */
export function formatTimecode(ms: Ms, fps: number): string {
	const p = split(ms);
	const frame = Math.floor((p.ms / 1000) * fps);
	return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}:${pad(frame)}`;
}

/**
 * Parses `[HH:]MM:SS[.,]mmm`, `H:MM:SS.mmm`, or `HH:MM:SS:FF` (when fps given).
 * Returns null on invalid input.
 */
export function parseTime(input: string, fps?: number): Ms | null {
	const s = input.trim();
	const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s);
	if (clock) {
		const [, h = '0', m, sec, frac = '0'] = clock;
		const msPart = Number(frac.padEnd(3, '0'));
		return ((Number(h) * 60 + Number(m)) * 60 + Number(sec)) * 1000 + msPart;
	}
	const tc = /^(\d+):(\d{2}):(\d{2}):(\d{2})$/.exec(s);
	if (tc && fps) {
		const [, h, m, sec, f] = tc.map(Number);
		return ((h * 60 + m) * 60 + sec) * 1000 + Math.round((f / fps) * 1000);
	}
	return null;
}

/** Snap a time to the nearest frame boundary. */
export function snapToFrame(ms: Ms, fps: number): Ms {
	const frameMs = 1000 / fps;
	return Math.round(Math.round(ms / frameMs) * frameMs);
}
