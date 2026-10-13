import { NgTemplateOutlet } from '@angular/common';
import { Component, Injectable, computed, inject } from '@angular/core';
import { APP_VERSION } from '../../version';
import { openExternal } from '../../state/file-io';
import { RELEASES_PAGE, Updates } from '../../state/updates';
import { Button } from '../../ui/button/button';
import { Dialog, DialogRef, Dialogs } from '../../ui/dialog/dialog';
import { Notice } from '../../ui/notice/notice';
import { parseNotes } from './notes-markdown';

/** Offers the available update with release notes, then download progress and restart */
@Component({
	selector: 'bc-update-dialog',
	imports: [Dialog, Button, Notice, NgTemplateOutlet],
	templateUrl: './update-dialog.html',
	styleUrl: './update-dialog.css',
})
export class UpdateDialog {
	protected readonly updates = inject(Updates);
	protected readonly ref = inject(DialogRef);

	protected readonly current = APP_VERSION;
	protected readonly working = computed(() =>
		['downloading', 'installing'].includes(this.updates.phase()),
	);
	protected readonly blocker = computed(() => this.updates.blocker());
	protected readonly notes = computed(() => parseNotes(this.updates.notes()));

	protected async install(): Promise<void> {
		await this.updates.install();
	}

	/** Links open in the browser, not inside the app */
	protected openLink(e: MouseEvent, url: string): void {
		e.preventDefault();
		openExternal(url);
	}

	protected openReleases(): void {
		openExternal(RELEASES_PAGE);
		this.ref.close();
	}
}

/** Checks for an update and offers it */
@Injectable({ providedIn: 'root' })
export class UpdatePrompt {
	private readonly updates = inject(Updates);
	private readonly dialogs = inject(Dialogs);

	async checkInBackground(): Promise<void> {
		if (this.updates.autoCheck() && (await this.updates.check()) && !this.dialogs.isOpen)
			this.open();
	}

	async checkNow(): Promise<void> {
		if (await this.updates.check(true)) this.open();
	}

	private open(): void {
		this.dialogs.open(UpdateDialog, { dismissable: false });
	}
}
