import { Component, computed, inject, signal } from '@angular/core';
import * as edits from '../../core/commands/edits';
import { cueText, wordGap } from '../../core/model/cue';
import { Cue, Track } from '../../core/model/types';
import { formatTimecode } from '../../core/time/timecode';
import { ProjectStore } from '../../state/project-store';
import { Select } from '../../ui/select/select';
import { Playback } from '../player/playback';
import { CountPipe } from '../../ui/count/count';

/** Pause between cues that starts a new paragraph. */
const PARAGRAPH_GAP_MS = 1500;
const LOW_CONFIDENCE = 0.6;

interface Word {
	text: string;
	current: boolean;
	unsure: boolean;
	/** Space after the word (none in Chinese and Japanese). */
	gap: string;
}

interface Segment {
	cue: Cue;
	current: boolean;
	selected: boolean;
	/** Word spans when timings exist; otherwise null and the plain text is shown. */
	words: Word[] | null;
	text: string;
}

interface Paragraph {
	start: string;
	current: boolean;
	segments: Segment[];
}

/**
 * Descript-style document view of one track. Click a word or segment to seek;
 * double-click a segment to edit its text.
 */
@Component({
	selector: 'bc-transcript-view',
	imports: [CountPipe, Select],
	templateUrl: './transcript-view.html',
	styleUrl: './transcript-view.css',
})
export class TranscriptView {
	protected readonly store = inject(ProjectStore);
	private readonly playback = inject(Playback);

	protected readonly trackOptions = computed(() =>
		this.store.project().tracks.map((t) => ({ value: t.id, label: t.name })),
	);
	private readonly chosenTrack = signal<string | null>(null);
	protected readonly trackId = computed(
		() => this.chosenTrack() ?? this.store.project().tracks[0]?.id ?? '',
	);
	protected readonly track = computed<Track | undefined>(() => this.store.track(this.trackId()));
	protected readonly editing = signal<string | null>(null);

	protected readonly lowConfidence = computed(
		() =>
			this.track()
				?.cues.flatMap((c) => c.words ?? [])
				.filter((w) => (w.confidence ?? 1) < LOW_CONFIDENCE).length ?? 0,
	);

	protected readonly duration = computed(() => {
		const ms = this.store.duration();
		const m = Math.floor(ms / 60000);
		const s = Math.floor((ms % 60000) / 1000);
		return `${m}:${String(s).padStart(2, '0')}`;
	});

	protected readonly paragraphs = computed<Paragraph[]>(() => {
		const track = this.track();
		if (!track) return [];
		const t = this.store.playhead();
		const sel = this.store.selection();
		const out: Paragraph[] = [];
		let prevEnd = -Infinity;
		for (const cue of track.cues) {
			const current = cue.start <= t && t < cue.end;
			const seg: Segment = {
				cue,
				current,
				selected: sel.has(cue.id),
				text: cueText(cue),
				words:
					cue.words?.map((w, i, all) => ({
						text: w.text,
						current: current && w.start <= t && t < w.end,
						unsure: (w.confidence ?? 1) < LOW_CONFIDENCE,
						gap: wordGap(w.text, all[i + 1]?.text ?? ''),
					})) ?? null,
			};
			if (!out.length || cue.start - prevEnd > PARAGRAPH_GAP_MS) {
				// Paragraph timestamps are shown to the second, like the design.
				out.push({
					start: formatTimecode(cue.start, 1).slice(0, 8),
					current: false,
					segments: [],
				});
			}
			const para = out[out.length - 1];
			para.segments.push(seg);
			para.current ||= current;
			prevEnd = cue.end;
		}
		return out;
	});

	protected setTrack(id: string): void {
		this.chosenTrack.set(id);
	}

	protected clickSegment(e: MouseEvent, cue: Cue, wordIndex?: number): void {
		this.store.select(
			cue.id,
			e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace',
		);
		const w = wordIndex !== undefined ? cue.words?.[wordIndex] : undefined;
		this.playback.seek(w ? w.start : cue.start);
	}

	protected commit(cue: Cue, text: string): void {
		this.editing.set(null);
		const clean = text.replace(/\s*\n\s*/g, ' ').trim();
		if (clean !== cueText(cue).replace(/\n/g, ' '))
			this.store.apply('Edit text', edits.setText(cue.id, clean));
	}

	protected onEditKey(e: KeyboardEvent, cue: Cue): void {
		const el = e.target as HTMLElement;
		if (e.key === 'Escape') {
			el.textContent = cueText(cue);
			this.editing.set(null);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			el.blur();
		}
	}
}
