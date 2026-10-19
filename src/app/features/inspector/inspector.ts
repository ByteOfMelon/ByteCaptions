import { Component, computed, inject } from '@angular/core';
import { setKaraoke, setPosition, styleCues } from '../../core/commands/edits';
import { cueText, resolvePosition, resolveStyle } from '../../core/model/cue';
import { rangeOverride } from '../../core/model/runs';
import { DEFAULT_KARAOKE_COLOR, KARAOKE_COLORS } from '../../core/model/karaoke';
import { Position, StyleId } from '../../core/model/types';
import { ProjectStore } from '../../state/project-store';
import { TextFormat } from '../../state/text-format';
import { Button } from '../../ui/button/button';
import { Toggle } from '../../ui/controls/controls';
import { Select } from '../../ui/select/select';
import { AnchorPicker } from './anchor-picker';
import { StyleChange, StyleFields } from './style-fields';

/**
 * Edit the style and position of the selected cue(s)
 */
@Component({
	selector: 'bc-inspector',
	imports: [Button, Select, StyleFields, AnchorPicker, Toggle],
	templateUrl: './inspector.html',
	styleUrl: './inspector.css',
	host: { 'data-keeps-text-selection': '', tabindex: '-1' },
})
export class Inspector {
	protected readonly store = inject(ProjectStore);
	/** Text selected in the caption which is currently being edited */
	protected readonly text = inject(TextFormat).active;
	private readonly format = inject(TextFormat);

	protected readonly subject = computed(() => {
		const sel = this.store.selectedCues();
		const first = sel[0];

		if (!first) return null;

		const p = this.store.project();
		const styleId = first.cue.styleId ?? first.track.defaultStyleId;
		const posId = first.cue.positionId ?? first.track.defaultPositionId;

		return {
			title:
				sel.length > 1 ? `${sel.length} cues` : `Cue ${first.index} • ${first.track.name}`,
			styleId,
			posId,
			/** The preset, with formatting shared by all of the cue's text on top */
			style: {
				...resolveStyle(p, first.track, first.cue),
				...rangeOverride(first.cue.runs, 0, cueText(first.cue).length),
			},
			formatted: sel.some((r) => r.cue.runs.some((run) => run.styleOverride)),
			position: resolvePosition(p, first.track, first.cue),
			locked: sel.some((r) => r.track.locked),
			karaoke: sel.every((r) => r.cue.karaoke),
			karaokeColor: first.cue.karaokeColor ?? DEFAULT_KARAOKE_COLOR,
		};
	});

	protected readonly presetOptions = computed(() =>
		Object.entries(this.store.project().styles).map(([value, s]) => ({ value, label: s.name })),
	);

	protected applyPreset(styleId: StyleId): void {
		const ids = new Set(this.store.selectedCues().map((r) => r.cue.id));
		this.store.apply('Apply style preset', (p) => {
			for (const t of p.tracks)
				for (const c of t.cues)
					if (ids.has(c.id)) {
						if (styleId === t.defaultStyleId) delete c.styleId;
						else c.styleId = styleId;
					}
		});
	}

	/** Remove the selected cues' own formatting, back to their preset */
	protected resetToPreset(): void {
		const ids = this.store.selectedCues().map((r) => r.cue.id);
		this.store.apply('Reset to preset', styleCues(ids, 'clear'));
	}

	protected setStyle({ key, value }: StyleChange): void {
		if (this.text()) return this.format.apply({ [key]: value });

		const s = this.subject();

		if (!s) return;

		// Only the selected cues change; the preset itself is edited in the Style Presets dialog
		const ids = this.store.selectedCues().map((r) => r.cue.id);
		this.store.apply(`Change ${String(key)}`, styleCues(ids, { [key]: value }));
	}

	protected readonly karaokeColors = KARAOKE_COLORS;

	/** Karaoke on or off, or the sung-word colour, for every selected cue */
	protected setKaraoke(changes: { on?: boolean; color?: string }): void {
		const ids = this.store.selectedCues().map((r) => r.cue.id);
		const label = changes.color
			? 'Sung word colour'
			: changes.on
				? 'Karaoke on'
				: 'Karaoke off';
		this.store.apply(label, setKaraoke(ids, changes));
	}

	/** Positions are per cue - reuse a matching one, or add it, and point the selection at i. */
	protected setPosition(changes: Partial<Position>): void {
		const s = this.subject();

		if (!s) return;

		const ids = this.store.selectedCues().map((r) => r.cue.id);
		this.store.apply('Change position', setPosition(ids, { ...s.position, ...changes }));
	}
}
