import { Component, OnInit, inject, input, signal } from '@angular/core';
import { confirmAction, isDesktop } from '../../state/file-io';
import { PanelLayout } from '../../state/panel-layout';
import { Updates } from '../../state/updates';
import { YouTube } from '../../state/youtube';
import { ThemePreference, ThemeService } from '../../theme/theme.service';
import { Button } from '../../ui/button/button';
import { Toggle } from '../../ui/controls/controls';
import { Dialog } from '../../ui/dialog/dialog';
import { Select } from '../../ui/select/select';
import { Tabs } from '../../ui/tabs/tabs';
import { StyleLibrary } from './style-library';

export type AppSettingsTab = 'general' | 'library';

/** App-wide settings (not saved with a project) */
@Component({
	selector: 'bc-settings-dialog',
	imports: [Dialog, Button, Select, Tabs, Toggle, StyleLibrary],
	templateUrl: './settings-dialog.html',
	styleUrl: './settings-dialog.css',
})
export class SettingsDialog implements OnInit {
	protected readonly theme = inject(ThemeService);
	private readonly layout = inject(PanelLayout);
	protected readonly youtube = inject(YouTube);
	protected readonly updates = inject(Updates);
	protected readonly isDesktop = isDesktop;
	readonly initialTab = input<AppSettingsTab>('general');

	protected readonly tabs = [
		{ value: 'general' as AppSettingsTab, label: 'General' },
		{ value: 'library' as AppSettingsTab, label: 'Style Library' },
	];
	protected readonly tab = signal<AppSettingsTab>('general');

	ngOnInit(): void {
		this.tab.set(this.initialTab());
	}

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

export function confirmResetLayout(): Promise<boolean> {
	return confirmAction(
		'Put the cue list, inspector and timeline back to their default sizes?',
		'Reset layout',
		'Reset layout',
	);
}
