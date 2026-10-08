import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { LucidePlus } from '@lucide/angular';
import { cueText } from '../../core/model/cue';
import {
	DEFAULT_POSITION_ID,
	DEFAULT_STYLE_ID,
	defaultStyle,
	newId,
} from '../../core/model/defaults';
import { CaptionStyle, PosId, Position, StyleId } from '../../core/model/types';
import { ProjectStore } from '../../state/project-store';
import { Button } from '../../ui/button/button';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Field } from '../../ui/field/field';
import { Select } from '../../ui/select/select';
import { Tabs } from '../../ui/tabs/tabs';
import { count } from '../../ui/count/count';
import { Tooltip } from '../../ui/tooltip/tooltip';
import { AnchorPicker } from '../inspector/anchor-picker';
import { StyleChange, StyleFields } from '../inspector/style-fields';
import { captionTextStyle, captionWindowStyle } from '../player/caption-render';
import { StyleChip } from '../player/style-chip';

type Backdrop = 'frame' | 'bright' | 'dark';
type PreviewMode = 'desktop' | 'mobile' | 'tv';

/**
 * Style Presets (PLAN §5.7): edit project presets against a live caption sample.
 * Edits are drafted and applied in one undo step on "Save changes".
 *
 * The model keeps positions separate from styles, so "Position" here edits the position
 * used by the tracks whose default is this preset.
 */
@Component({
	selector: 'bc-style-presets-dialog',
	imports: [
		Dialog,
		Button,
		Field,
		Select,
		Tabs,
		Tooltip,
		StyleChip,
		StyleFields,
		AnchorPicker,
		LucidePlus,
	],
	templateUrl: './style-presets-dialog.html',
	styleUrl: './style-presets-dialog.css',
})
export class StylePresetsDialog implements OnInit {
	private readonly store = inject(ProjectStore);
	protected readonly ref = inject(DialogRef);
	/** Preset to open on; defaults to the selected cue's. */
	readonly initialStyleId = input<StyleId>();

	protected readonly styles = signal<Record<StyleId, CaptionStyle>>(
		structuredClone(this.store.project().styles),
	);
	protected readonly positions = signal<Record<PosId, Position>>(
		structuredClone(this.store.project().positions),
	);
	protected readonly selectedId = signal<StyleId>(DEFAULT_STYLE_ID);
	protected readonly sample = signal('');
	protected readonly backdrop = signal<Backdrop>('frame');
	protected readonly previewMode = signal<PreviewMode>('desktop');
	protected readonly dirty = signal(false);
	/** Preset name as typed; an empty one shows an error instead of being applied. */
	protected readonly nameDraft = signal<string | null>(null);
	protected readonly nameError = computed(() =>
		this.nameDraft()?.trim() === '' ? 'Preset name can’t be empty.' : null,
	);

	protected readonly backdrops = [
		{ value: 'frame' as Backdrop, label: 'Video frame' },
		{ value: 'bright' as Backdrop, label: 'Bright' },
		{ value: 'dark' as Backdrop, label: 'Dark' },
	];
	protected readonly modes = [
		{ value: 'desktop' as PreviewMode, label: 'Desktop web' },
		{ value: 'mobile' as PreviewMode, label: 'Mobile app' },
		{ value: 'tv' as PreviewMode, label: 'TV' },
	];
	protected readonly defaultId = DEFAULT_STYLE_ID;

	/** Cues per preset, honoring per-cue overrides of the track default. */
	private readonly usage = computed(() => {
		const byStyle = new Map<StyleId, Map<string, number>>();
		for (const t of this.store.project().tracks)
			for (const c of t.cues) {
				const id = c.styleId ?? t.defaultStyleId;
				const tracks = byStyle.get(id) ?? new Map<string, number>();
				tracks.set(t.id, (tracks.get(t.id) ?? 0) + 1);
				byStyle.set(id, tracks);
			}
		return byStyle;
	});

	protected readonly list = computed(() =>
		Object.entries(this.styles()).map(([id, style]) => {
			const tracks = [...(this.usage().get(id)?.keys() ?? [])]
				.map((tid) => this.store.track(tid)?.name)
				.filter(Boolean);
			return {
				id,
				style,
				used: tracks.length ? `Used by ${tracks.join(', ')}` : 'Not in use',
			};
		}),
	);

