import { Component, computed, inject, input, signal } from '@angular/core';
import { LucideLoaderCircle } from '@lucide/angular';
import { TrackId } from '../../core/model/types';
import { formatBytes, formatSpan } from '../../core/units/units';
import { EditorUi } from '../../state/editor-ui';
import { isStopped, jobErrorText } from '../../state/jobs';
import { ProjectStore } from '../../state/project-store';
import {
	SPEAKER_COUNTS,
	SPEAKER_MODELS_SIZE,
	SpeakerResult,
	SpeakerSeparation,
} from '../../state/speaker-separation';
import { Button } from '../../ui/button/button';
import { Dialog, DialogRef } from '../../ui/dialog/dialog';
import { Notice } from '../../ui/notice/notice';
import { Select } from '../../ui/select/select';
import { SpeakerRows } from './speaker-rows';

type Phase = 'setup' | 'running' | 'done' | 'error';

/**
 * Separate speakers on a track that's already transcribed
 */
@Component({
	selector: 'bc-separate-speakers-dialog',
	imports: [Dialog, Button, Select, Notice, SpeakerRows, LucideLoaderCircle],
	template: `
		<bc-dialog heading="Separate speakers" [subtitle]="subtitle()" [width]="560">
			@switch (phase()) {
				@case ('setup') {
					<bc-select
						label="Speakers"
						[options]="countOptions"
						[value]="speakers() ?? 0"
						(valueChange)="speakers.set(+$any($event) || null)"
					/>
					<span class="text-small text-faded">
						Replaces {{ trackName() }} with a track for each person. Undo brings it
						back.
						{{ modelNote() }}
					</span>
				}
				@case ('running') {
					<ol class="steps">
						<li class="running">
							<svg lucideLoaderCircle class="icon spin"></svg>
							<span class="step-label">Separate speakers</span>
							<span class="text-mono-small step-detail">{{ detail() }}</span>
						</li>
					</ol>
					<div class="bar" [class.busy]="!download()">
						<span [style.width.%]="download() ? downloadShare() * 100 : 100"></span>
					</div>
					<span class="text-small text-faded">{{
						download()
							? 'Downloading the speaker models. This only happens once.'
							: 'Working out who speaks when...'
					}}</span>
				}
				@case ('done') {
					@if (result(); as r) {
						<div class="result">
							<div class="result-head">
								<span
									>Split into {{ r.rows.length }}
									{{
										r.rows.length === 1 ? 'speaker track' : 'speaker tracks'
									}}</span
								>
							</div>
							<bc-speaker-rows [result]="r" />
							<div class="stats">
								<div class="stat">
									<span class="text-heading-2">{{ cueCount() }}</span>
									<span class="text-small text-faded">cues</span>
								</div>
								<div class="stat">
									<span class="text-heading-2 warn">{{ r.unsure }}</span>
									<span class="text-small text-faded"
										>lines with an unsure speaker</span
									>
								</div>
							</div>
						</div>
					}
				}
				@case ('error') {
					<bc-notice tone="danger" [heading]="error().title" [detail]="error().detail" />
				}
			}
			<div dialogFooter>
				@switch (phase()) {
					@case ('setup') {
						<button bcButton (click)="ref.close()">Cancel</button>
						<button bcButton variant="primary" (click)="start()">Separate</button>
					}
					@case ('running') {
						<button bcButton [disabled]="stopping()" (click)="stop()">
							{{ stopping() ? 'Stopping...' : 'Stop' }}
						</button>
					}
					@case ('done') {
						<span class="footer-note">Finished in {{ took() }}</span>
						@if (result()?.unsure) {
							<button bcButton (click)="reviewProblems()">Review problems</button>
						}
						<button bcButton variant="primary" (click)="ref.close()">Done</button>
					}
					@case ('error') {
						<button bcButton (click)="ref.close()">Close</button>
						<button bcButton variant="primary" (click)="start()">Try again</button>
					}
				}
			</div>
		</bc-dialog>
	`,
	styles: `
		.steps {
			overflow: clip;
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.steps li {
			display: flex;
			align-items: center;
			gap: var(--spacing-sm);
		}
		.icon {
			flex-shrink: 0;
			width: 16px;
			height: 16px;
			color: var(--color-brand);
		}
		.step-label {
			flex: 1;
			font-weight: 800;
		}
		.step-detail {
			color: var(--color-text-faded);
		}
		.spin {
			animation: spin 1s linear infinite;
		}
		@keyframes spin {
			to {
				transform: rotate(360deg);
			}
		}
		.bar {
			height: 8px;
			overflow: hidden;
			border-radius: 4px;
			background: var(--color-selected);
		}
		.bar span {
			display: block;
			height: 100%;
			border-radius: 4px;
			background: var(--color-brand);
			transition: width 0.3s;
		}
		.bar.busy span {
			animation: pulse 1.6s ease-in-out infinite;
		}
		@keyframes pulse {
			50% {
				opacity: 0.4;
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.spin,
			.bar.busy span {
				animation: none;
			}
		}
		.result {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-md);
			padding: var(--spacing-md);
			border-radius: var(--radius-control);
			background: var(--color-bg);
		}
		.stats {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: var(--spacing-sm);
		}
		.stat {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-xs);
			padding: var(--spacing-md);
			border-radius: var(--radius-control);
			background: var(--color-card);
		}
		.warn {
			color: var(--color-warning);
		}
	`,
})
export class SeparateSpeakersDialog {
	private readonly store = inject(ProjectStore);
	private readonly separation = inject(SpeakerSeparation);
	private readonly ui = inject(EditorUi);
	protected readonly ref = inject(DialogRef);
	readonly trackId = input.required<TrackId>();

