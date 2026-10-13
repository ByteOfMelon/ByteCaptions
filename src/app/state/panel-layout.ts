import { Injectable, effect, signal } from '@angular/core';

const KEY = 'bc.panelLayout';

export const PANEL_DEFAULTS = { cues: 380, inspector: 344, timeline: 300 };
export const PANEL_MIN = { cues: 380, inspector: 344, timeline: 200, preview: 560, workspace: 360 };

type Sizes = typeof PANEL_DEFAULTS;

function stored(): Partial<Sizes> {
	try {
		const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');

		return v && typeof v === 'object' ? v : {};
	} catch {
		return {};
	}
}

/** Editor panel sizes in px, as the user dragged them */
@Injectable({ providedIn: 'root' })
export class PanelLayout {
	private readonly saved = stored();
	readonly cues = signal(this.size('cues'));
	readonly inspector = signal(this.size('inspector'));
	readonly timeline = signal(this.size('timeline'));

	constructor() {
		effect(() => {
			const sizes: Sizes = {
				cues: this.cues(),
				inspector: this.inspector(),
				timeline: this.timeline(),
			};

			try {
				localStorage.setItem(KEY, JSON.stringify(sizes));
			} catch {
				console.log('[UI] Failed to save panel layout to localStorage');
			}
		});
	}

	reset(): void {
		this.cues.set(PANEL_DEFAULTS.cues);
		this.inspector.set(PANEL_DEFAULTS.inspector);
		this.timeline.set(PANEL_DEFAULTS.timeline);
	}

	private size(k: keyof Sizes): number {
		const v = this.saved[k];

		return typeof v === 'number' && Number.isFinite(v) ? v : PANEL_DEFAULTS[k];
	}
}
