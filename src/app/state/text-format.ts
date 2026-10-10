import { Injectable, computed, inject, signal } from '@angular/core';
import { cueText, resolveStyle } from '../core/model/cue';
import { rangeOverride } from '../core/model/runs';
import { CaptionStyle, CueId } from '../core/model/types';
import { ProjectStore } from './project-store';

/** Characters [start, end) of a cue's text, selected while editing it */
export interface TextSelection {
	cueId: CueId;
	start: number;
	end: number;
}

/**
 * The text selected in the caption being edited, and formatting
 */
@Injectable({ providedIn: 'root' })
export class TextFormat {
	private readonly store = inject(ProjectStore);
	/** The current selection, or null; empty ranges count as none */
	readonly selection = signal<TextSelection | null>(null);
	private applier: ((change: Partial<CaptionStyle> | 'clear') => void) | null = null;

	readonly active = computed(() => {
		const sel = this.selection();

		if (!sel || sel.end <= sel.start) return null;

		const ref = this.store.find(sel.cueId);

		if (!ref) return null;

		const base = resolveStyle(this.store.project(), ref.track, ref.cue);

		return {
			...sel,
			text: cueText(ref.cue).slice(sel.start, sel.end),
			/** The cue's preset with the selection's shared formatting on top */
			style: { ...base, ...rangeOverride(ref.cue.runs, sel.start, sel.end) } as CaptionStyle,
			base,
		};
	});

	attach(apply: (change: Partial<CaptionStyle> | 'clear') => void): void {
		this.applier = apply;
	}

	detach(): void {
		this.applier = null;
		this.selection.set(null);
	}

	/**
	 * Format the selection
	 */
	apply(change: Partial<CaptionStyle> | 'clear'): void {
		const a = this.active();

		if (!a || !this.applier) return;

		if (change === 'clear') return this.applier('clear');

		const out: Partial<CaptionStyle> = {};

		for (const [k, v] of Object.entries(change) as [keyof CaptionStyle, unknown][])
			(out as Record<string, unknown>)[k] = a.base[k] === v ? undefined : v;

		this.applier(out);
	}

	/** Bold, italic or underline on or off for the whole selection */
	toggle(key: 'bold' | 'italic' | 'underline'): void {
		const a = this.active();

		if (a) this.apply({ [key]: !a.style[key] });
	}
}
