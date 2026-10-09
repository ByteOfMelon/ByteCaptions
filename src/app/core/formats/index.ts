import { Project } from '../model/types';
import { ImportResult } from './flatten';
import { exportSbv, exportSrt, importSbv, importSrt, importVtt } from './plain';
import { exportSrv3, importSrv3 } from './srv3';
import { exportVtt } from './vtt';

export type FormatId = 'srv3' | 'srt' | 'vtt' | 'sbv';

export interface FormatInfo {
	id: FormatId;
	label: string;
	extensions: string[];
	/** What this format drops compared to SRV3, for the export dialog. */
	loses: string[];
	export(project: Project): string;
	import(src: string): ImportResult;
}

export const FORMATS: Record<FormatId, FormatInfo> = {
	srv3: {
		id: 'srv3',
		label: 'YouTube styled (SRV3 / YTT)',
		extensions: ['ytt', 'srv3'],
		loses: [],
		export: (p) => exportSrv3(p).xml,
		import: importSrv3,
	},
	vtt: {
		id: 'vtt',
		label: 'WebVTT',
		extensions: ['vtt'],
		loses: [
			'Colors, fonts and backgrounds only show in players that support WebVTT styling (most web players)',
			'Karaoke colors: one per file',
			'Subscript and superscript',
		],
		export: (p) => exportVtt(p),
		import: importVtt,
	},
	srt: {
		id: 'srt',
		label: 'SubRip (SRT)',
		extensions: ['srt'],
		loses: ['All styling except bold/italic/underline', 'Positioning', 'Karaoke'],
		export: (p) => exportSrt(p),
		import: importSrt,
	},
	sbv: {
		id: 'sbv',
		label: 'YouTube SubViewer (SBV)',
		extensions: ['sbv'],
		loses: ['All styling', 'Positioning', 'Karaoke'],
		export: (p) => exportSbv(p),
		import: importSbv,
	},
};

export function formatForFilename(name: string): FormatInfo | undefined {
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	return Object.values(FORMATS).find((f) => f.extensions.includes(ext));
}

/** Guess format from content when the extension is missing or wrong. */
export function sniffFormat(src: string): FormatInfo | undefined {
	const head = src
		.replace(/^\uFEFF/, '')
		.trimStart()
		.slice(0, 200);
	if (/^<\?xml|^<timedtext/.test(head) && /format="3"/.test(src.slice(0, 500)))
		return FORMATS.srv3;
	if (head.startsWith('WEBVTT')) return FORMATS.vtt;
	if (/^\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(head)) return FORMATS.srt;
	if (/^\d+:\d{2}:\d{2}\.\d{3},\d+:\d{2}:\d{2}\.\d{3}/.test(head)) return FORMATS.sbv;
	return undefined;
}