	protected readonly countOptions = SPEAKER_COUNTS.map((n) => ({
		value: n ?? 0,
		label: n ? String(n) : 'Auto',
	}));
	protected readonly speakers = signal<number | null>(null);
	protected readonly phase = signal<Phase>('setup');
	protected readonly download = signal<{ received: number; total: number } | null>(null);
	protected readonly stopping = signal(false);
	protected readonly result = signal<SpeakerResult | null>(null);
	protected readonly error = signal({ title: '', detail: '' });
	protected readonly took = signal('');
	protected readonly trackName = signal('');
	private abort: AbortController | null = null;

	protected readonly subtitle = computed(() =>
		this.phase() === 'setup'
			? 'Runs on this computer. Your video is never uploaded.'
			: `${this.trackName()} • ${this.speakers() ? `${this.speakers()} speakers` : 'Speakers: Auto'}`,
	);
	protected readonly modelNote = computed(() =>
		this.separation.installed() === false
			? `Downloads ${SPEAKER_MODELS_SIZE} the first time.`
			: '',
	);
	protected readonly downloadShare = computed(() => {
		const d = this.download();

		return d && d.total ? Math.min(1, d.received / d.total) : 0;
	});
	protected readonly detail = computed(() => {
		const d = this.download();

		return d
			? `${formatBytes(d.received)} of ${d.total ? formatBytes(d.total) : SPEAKER_MODELS_SIZE}`
			: '';
	});
	protected readonly cueCount = computed(
		() => this.result()?.rows.reduce((n, r) => n + r.cues, 0) ?? 0,
	);

	constructor() {
		void this.separation.refresh();
		queueMicrotask(() => this.trackName.set(this.store.track(this.trackId())?.name ?? 'track'));
		void this.ref.closed.then(() => this.abort?.abort());
	}

	protected async start(): Promise<void> {
		const before = this.store.track(this.trackId());

		if (!before) return;

		this.phase.set('running');
		this.stopping.set(false);
		this.download.set(null);
		this.abort = new AbortController();
		const started = performance.now();

		try {
			const turns = await this.separation.turns(this.speakers(), this.abort.signal, (e) => {
				if (e.type === 'download')
					this.download.set({ received: e.received, total: e.total });
				else this.download.set(null);
			});
			const track = this.store.track(this.trackId());

			if (!track)
				throw new Error(`The track is gone|${before.name} was deleted while this ran.`);

			const split = this.separation.split(track, turns, !this.speakers());
			this.store.apply('Separate speakers', SpeakerSeparation.replace(track.id, split));
			this.result.set(SpeakerSeparation.result(split));
			this.took.set(formatSpan(performance.now() - started));
			this.phase.set('done');
		} catch (err) {
			if (isStopped(err)) {
				this.phase.set('setup');

				return;
			}

			this.error.set(jobErrorText(err));
			this.phase.set('error');
		} finally {
			this.abort = null;
			this.download.set(null);
		}
	}

	protected stop(): void {
		this.stopping.set(true);
		this.abort?.abort();
	}

	protected reviewProblems(): void {
		this.ui.sideTab.set('problems');
		this.ref.close();
	}
}
