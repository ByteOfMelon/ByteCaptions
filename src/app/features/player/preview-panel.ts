import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import {
	LucideCaptions,
	LucideChevronLeft,
	LucideChevronRight,
	LucidePause,
	LucidePlay,
	LucideSkipBack,
	LucideSkipForward,
} from '@lucide/angular';
import { cueText, resolvePosition, resolveStyle } from '../../core/model/cue';
import { formatTimecode } from '../../core/time/timecode';
import { FileDrop } from '../../state/file-drop';
import { ProjectStore } from '../../state/project-store';
import { Button, IconButton } from '../../ui/button/button';
import { Select } from '../../ui/select/select';
import { Tooltip } from '../../ui/tooltip/tooltip';
import { captionTextStyle, captionWindowStyle } from './caption-render';
import { PLAYBACK_RATES, Playback } from './playback';

type PreviewMode = 'desktop' | 'mobile' | 'tv' | 'plain';

@Component({
	selector: 'bc-preview-panel',
	imports: [
		Button,
		IconButton,
		Select,
		Tooltip,
		LucideCaptions,
		LucideChevronLeft,
		LucideChevronRight,
		LucidePause,
		LucidePlay,
		LucideSkipBack,
		LucideSkipForward,
	],
	templateUrl: './preview-panel.html',
	styleUrl: './preview-panel.css',
})
export class PreviewPanel {
	protected readonly store = inject(ProjectStore);
	protected readonly playback = inject(Playback);
	private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
	private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

	protected readonly modes = [
		{ value: 'desktop' as PreviewMode, label: 'Desktop web' },
		{ value: 'mobile' as PreviewMode, label: 'Mobile app' },
		{ value: 'tv' as PreviewMode, label: 'TV' },
		{ value: 'plain' as PreviewMode, label: 'Plain (fallback)' },
	];
	protected readonly mode = signal<PreviewMode>('desktop');
	protected readonly showCaptions = signal(true);
	private readonly drop = inject(FileDrop);
	/** A file is being dragged over the window (the editor handles the drop). */
	protected readonly dragging = computed(() => !!this.drop.hover());
	/** Player height drives caption size, like YouTube's player. */
	private readonly frameHeight = signal(360);

	protected readonly timecode = computed(() =>
		formatTimecode(this.store.playhead(), this.store.project().fps),
	);
	protected readonly durationTc = computed(() =>
		formatTimecode(this.store.duration(), this.store.project().fps),
	);

	protected readonly captions = computed(() => {
		const p = this.store.project();
		const plain = this.mode() === 'plain';
		const fontPx = this.frameHeight() * 0.0533;
		return this.store.activeCues().map(({ track, cue }) => {
			const style = resolveStyle(p, track, cue);
			const pos = resolvePosition(p, track, cue);
			const textStyle = captionTextStyle(style, Math.max(1, fontPx / 18));
			if (plain) {
				// Plain formats drop styling and positioning: YouTube default look at the bottom.
				Object.assign(
					textStyle,
					captionTextStyle({
						...style,
						font: 'default',
						bold: false,
						italic: false,
						underline: false,
						textColor: '#FFFFFF',
						textOpacity: 1,
						bgColor: '#080808',
						bgOpacity: 0.75,
						edge: 'none',
					}),
				);
			}
			return {
				id: cue.id,
				selected: this.store.selection().has(cue.id),
				lines: cueText(cue).split('\n'),
				window: plain
					? captionWindowStyle({ ...pos, anchor: 7, x: 50, y: 90, align: 'center' })
					: captionWindowStyle(pos),
				text: { ...textStyle, 'font-size': `${fontPx * style.scale}px` },
			};
		});
	});

	constructor() {
		effect((onCleanup) => {
			const el = this.frame().nativeElement;
			const ro = new ResizeObserver(([e]) => this.frameHeight.set(e.contentRect.height));
			ro.observe(el);
			onCleanup(() => ro.disconnect());
		});
		effect(() => this.playback.attach(this.video()?.nativeElement ?? null));
	}

	protected cycleRate(): void {
		const i = PLAYBACK_RATES.indexOf(this.store.rate());
		this.store.rate.set(PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length]);
	}

	protected rateLabel = computed(
		() => `${this.store.rate() % 1 ? this.store.rate() : this.store.rate().toFixed(1)}×`,
	);
}