	protected readonly subtitle = computed(() => {
		const n = this.list().length;
		const used = this.list().filter((p) => this.usage().has(p.id)).length;
		return `${n} preset${n === 1 ? '' : 's'} • ${used} in use`;
	});

	protected readonly current = computed(() => this.styles()[this.selectedId()]);

	protected readonly tracksUsing = computed(() => {
		const total = this.store.cueCount();
		return [...(this.usage().get(this.selectedId()) ?? new Map()).entries()].map(([tid, n]) => {
			const t = this.store.track(tid)!;
			return {
				id: tid,
				name: t.name,
				color: t.color,
				count: `${n} of ${count(total, 'cue')}`,
			};
		});
	});

	/** Position shown for the preset: the default position of the first track using it. */
	private readonly positionId = computed<PosId>(() => {
		const track = this.store
			.project()
			.tracks.find((t) => t.defaultStyleId === this.selectedId());
		return track?.defaultPositionId ?? DEFAULT_POSITION_ID;
	});
	protected readonly position = computed(() => this.positions()[this.positionId()]);

	protected readonly sampleCss = computed(() => {
		const s = this.current();
		// The preview frame is 270px tall; YouTube sizes captions from player height.
		const fontPx = 270 * 0.0533 * s.scale;
		return { ...captionTextStyle(s, Math.max(1, fontPx / 18)), 'font-size': `${fontPx}px` };
	});
	protected readonly windowCss = computed(() => captionWindowStyle(this.position()));

	ngOnInit(): void {
		const fromCue = this.store.primary();
		const id =
			this.initialStyleId() ??
			(fromCue ? (fromCue.cue.styleId ?? fromCue.track.defaultStyleId) : DEFAULT_STYLE_ID);
		this.select(this.styles()[id] ? id : Object.keys(this.styles())[0]);
	}

	protected select(id: StyleId): void {
		this.selectedId.set(id);
		this.nameDraft.set(null);
		// Sample text: a real cue that uses this preset, so the preview is representative.
		const primary = this.store.primary();
		if (primary && (primary.cue.styleId ?? primary.track.defaultStyleId) === id)
			return this.sample.set(cueText(primary.cue).replace(/\n/g, ' '));
		const p = this.store.project();
		for (const t of p.tracks)
			for (const c of t.cues)
				if ((c.styleId ?? t.defaultStyleId) === id)
					return this.sample.set(cueText(c).split('\n').at(-1)!);
		this.sample.set('Sample caption text');
	}

	protected updateStyle({ key, value }: StyleChange): void {
		this.styles.update((all) => ({
			...all,
			[this.selectedId()]: { ...all[this.selectedId()], [key]: value },
		}));
		this.dirty.set(true);
	}

	protected rename(name: string): void {
		if (!name.trim()) return;
		this.nameDraft.set(null);
		this.updateStyle({ key: 'name', value: name.trim() });
	}

	protected updatePosition(changes: Partial<Position>): void {
		const id = this.positionId();
		this.positions.update((all) => ({ ...all, [id]: { ...all[id], ...changes } }));
		this.dirty.set(true);
	}

	protected create(): void {
		const id = newId('style');
		const n = this.list().length + 1;
		this.styles.update((all) => ({ ...all, [id]: { ...defaultStyle(), name: `Preset ${n}` } }));
		this.dirty.set(true);
		this.select(id);
	}

	protected duplicate(): void {
		const id = newId('style');
		const src = this.current();
		this.styles.update((all) => ({ ...all, [id]: { ...src, name: `${src.name} copy` } }));
		this.dirty.set(true);
		this.select(id);
	}

	/** Cues and tracks on a deleted preset fall back to the default preset when saved. */
	protected remove(): void {
		const id = this.selectedId();
		if (id === DEFAULT_STYLE_ID) return;
		this.styles.update((all) => {
			const { [id]: _removed, ...rest } = all;
			return rest;
		});
		this.dirty.set(true);
		this.select(DEFAULT_STYLE_ID);
	}

	protected save(): void {
		if (this.dirty()) {
			const styles = this.styles();
			const positions = this.positions();
			this.store.apply('Edit style presets', (p) => {
				p.styles = structuredClone(styles);
				p.positions = structuredClone(positions);
				for (const t of p.tracks) {
					if (!styles[t.defaultStyleId]) t.defaultStyleId = DEFAULT_STYLE_ID;
					for (const c of t.cues) if (c.styleId && !styles[c.styleId]) delete c.styleId;
				}
			});
		}
		this.ref.close();
	}
}
