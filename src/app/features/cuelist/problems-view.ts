import { Component, computed, inject, signal } from '@angular/core';
import { LucideCircleX, LucideTriangleAlert } from '@lucide/angular';
import * as edits from '../../core/commands/edits';
import { cueText } from '../../core/model/cue';
import { CueId } from '../../core/model/types';
import { Problem, formatCps, readingSpeed } from '../../core/lint/rules';
import { formatTimecode } from '../../core/time/timecode';
import { ProjectStore } from '../../state/project-store';
import { Button } from '../../ui/button/button';
import { CountPipe } from '../../ui/count/count';
import { Select } from '../../ui/select/select';
import { EditorDialogs } from '../editor/editor-dialogs';
import { Playback } from '../player/playback';

const ALL = '__all__';
const HEAVY_KEY = 'srv3Weight';

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
	/** Ignored for this session only, not saved into the project file */
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
				const other = p.otherCueId && this.store.find(p.otherCueId);

				return {
					problem: p,
					key: problemKey(p),
					title: this.title(p),
					location: `Cue ${ref.index} • ${formatTimecode(ref.cue.start, fps)}`,
					detail: other
						? `Overlaps cue ${other.index}`
						: cueText(ref.cue).replace(/\n/g, ' '),
					fixLabel: this.fixLabel(p, ref.index),
					selected: this.store.selection().has(p.cueId),
				};
			});
	});

	/** The rules these checks use */
	protected readonly rules = computed(() => {
		const r = this.store.project().settings;

		return `${r.maxCharsPerLine} chars • ${r.maxLines} ${r.maxLines === 1 ? 'line' : 'lines'} • ${r.maxCps} cps • ${r.minDurationMs / 1000}–${r.maxDurationMs / 1000} s`;
	});

	protected readonly errors = computed(
		() => this.items().filter((i) => i.problem.severity === 'error').length,
	);
	/** How close the SRV3 file is to the size YouTube can show */
	protected readonly heavy = computed(() => {
		const weight = this.store.srv3Weight();

		if (!this.store.srv3Heavy() || this.ignored().has(HEAVY_KEY)) return null;

		return {
			over: weight >= 1,
			title:
				weight >= 1
					? 'SRV3 file may be too large for YouTube'
					: 'SRV3 file is close to the size limit',
			detail: `${Math.round(weight * 100)}% of the safe size. Merging cues, using fewer styles or less karaoke makes it smaller.`,
		};
	});
	/** Render one style problem warning per preset */
	protected readonly presetItems = computed(() => {
		const f = this.filter();
		const ignored = this.ignored();
		const selection = this.store.selection();
		const onTrack = (id: CueId) => f === ALL || this.store.find(id)?.track.id === f;

		return this.store
			.presetProblems()
			.map((pp) => ({
				...pp,
				key: `${pp.preset}:${pp.id}`,
				cueIds: pp.cueIds.filter(onTrack),
			}))
			.filter((pp) => pp.cueIds.length && !ignored.has(pp.key))
			.map((pp) => ({
				...pp,
				title: `${pp.name} preset: ${pp.message[0].toLowerCase()}${pp.message.slice(1)}`,
				location: `${pp.preset === 'style' ? 'Style' : 'Position'} preset • ${pp.cueIds.length} ${pp.cueIds.length === 1 ? 'cue' : 'cues'}`,
				selected: pp.cueIds.every((id) => selection.has(id)),
			}));
	});
	protected readonly warnings = computed(
		() =>
			this.items().length -
			this.errors() +
			this.presetItems().length +
			(this.heavy() ? 1 : 0),
	);

	private title(p: Problem): string {
		const ref = this.store.find(p.cueId)!;
		const dur = ((ref.cue.end - ref.cue.start) / 1000).toFixed(1);

		switch (p.kind) {
			case 'overlap':
				return `Overlap on ${ref.track.name}`;
			case 'cps':
				return `Reading speed ${formatCps(readingSpeed(ref.cue))} cps`;
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
			case 'mobile':
				return p.message;
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

	protected readonly heavyKey = HEAVY_KEY;

	/** Select every cue the preset problem covers */
	protected openPreset(cueIds: CueId[]): void {
		this.store.selection.set(new Set(cueIds));

		const first = this.store.find(cueIds[0])?.cue;

		if (first) this.playback.seek(first.start);
	}

	protected ignore(key: string): void {
		this.ignored.update((s) => new Set(s).add(key));
	}
}
