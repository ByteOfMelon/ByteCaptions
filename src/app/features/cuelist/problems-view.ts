import { Component, computed, inject, signal } from '@angular/core';
import { LucideCircleX, LucideTriangleAlert } from '@lucide/angular';
import * as edits from '../../core/commands/edits';
import { cueText } from '../../core/model/cue';
import { Problem, readingSpeed } from '../../core/lint/rules';
import { formatTimecode } from '../../core/time/timecode';
import { EditorDialogs } from '../editor/editor-dialogs';
import { ProjectStore } from '../../state/project-store';
import { Button } from '../../ui/button/button';
import { Select } from '../../ui/select/select';
import { Playback } from '../player/playback';
import { CountPipe } from '../../ui/count/count';

const ALL = '__all__';

function problemKey(p: Problem): string {
	return `${p.cueId}:${p.kind}`;
}

@Component({
	selector: 'bc-problems-view',
	imports: [CountPipe, Button, Select, LucideCircleX, LucideTriangleAlert],
	templateUrl: './problems-view.html',
	styleUrl: './problems-view.css',
})
export class ProblemsView {
	protected readonly store = inject(ProjectStore);
	private readonly playback = inject(Playback);
	protected readonly dialogs = inject(EditorDialogs);

	protected readonly filter = signal<string>(ALL);
	/** Ignored for this session; persisting ignores in the project is a later decision. */
	private readonly ignored = signal<ReadonlySet<string>>(new Set());

	protected readonly filterOptions = computed(() => [
		{ value: ALL, label: 'All tracks' },
		...this.store.project().tracks.map((t) => ({ value: t.id, label: t.name })),
	]);

	protected readonly items = computed(() => {
		const f = this.filter();
		const fps = this.store.project().fps;
		const ignored = this.ignored();
		return this.store
			.problems()
			.filter((p) => (f === ALL || p.trackId === f) && !ignored.has(problemKey(p)))
			.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
			.map((p) => {
				const ref = this.store.find(p.cueId)!;
				return {
					problem: p,
					key: problemKey(p),
					title: this.title(p),
					location: `Cue ${ref.index} • ${formatTimecode(ref.cue.start, fps)}`,
					detail:
						p.kind === 'overlap'
							? p.message.replace('the next cue', `cue ${ref.index + 1}`)
							: cueText(ref.cue).replace(/\n/g, ' '),
					fixLabel: this.fixLabel(p, ref.index),
					selected: this.store.selection().has(p.cueId),
				};
			});
	});

	/** "42 chars • 2 lines • 20 cps • 0.7–7 s": the rules the checks use. */
	protected readonly rules = computed(() => {
		const r = this.store.project().settings;
		return `${r.maxCharsPerLine} chars • ${r.maxLines} ${r.maxLines === 1 ? 'line' : 'lines'} • ${r.maxCps} cps • ${r.minDurationMs / 1000}–${r.maxDurationMs / 1000} s`;
	});

	protected readonly errors = computed(
		() => this.items().filter((i) => i.problem.severity === 'error').length,
	);
	protected readonly warnings = computed(() => this.items().length - this.errors());

	private title(p: Problem): string {
		const ref = this.store.find(p.cueId)!;
		const dur = ((ref.cue.end - ref.cue.start) / 1000).toFixed(1);
		switch (p.kind) {
			case 'overlap':
				return `Overlap on ${ref.track.name}`;
			case 'cps':
				return `Reading speed ${Math.round(readingSpeed(ref.cue))} cps`;
			case 'tooShort':
				return `Too short (${dur} s)`;
			case 'tooLong':
				return `Too long (${dur} s)`;
			case 'gap':
				return 'Gap too small';
			case 'lineLength':
				return 'Line too long';
			case 'tooManyLines':
				return 'Too many lines';
			case 'speaker':
				return 'Unsure speaker';
		}
	}

	private fixLabel(p: Problem, index: number): string | null {
		const fix = p.fix;
		if (!fix) return null;
		if (fix.kind === 'split') return `Split cue ${index}`;
		if (fix.kind === 'confirmSpeaker') return fix.label;
		if (p.kind === 'overlap') return `Trim cue ${index}`;
		return `Extend to ${((fix.end - fix.start) / 1000).toFixed(1)} s`;
	}

	protected open(p: Problem): void {
		this.store.select(p.cueId);
		const cue = this.store.find(p.cueId)?.cue;
		if (cue) this.playback.seek(cue.start);
	}

	protected applyFix(p: Problem): void {
		const fix = p.fix;
		const cue = this.store.find(p.cueId)?.cue;
		if (!fix || !cue) return;
		if (fix.kind === 'setTiming')
			this.store.apply(fix.label, edits.setTiming(p.cueId, fix.start, fix.end));
		else if (fix.kind === 'confirmSpeaker')
			this.store.apply('Confirm speaker', edits.confirmSpeaker([p.cueId]));
		else
			this.store.apply(
				'Split cue',
				edits.splitCue(p.cueId, Math.round((cue.start + cue.end) / 2)),
			);
	}

	protected ignore(key: string): void {
		this.ignored.update((s) => new Set(s).add(key));
	}
}
