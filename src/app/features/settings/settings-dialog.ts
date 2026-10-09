import { Component, inject } from '@angular/core';
import { confirmAction } from '../../state/file-io';
import { PanelLayout } from '../../state/panel-layout';
import { YouTube } from '../../state/youtube';
import { ThemePreference, ThemeService } from '../../theme/theme.service';
import { Button } from '../../ui/button/button';
import { Dialog } from '../../ui/dialog/dialog';
import { Select } from '../../ui/select/select';

/** App-wide settings (not saved with a project). Changes apply right away. */
@Component({
	selector: 'bc-settings-dialog',
	imports: [Dialog, Button, Select],
	templateUrl: './settings-dialog.html',
	styleUrl: './settings-dialog.css',
})
export class SettingsDialog {
	protected readonly theme = inject(ThemeService);
	private readonly layout = inject(PanelLayout);
	protected readonly youtube = inject(YouTube);

	protected readonly themes: { value: ThemePreference; label: string }[] = [
		{ value: 'system', label: 'Match system' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
	];

	protected async signOut(): Promise<void> {
		const name = this.youtube.account()?.title ?? 'YouTube';
		if (
			await confirmAction(
				`Sign out of ${name}? You'll need to sign in again to upload captions.`,
				'Sign out of YouTube',
				'Sign out',
			)
		)
			await this.youtube.signOut();
	}

	protected async resetLayout(): Promise<void> {
		if (await confirmResetLayout()) this.layout.reset();
	}
}

/** Asks before Reset layout (Settings, View menu). */
export function confirmResetLayout(): Promise<boolean> {
	return confirmAction(
		'Put the cue list, inspector and timeline back to their default sizes?',
		'Reset layout',
		'Reset layout',
	);
}
