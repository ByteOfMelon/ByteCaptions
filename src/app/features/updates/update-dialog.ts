import { Component, Injectable, computed, inject } from '@angular/core';
import { APP_VERSION } from '../../version';
import { openExternal } from '../../state/file-io';
import { RELEASES_PAGE, Updates } from '../../state/updates';
import { Button } from '../../ui/button/button';
import { Dialog, DialogRef, Dialogs } from '../../ui/dialog/dialog';
import { Notice } from '../../ui/notice/notice';

/** Offers the available update with release notes, then download progress and restart */
@Component({
	selector: 'bc-update-dialog',
	imports: [Dialog, Button, Notice],
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

	protected async install(): Promise<void> {
		await this.updates.install();
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
