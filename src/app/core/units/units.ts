import { Ms } from '../model/types';

/** Converts bytes to human-readable sizes */
export function formatBytes(n: number): string {
	const kb = Math.round(n / 1e3);
	if (kb < 1000) return `${kb} KB`;
	const mb = Math.round(n / 1e6);
	if (mb < 1000) return `${mb} MB`;
	return `${(n / 1e9).toFixed(1)} GB`;
}

/** A media length - e.g. "0:42", "17:42", "1:02:05" */
export function formatLength(ms: Ms): string {
	const s = Math.round(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** How long something took or lasts - "6.5 s" (tenths under 10 s), "42 s", "2 min 5 s", "1 h 4 min" */
export function formatSpan(ms: Ms): string {
	const tenths = Math.round(ms / 100);
	if (tenths < 100) return `${tenths / 10} s`;
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s} s`;
	if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
	const min = Math.round(s / 60);
	return `${Math.floor(min / 60)} h ${min % 60} min`;
}
