import {
	Component,
	ElementRef,
	computed,
	effect,
	inject,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { LucideSearch, LucideX } from '@lucide/angular';
import * as edits from '../../core/commands/edits';
import { readingSpeed } from '../../core/lint/rules';
import { cueText } from '../../core/model/cue';
import { CueId } from '../../core/model/types';
import { formatTimecode, parseTime } from '../../core/time/timecode';
import { EditorUi } from '../../state/editor-ui';
import { isDesktop } from '../../state/file-io';
import { CueRef, ProjectStore } from '../../state/project-store';
import { Autofocus } from '../../ui/autofocus/autofocus';
import { Button, IconButton } from '../../ui/button/button';
import { CountPipe } from '../../ui/count/count';
import { Field } from '../../ui/field/field';
import { ErrorTip } from '../../ui/tooltip/tooltip';
import { Playback } from '../player/playback';

@Component({
	selector: 'bc-cue-list',
	imports: [CountPipe, Field, Autofocus, ErrorTip, Button, IconButton, LucideSearch, LucideX],
	templateUrl: './cue-list.html',
	styleUrl: './cue-list.css',
})
export class CueList {
	protected readonly store = inject(ProjectStore);
	protected readonly canTranscribe = isDesktop;
	private readonly playback = inject(Playback);
	private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

	protected readonly ui = inject(EditorUi);
	protected readonly edges = ['start', 'end'] as const;
	protected readonly query = signal('');
	protected readonly replacement = signal('');
	protected readonly editing = signal<string | null>(null);
	/** The start or end time being typed into */
	protected readonly editingTime = signal<{ id: CueId; edge: 'start' | 'end' } | null>(null);
	protected readonly timeError = signal<string | null>(null);

	protected readonly rows = computed(() => {
		const q = this.query().trim().toLowerCase();
		const fps = this.store.project().fps;
		const problems = this.store.problemsByCue();
		const maxCps = this.store.project().settings.maxCps;
		return this.store
			.allCues()
			.filter((r) => !q || cueText(r.cue).toLowerCase().includes(q))
			.map((r) => {
				const cps = readingSpeed(r.cue);
				const text = cueText(r.cue);
				return {
					ref: r,
					id: r.cue.id,
					text,
					parts: q ? splitMatches(text, q) : [{ text, hit: false }],
					start: formatTimecode(r.cue.start, fps),
					end: formatTimecode(r.cue.end, fps),
					duration: `${((r.cue.end - r.cue.start) / 1000).toFixed(1)}s`,
					cps: cps > maxCps ? Math.round(cps) : null,
					problem: problems.get(r.cue.id)?.[0]?.severity ?? null,
				};
			});
	});

	/** Provide summary of search results to user */
	protected readonly matchSummary = computed(() => {
		const rows = this.rows();
		if (!this.query().trim()) return null;
		const n = rows.reduce((sum, r) => sum + r.parts.filter((p) => p.hit).length, 0);
		return `${n} ${n === 1 ? 'match' : 'matches'} in ${rows.length} ${rows.length === 1 ? 'cue' : 'cues'}`;
	});

	/** Listed cue under the playhead */
	protected readonly playingId = computed(() => {
		const t = this.store.playhead();
		return this.rows().find((r) => r.ref.cue.start <= t && t < r.ref.cue.end)?.id ?? null;
	});

	protected readonly warnings = computed(() => this.store.problems().length);
	protected readonly trackCount = computed(() => this.store.project().tracks.length);

	constructor() {
		// Keep the playing cue in view during playback
		effect(() => {
			if (!this.store.playing()) return;
			const playing = this.playingId();
			if (!playing) return;
			untracked(() => this.scrollTo(playing));
		});
		// And the selected cue when selection changes elsewhere (timeline, problems)
		effect(() => {
			const id = this.store.primary()?.cue.id;
			if (id) untracked(() => this.scrollTo(id));
		});
	}

	private scrollTo(id: string): void {
		const el = this.list().nativeElement.querySelector<HTMLElement>(`[data-cue="${id}"]`);
		el?.scrollIntoView({ block: 'nearest' });
	}

	protected click(e: MouseEvent, r: CueRef): void {
		this.store.select(
			r.cue.id,
			e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace',
		);
		if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.playback.seek(r.cue.start);
	}

	protected commit(id: string, text: string): void {
		this.editing.set(null);
		const cue = this.store.find(id)?.cue;
		if (cue && cueText(cue) !== text) this.store.apply('Edit text', edits.setText(id, text));
	}

	protected onEditKey(e: KeyboardEvent, id: string): void {
		const el = e.target as HTMLTextAreaElement;
		if (e.key === 'Escape') {
			this.editing.set(null);
		} else if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			this.commit(id, el.value);
		}
	}

	protected editTime(e: MouseEvent, r: CueRef, edge: 'start' | 'end'): void {
		// The first click selects the cue, clicking a time of the selected cue edits it
		if (
			r.track.locked ||
			!this.store.selection().has(r.cue.id) ||
			e.shiftKey ||
			e.ctrlKey ||
			e.metaKey
		)
			return;
		e.stopPropagation();
		this.editingTime.set({ id: r.cue.id, edge });
	}

	/** Explain to the user why their entered time is invalid (if necessary) */
	private timeProblem(text: string): string | null {
		const t = this.editingTime();
		const cue = t && this.store.find(t.id)?.cue;

		if (!cue) return null;
		const ms = parseTime(text, this.store.project().fps);
		if (ms === null) return 'Not a valid time.';

		if (t.edge === 'start' && ms >= cue.end) return 'Start must be before end.';
		if (t.edge === 'end' && ms <= cue.start) return 'End must be after start.';
		return null;
	}

	protected commitTime(text: string, keepOpen = false): void {
		const t = this.editingTime();
		if (!t) return;

		const error = this.timeProblem(text);
		if (error && keepOpen) return this.timeError.set(error);
		this.closeTime();

		const cue = this.store.find(t.id)?.cue;
		const ms = parseTime(text, this.store.project().fps);
		if (error || !cue || ms === null) return;

		const [start, end] = t.edge === 'start' ? [ms, cue.end] : [cue.start, ms];
		if (start === cue.start && end === cue.end) return;

		this.store.apply(
			t.edge === 'start' ? 'Set start' : 'Set end',
			edits.setTiming(t.id, start, end),
		);
	}

	/** Once shown, the error follows the typing */
	protected onTimeInput(text: string): void {
		if (this.timeError()) this.timeError.set(this.timeProblem(text));
	}

	protected onTimeKey(e: KeyboardEvent): void {
		if (e.key === 'Enter') this.commitTime((e.target as HTMLInputElement).value, true);
		else if (e.key === 'Escape') {
			e.stopPropagation();
			this.closeTime();
		}
	}

	private closeTime(): void {
		this.editingTime.set(null);
		this.timeError.set(null);
	}

	private replaced(text: string): string {
		return text.replace(matcher(this.query().trim()), () => this.replacement());
	}

	/** Replace in the selected matching cue (or the first one), then select the next match */
	protected replaceOne(): void {
		const rows = this.rows().filter((r) => !r.ref.track.locked);
		if (!rows.length) return;
		const at = rows.findIndex((r) => this.store.selection().has(r.id));
		const target = rows[Math.max(0, at)];
		this.store.apply('Replace', edits.setText(target.id, this.replaced(target.text)));
		const next = this.rows().find((r) => r.ref.index > target.ref.index && !r.ref.track.locked);
		if (next) {
			this.store.select(next.id);
			this.playback.seek(next.ref.cue.start);
		}
	}

	protected replaceAll(): void {
		const rows = this.rows().filter((r) => !r.ref.track.locked);
		if (!rows.length) return;
		const n = rows.reduce((sum, r) => sum + r.parts.filter((p) => p.hit).length, 0);
		this.store.apply(`Replace ${n} ${n === 1 ? 'match' : 'matches'}`, (p) => {
			for (const r of rows) edits.setText(r.id, this.replaced(r.text))(p);
		});
	}

	protected closeReplace(): void {
		this.ui.replaceOpen.set(false);
		this.replacement.set('');
	}
}

/** Case-insensitive match of the query */
function matcher(query: string): RegExp {
	return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
}

/** text split into runs, marking the ones that match the search */
function splitMatches(text: string, query: string): { text: string; hit: boolean }[] {
	const parts: { text: string; hit: boolean }[] = [];
	let last = 0;
	for (const m of text.matchAll(matcher(query))) {
		if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
		parts.push({ text: m[0], hit: true });
		last = m.index + m[0].length;
	}
	if (last < text.length) parts.push({ text: text.slice(last), hit: false });
	return parts;
}
