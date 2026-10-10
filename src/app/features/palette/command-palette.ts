import {
	Component,
	ElementRef,
	OnInit,
	computed,
	effect,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';
import { LucideCaptions, LucideClock, LucideDynamicIcon, LucideSearch } from '@lucide/angular';
import { cueText } from '../../core/model/cue';
import { formatTimecode, parseTime } from '../../core/time/timecode';
import { CueRef, ProjectStore } from '../../state/project-store';
import { Autofocus } from '../../ui/autofocus/autofocus';
import { DialogRef } from '../../ui/dialog/dialog';
import { Kbd } from '../../ui/kbd/kbd';
import { Command, CommandRegistry } from '../editor/command-registry';
import { Playback } from '../player/playback';

type Item =
	| { kind: 'command'; key: string; cmd: Command }
	| { kind: 'cue'; key: string; ref: CueRef; text: string }
	| { kind: 'time'; key: string; ms: number };

interface Section {
	title: string;
	items: Item[];
}

const RECENT_KEY = 'bc.recentCommands';
// Commands missing from this build (transcribe, on the web) are skipped
const DEFAULT_RECENT = ['transcribe', 'export'];
const MAX_CUES = 5;

function loadRecent(): string[] {
	try {
		const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null');

		return Array.isArray(v) ? v : DEFAULT_RECENT;
	} catch {
		return DEFAULT_RECENT;
	}
}

/** Split text into plain / matched runs for highlighting */
function highlight(text: string, q: string): { t: string; m: boolean }[] {
	if (!q) return [{ t: text, m: false }];

	const i = text.toLowerCase().indexOf(q.toLowerCase());

	if (i < 0) return [{ t: text, m: false }];

	return [
		{ t: text.slice(0, i), m: false },
		{ t: text.slice(i, i + q.length), m: true },
		{ t: text.slice(i + q.length), m: false },
	].filter((s) => s.t);
}

/** Commands, cue text search and "go to timecode" */
@Component({
	selector: 'bc-command-palette',
	imports: [Kbd, Autofocus, LucideDynamicIcon, LucideSearch, LucideCaptions, LucideClock],
	templateUrl: './command-palette.html',
	styleUrl: './command-palette.css',
})
export class CommandPalette implements OnInit {
	/** 'timecode' opens straight into the Go to timecode prompt */
	readonly startMode = input<'search' | 'timecode'>('search');
	private readonly ref = inject(DialogRef);
	private readonly registry = inject(CommandRegistry);
	private readonly store = inject(ProjectStore);
	private readonly playback = inject(Playback);
	private readonly list = viewChild<ElementRef<HTMLElement>>('list');

	protected readonly query = signal('');
	protected readonly mode = signal<'search' | 'timecode'>('search');
	protected readonly active = signal(0);
	protected readonly highlight = highlight;

	protected readonly placeholder = computed(() =>
		this.mode() === 'timecode'
			? 'Type a timecode, e.g. 1:23 or 00:01:23:15'
			: 'Search commands, cues or a timecode',
	);

	private readonly enabled = computed(() =>
		this.registry.all().filter((c) => c.enabled?.() ?? true),
	);

	protected readonly sections = computed<Section[]>(() => {
		const q = this.query().trim();
		const fps = this.store.project().fps;
		const ms = q ? parseTime(q, fps) : null;
		const time: Item[] = ms !== null ? [{ kind: 'time', key: 'time', ms }] : [];

		if (this.mode() === 'timecode') return time.length ? [{ title: 'Go to', items: time }] : [];

		if (!q) {
			const primary = this.store.primary();
			const forCue = primary ? this.enabled().filter((c) => c.scope === 'cue') : [];
			const recent = loadRecent()
				.map((id) => this.enabled().find((c) => c.id === id))
				.filter((c): c is Command => !!c && c.scope !== 'cue')
				.slice(0, 4);
			const cmd = (c: Command): Item => ({ kind: 'command', key: c.id, cmd: c });

			return [
				{
					title: primary ? `For cue ${primary.index}` : '',
					items: forCue.slice(0, 3).map(cmd),
				},
				{ title: 'Recent', items: recent.map(cmd) },
			].filter((s) => s.items.length);
		}

		const ql = q.toLowerCase();
		const commands: Item[] = this.enabled()
			.filter((c) => c.label.toLowerCase().includes(ql))
			.sort(
				(a, b) =>
					Number(!a.label.toLowerCase().startsWith(ql)) -
					Number(!b.label.toLowerCase().startsWith(ql)),
			)
			.map((c) => ({ kind: 'command', key: c.id, cmd: c }));
		const cues: Item[] = [];

		for (const ref of this.store.allCues()) {
			const text = cueText(ref.cue).replace(/\n/g, ' ');

			if (text.toLowerCase().includes(ql))
				cues.push({ kind: 'cue', key: ref.cue.id, ref, text });

			if (cues.length >= MAX_CUES) break;
		}

		return [
			{ title: 'Go to', items: time },
			{ title: 'Commands', items: commands },
			{ title: 'Cues', items: cues },
		].filter((s) => s.items.length);
	});

	protected readonly items = computed(() => this.sections().flatMap((s) => s.items));

	protected readonly summary = computed(() => {
		if (!this.query().trim() || this.mode() === 'timecode') return '';

		const n = (k: Item['kind']) => this.items().filter((i) => i.kind === k).length;
		const plural = (c: number, w: string) => `${c} ${w}${c === 1 ? '' : 's'}`;

		return `${plural(n('command'), 'command')} • ${plural(n('cue'), 'cue')}`;
	});

	constructor() {
		// Reset the highlight whenever the results change, and keep it in view
		effect(() => {
			this.items();
			this.active.set(0);
		});
		effect(() => {
			const i = this.active();
			this.list()
				?.nativeElement.querySelector(`[data-index="${i}"]`)
				?.scrollIntoView({ block: 'nearest' });
		});
	}

	ngOnInit(): void {
		this.mode.set(this.startMode());
	}

	protected index(item: Item): number {
		return this.items().indexOf(item);
	}

	protected timecode(ms: number): string {
		return formatTimecode(ms, this.store.project().fps);
	}

	protected onKey(e: KeyboardEvent): void {
		const n = this.items().length;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();

				if (n) this.active.set((this.active() + 1) % n);

				break;
			case 'ArrowUp':
				e.preventDefault();

				if (n) this.active.set((this.active() - 1 + n) % n);

				break;
			case 'Enter': {
				e.preventDefault();
				const item = this.items()[this.active()];

				if (item) this.run(item);

				break;
			}
			case 'Backspace':
				if (!this.query() && this.mode() === 'timecode') this.mode.set('search');

				break;
		}
	}

	protected run(item: Item): void {
		if (item.kind === 'command' && item.cmd.prompt === 'timecode') {
			this.mode.set('timecode');
			this.query.set('');

			return;
		}

		this.ref.close();

		if (item.kind === 'time') {
			this.playback.seek(item.ms);
		} else if (item.kind === 'cue') {
			this.store.select(item.ref.cue.id);
			this.playback.seek(item.ref.cue.start);
		} else {
			this.remember(item.cmd.id);
			item.cmd.run();
		}
	}

	private remember(id: string): void {
		try {
			const next = [id, ...loadRecent().filter((r) => r !== id)].slice(0, 8);
			localStorage.setItem(RECENT_KEY, JSON.stringify(next));
		} catch {
			console.log(`[Command Palette] Storage unavailable; recent commands won't persist.`);
		}
	}
}
