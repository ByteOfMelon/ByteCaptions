import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppMenu } from './features/menu/app-menu';
import { UpdatePrompt } from './features/updates/update-dialog';
import { askSaveChanges, isDesktop } from './state/file-io';
import { ProjectFiles } from './state/project-files';
import { ProjectStore } from './state/project-store';
import { Recovery } from './state/recovery';
import { ViewMemory } from './state/view-memory';
import { ThemeService } from './theme/theme.service';

@Component({
	selector: 'app-root',
	imports: [RouterOutlet],
	template: '<router-outlet />',
})
export class App {
	// Instantiated here so that these attributes are applied before any route renders
	protected readonly theme = inject(ThemeService);
	private readonly recovery = inject(Recovery);
	private readonly store = inject(ProjectStore);
	private readonly files = inject(ProjectFiles);
	private readonly router = inject(Router);

	constructor() {
		// Created up front so it sees every project load
		inject(ViewMemory);

		if (isDesktop) {
			inject(AppMenu);
			void getCurrentWindow().onCloseRequested((e) => this.onClose(e));
			void this.openLaunchFile();
			void listen('launch-file', () => this.openLaunchFile());

			// Check for updates after ensuring the app has had time to initialize
			const updates = inject(UpdatePrompt);
			setTimeout(() => void updates.checkInBackground(), 5000);
		} else
			window.addEventListener('beforeunload', (e) => {
				if (this.store.dirty()) e.preventDefault();
			});
	}

	/** Opens the project file the app was started with */
	private async openLaunchFile(): Promise<void> {
		const path = await invoke<string | null>('launch_file');

		if (path && (await this.files.open(path))) await this.router.navigateByUrl('/editor');
	}

	/** Closing the window with unsaved changes asks to save first */
	private async onClose(e: { preventDefault(): void }): Promise<void> {
		if (!this.store.dirty()) return;

		switch (await askSaveChanges(this.store.project().name)) {
			case 'save':
				if (!(await this.files.save())) e.preventDefault();

				return;
			case 'discard':
				await this.recovery.discard(this.store.project().id);

				return;
			case 'cancel':
				e.preventDefault();
		}
	}
}
