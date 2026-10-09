import {
	Component,
	DestroyRef,
	ElementRef,
	computed,
	effect,
	inject,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import {
	LucideBold,
	LucideCaptions,
	LucideChevronLeft,
	LucideChevronRight,
	LucideFolder,
	LucideItalic,
	LucidePause,
	LucidePlay,
	LucideSkipBack,
	LucideSkipForward,
	LucideUnderline,
} from '@lucide/angular';
import { cueText, resolvePosition, resolveStyle } from '../../core/model/cue';
import { CaptionStyle, TextRun } from '../../core/model/types';
import { TextFormat } from '../../state/text-format';
import * as edits from '../../core/commands/edits';
import { formatTimecode } from '../../core/time/timecode';
import { Autofocus } from '../../ui/autofocus/autofocus';
import { FileDrop } from '../../state/file-drop';
import { VIDEO_FILTER, basename, isDesktop, openFile } from '../../state/file-io';
import { ProjectFiles } from '../../state/project-files';
import { ProjectStore } from '../../state/project-store';
import { Button, IconButton } from '../../ui/button/button';
import { Select } from '../../ui/select/select';
import { Tooltip } from '../../ui/tooltip/tooltip';
import { captionTextStyle, captionWindowStyle } from './caption-render';
import { PLAYBACK_RATES, Playback } from './playback';

type PreviewMode = 'desktop' | 'mobile' | 'plain';

@Component({
	selector: 'bc-preview-panel',
	imports: [
		Autofocus,
		Button,
		IconButton,
		Select,
		Tooltip,
		LucideBold,
		LucideCaptions,
		LucideChevronLeft,
		LucideChevronRight,
		LucideFolder,
		LucideItalic,
		LucidePause,
		LucidePlay,
		LucideSkipBack,
		LucideSkipForward,
		LucideUnderline,
	],
	templateUrl: './preview-panel.html',
	styleUrl: './preview-panel.css',
})
export class PreviewPanel {
	protected readonly store = inject(ProjectStore);
	protected readonly playback = inject(Playback);
	private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
	private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
	private readonly editor = viewChild<ElementRef<HTMLElement>>('editor');
	protected readonly format = inject(TextFormat);
	/**
	 * The selection kept while focus is in the Inspector or the format bar, shown with a
	 * highlight (the editor's own selection hides when it loses focus).
	 */
	protected readonly keptRange = signal<{ start: number; end: number } | null>(null);
	/** Where the format bar sits: above the selection, in stage pixels. */
	private readonly barAt = signal<{ x: number; y: number } | null>(null);
	protected readonly formatBar = computed(() => {
		const at = this.barAt();
		const active = this.format.active();
		return at && active && this.editing() === active.cueId
			? { ...at, style: active.style }
			: null;
	});

	protected readonly modes = [
		{ value: 'desktop' as PreviewMode, label: 'Desktop web' },
		{ value: 'mobile' as PreviewMode, label: 'Mobile app' },
		{ value: 'plain' as PreviewMode, label: 'Plain (fallback)' },
	];
	protected readonly mode = signal<PreviewMode>('desktop');
	protected readonly showCaptions = signal(true);
	/** Cue whose caption is being edited in place (double-click). */
	protected readonly editing = signal<string | null>(null);
	private readonly drop = inject(FileDrop);
	/** A file is being dragged over the window (the editor handles the drop). */
	protected readonly dragging = computed(() => !!this.drop.hover());
	private readonly files = inject(ProjectFiles);
	protected readonly isDesktop = isDesktop;
	/** The project's video when it isn't playing: moved on desktop, or not picked yet in the browser. */
	protected readonly missingVideo = computed(() => {
		const path = this.store.project().media?.path;
		return path && !this.playback.mediaUrl() ? { path, name: basename(path) } : null;
	});
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
		const mobile = this.mode() === 'mobile';
		const fontPx = this.frameHeight() * 0.0533;
		return this.store.activeCues().map(({ track, cue }) => {
			let style = resolveStyle(p, track, cue);
			// YouTube's mobile apps draw every caption on a black box, at one fixed size.
			if (mobile) style = { ...style, bgColor: '#080808', bgOpacity: 0.75, scale: 1 };
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
				locked: track.locked,
				selected: this.store.selection().has(cue.id),
				lines: lines(cue.runs).map((line) =>
					line.map((r) => ({
						text: r.text,
						style:
							plain || !r.styleOverride
								? {}
								: runStyle(style, r.styleOverride, Math.max(1, fontPx / 18)),
					})),
				),
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

		// Fill the editor with the cue's formatted text when editing starts.
		effect(() => {
			const el = this.editor()?.nativeElement;
			const id = this.editing();
			if (!el || !id) return;
			untracked(() => {
				this.renderEditor(el, id);
				this.format.attach((change) => this.applyFormat(change));
			});
		});
		// The kept selection shows as a highlight while focus is elsewhere.
		effect(() => {
			const kept = this.keptRange();
			const el = this.editor()?.nativeElement;
			const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
			const Highlight = (globalThis as unknown as { Highlight?: new (r: Range) => unknown })
				.Highlight;
			if (!highlights || !Highlight) return;
			const range = kept && el ? rangeAt(el, kept.start, kept.end) : null;
			if (range) highlights.set('bc-kept-selection', new Highlight(range));
			else highlights.delete('bc-kept-selection');
		});

		const onSelection = () => {
			const el = this.editor()?.nativeElement;
			const id = this.editing();
			const sel = document.getSelection();
			if (!el || !id || !sel?.rangeCount || !el.contains(sel.anchorNode)) return;
			const r = sel.getRangeAt(0);
			const start = offsetIn(el, r.startContainer, r.startOffset);
			let end = offsetIn(el, r.endContainer, r.endOffset);
			// Double-clicking a word also selects the space after it; leave that out, like
			// word processors do.
			const text = textOf(el);
			while (end > start + 1 && /\s/.test(text[end - 1])) end--;
			this.format.selection.set({ cueId: id, start, end });
			this.placeBar(r);
		};
		// With the selection kept, going anywhere but the caption, Inspector or format bar
		// ends editing.
		const onOutside = (e: Event) => {
			const id = this.editing();
			if (!id || !this.keptRange()) return;
			const t = e.target as Element | null;
			if (t?.closest?.('[data-keeps-text-selection]')) return;
			if (this.editor()?.nativeElement.contains(t)) return;
			this.finish(id);
		};
		document.addEventListener('selectionchange', onSelection);
		document.addEventListener('pointerdown', onOutside, true);
		document.addEventListener('focusin', onOutside);
		inject(DestroyRef).onDestroy(() => {
			document.removeEventListener('selectionchange', onSelection);
			document.removeEventListener('pointerdown', onOutside, true);
			document.removeEventListener('focusin', onOutside);
			this.format.detach();
		});
	}

	/** Put the cue's runs into the editor as styled spans. */
	private renderEditor(el: HTMLElement, id: string): void {
		const ref = this.store.find(id);
		if (!ref) return;
		const base = resolveStyle(this.store.project(), ref.track, ref.cue);
		const unit = Math.max(1, (this.frameHeight() * 0.0533) / 18);
		el.replaceChildren(
			...ref.cue.runs.map((r) => {
				const span = document.createElement('span');
				span.textContent = r.text;
				if (r.styleOverride && this.mode() !== 'plain')
					for (const [k, v] of Object.entries(runStyle(base, r.styleOverride, unit)))
						span.style.setProperty(k, v);
				return span;
			}),
		);
	}

	/** Position the format bar above a range in the editor. */
	private placeBar(r: Range): void {
		if (r.collapsed) return this.barAt.set(null);
		const box = r.getBoundingClientRect();
		const stage = this.frame().nativeElement.getBoundingClientRect();
		this.barAt.set({ x: box.left + box.width / 2 - stage.left, y: box.top - stage.top });
	}

	/** Format the selection: save the typed text and the change as one undo step. */
	private applyFormat(change: Partial<CaptionStyle> | 'clear'): void {
		const el = this.editor()?.nativeElement;
		const id = this.editing();
		const sel = this.format.selection();
		if (!el || !id || !sel || sel.cueId !== id) return;
		const text = textOf(el).replace(/\n+$/, '');
		this.store.apply(change === 'clear' ? 'Clear formatting' : 'Format text', (p) => {
			edits.setText(id, text)(p);
			edits.styleText(id, sel.start, sel.end, change)(p);
		});
		this.renderEditor(el, id);
		const range = rangeAt(el, sel.start, sel.end);
		if (document.activeElement === el && range) {
			const s = document.getSelection();
			s?.removeAllRanges();
			s?.addRange(range);
		} else this.keptRange.set({ start: sel.start, end: sel.end });
		if (range) this.placeBar(range);
	}

	/** Format bar buttons keep the caption focused, and with it the selection. */
	protected keepFocus(e: MouseEvent): void {
		if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
	}

	protected onEditorBlur(id: string): void {
		// Wait for focus to land: the Inspector and format bar keep the selection.
		setTimeout(() => {
			if (this.editing() !== id) return;
			const el = this.editor()?.nativeElement;
			const now = document.activeElement;
			if (el && now === el) return;
			const sel = this.format.selection();
			if (now?.closest('[data-keeps-text-selection]') && sel && sel.end > sel.start) {
				this.keptRange.set({ start: sel.start, end: sel.end });
				return;
			}
			this.finish(id);
		});
	}

	private finish(id: string): void {
		const el = this.editor()?.nativeElement;
		if (el) this.commit(id, textOf(el));
	}

	/** Clicking a caption selects its cue instead of toggling playback. */
	protected async locateVideo(): Promise<void> {
		const file = await openFile(VIDEO_FILTER);
		if (file) await this.files.linkVideo(file, 'Relink video');
	}

	protected select(e: MouseEvent, id: string): void {
		e.stopPropagation();
		this.store.select(id);
	}

	protected edit(id: string, locked: boolean): void {
		if (locked) return;
		this.playback.pause();
		this.store.select(id);
		this.editing.set(id);
	}

	protected commit(id: string, text: string): void {
		if (this.editing() !== id) return;
		this.stopEditing();
		const cue = this.store.find(id)?.cue;
		const clean = text.replace(/\n+$/, '');
		if (cue && clean !== cueText(cue)) this.store.apply('Edit text', edits.setText(id, clean));
	}

	protected onEditKey(e: KeyboardEvent, id: string): void {
		const el = e.target as HTMLElement;
		const toggles = { b: 'bold', i: 'italic', u: 'underline' } as const;
		const key = e.key.toLowerCase() as keyof typeof toggles;
		if (e.key === 'Escape') {
			e.stopPropagation();
			this.stopEditing();
		} else if (e.key === 'Enter' && !e.shiftKey) {
			// Enter saves; Shift+Enter adds a line break.
			e.preventDefault();
			this.commit(id, textOf(el));
		} else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && toggles[key]) {
			// Ctrl+B / I / U format the selection.
			e.preventDefault();
			e.stopPropagation();
			this.format.toggle(toggles[key]);
		}
	}

	private stopEditing(): void {
		this.editing.set(null);
		this.keptRange.set(null);
		this.barAt.set(null);
		this.format.detach();
	}

	protected cycleRate(): void {
		const i = PLAYBACK_RATES.indexOf(this.store.rate());
		this.store.rate.set(PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length]);
	}

	protected rateLabel = computed(
		() => `${this.store.rate() % 1 ? this.store.rate() : this.store.rate().toFixed(1)}×`,
	);
}

