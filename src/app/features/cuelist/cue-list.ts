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
import { LucideSearch } from '@lucide/angular';
import * as edits from '../../core/commands/edits';
import { cueText } from '../../core/model/cue';
import { readingSpeed } from '../../core/lint/rules';
import { formatTimecode } from '../../core/time/timecode';
import { CueRef, ProjectStore } from '../../state/project-store';
import { Field } from '../../ui/field/field';
import { Autofocus } from '../../ui/autofocus/autofocus';
import { isDesktop } from '../../state/file-io';
import { Playback } from '../player/playback';
import { CountPipe } from '../../ui/count/count';

@Component({
	selector: 'bc-cue-list',
	imports: [CountPipe, Field, Autofocus, LucideSearch],
	templateUrl: './cue-list.html',
	styleUrl: './cue-list.css',
})
export class CueList {
	protected readonly store = inject(ProjectStore);
	protected readonly canTranscribe = isDesktop;
	private readonly playback = inject(Playback);
	private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

	protected readonly query = signal('');
	protected readonly editing = signal<string | null>(null);

	/** Rows don't depend on the playhead or selection, so playback doesn't rebuild them. */
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
				return {
					ref: r,
					id: r.cue.id,
					text: cueText(r.cue),
					timing: `${formatTimecode(r.cue.start, fps)} → ${formatTimecode(r.cue.end, fps)}`,
					cps: cps > maxCps ? Math.round(cps) : null,
					problem: problems.get(r.cue.id)?.[0]?.severity ?? null,
				};
			});
	});

	/** First listed cue under the playhead; only changes when playback reaches another cue. */
	protected readonly playingId = computed(() => {
		const t = this.store.playhead();
		return this.rows().find((r) => r.ref.cue.start <= t && t < r.ref.cue.end)?.id ?? null;
	});

	protected readonly warnings = computed(() => this.store.problems().length);
	protected readonly trackCount = computed(() => this.store.project().tracks.length);

	constructor() {
		// Keep the playing cue in view during playback.
		effect(() => {
			if (!this.store.playing()) return;
			const playing = this.playingId();
			if (!playing) return;
			untracked(() => this.scrollTo(playing));
		});
		// And the selected cue when selection changes elsewhere (timeline, problems).
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
			// Enter commits; Shift+Enter inserts a line break.
			e.preventDefault();
			this.commit(id, el.value);
		}
	}
}
