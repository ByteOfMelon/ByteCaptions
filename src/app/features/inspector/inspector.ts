import { Component, computed, inject } from '@angular/core';
import { resolvePosition, resolveStyle } from '../../core/model/cue';
import { Position, StyleId } from '../../core/model/types';
import { ProjectStore } from '../../state/project-store';
import { Select } from '../../ui/select/select';
import { AnchorPicker } from './anchor-picker';
import { StyleChange, StyleFields } from './style-fields';

/**
 * Style and position of the selected cue(s). Edits change the preset itself, so
 * every cue using it updates (PLAN §5.7); applying a different preset is per cue.
 */
@Component({
	selector: 'bc-inspector',
	imports: [Select, StyleFields, AnchorPicker],
	templateUrl: './inspector.html',
	styleUrl: './inspector.css',
})
export class Inspector {
	protected readonly store = inject(ProjectStore);

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
			style: resolveStyle(p, first.track, first.cue),
			position: resolvePosition(p, first.track, first.cue),
			locked: sel.some((r) => r.track.locked),
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

	protected setStyle({ key, value }: StyleChange): void {
		const s = this.subject();
		if (!s) return;
		this.store.apply(`Change ${s.style.name} ${String(key)}`, (p) => {
			(p.styles[s.styleId] as unknown as Record<string, unknown>)[key] = value;
		});
	}

	protected setPosition(changes: Partial<Position>): void {
		const s = this.subject();
		if (!s) return;
		this.store.apply('Change position', (p) => {
			Object.assign(p.positions[s.posId], changes);
		});
	}
}