/** A cue's runs cut into lines at its line breaks. */
function lines(runs: readonly TextRun[]): TextRun[][] {
	const out: TextRun[][] = [[]];
	for (const r of runs)
		r.text.split('\n').forEach((part, i) => {
			if (i) out.push([]);
			if (part) out.at(-1)!.push({ ...r, text: part });
		});
	return out;
}

/** The editor's text: its text nodes, with <br> and new blocks as line breaks. */
function textOf(node: Node): string {
	let out = '';
	node.childNodes.forEach((n) => {
		if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
		else if (n.nodeName === 'BR') out += '\n';
		else {
			if ((n.nodeName === 'DIV' || n.nodeName === 'P') && out && !out.endsWith('\n'))
				out += '\n';
			out += textOf(n);
		}
	});
	return out;
}

/** Character offset of a DOM position within the editor. */
function offsetIn(root: HTMLElement, node: Node, offset: number): number {
	const r = document.createRange();
	r.setStart(root, 0);
	r.setEnd(node, offset);
	return textOf(r.cloneContents()).length;
}

/** A DOM range over characters [start, end) of the editor's text. */
function rangeAt(root: HTMLElement, start: number, end: number): Range | null {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const r = document.createRange();
	let at = 0;
	let started = false;
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const len = n.textContent?.length ?? 0;
		if (!started && start <= at + len) {
			r.setStart(n, start - at);
			started = true;
		}
		if (started && end <= at + len) {
			r.setEnd(n, end - at);
			return r;
		}
		at += len;
	}
	return null;
}

/**
 * A formatted run's style inside its line. The line already paints the background, so a run
 * paints one only when it changes it (else the see-through colour would show twice).
 */
function runStyle(
	base: CaptionStyle,
	override: Partial<CaptionStyle>,
	unit: number,
): Record<string, string> {
	const out = captionTextStyle({ ...base, ...override }, unit);
	if (override.bgColor === undefined && override.bgOpacity === undefined)
		out['background-color'] = 'transparent';
	return out;
}
