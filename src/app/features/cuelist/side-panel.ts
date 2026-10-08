import { Component, inject } from '@angular/core';
import { EditorUi, SideTab } from '../../state/editor-ui';
import { Tabs } from '../../ui/tabs/tabs';
import { CueList } from './cue-list';
import { ProblemsView } from './problems-view';
import { TranscriptView } from './transcript-view';

/** Left panel: Cues / Transcript / Problems. */
@Component({
	selector: 'bc-side-panel',
	imports: [Tabs, CueList, TranscriptView, ProblemsView],
	template: `
		<bc-tabs class="on-panel" idPrefix="side" [tabs]="tabs" [(value)]="tab" />
		<div
			class="body"
			role="tabpanel"
			[id]="'side-panel-' + tab()"
			[attr.aria-labelledby]="'side-tab-' + tab()"
		>
			@switch (tab()) {
				@case ('cues') {
					<bc-cue-list />
				}
				@case ('transcript') {
					<bc-transcript-view />
				}
				@case ('problems') {
					<bc-problems-view />
				}
			}
		</div>
	`,
	styles: `
		:host {
			display: flex;
			flex-direction: column;
			gap: var(--spacing-md);
			min-height: 0;
		}
		bc-tabs {
			align-self: stretch;
		}
		.body {
			display: flex;
			flex-direction: column;
			flex: 1;
			min-height: 0;
		}
	`,
})
export class SidePanel {
	protected readonly tabs = [
		{ value: 'cues' as SideTab, label: 'Cues' },
		{ value: 'transcript' as SideTab, label: 'Transcript' },
		{ value: 'problems' as SideTab, label: 'Problems' },
	];
	readonly tab = inject(EditorUi).sideTab;
}
