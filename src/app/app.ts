import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppMenu } from './features/menu/app-menu';
import { askSaveChanges, isDesktop } from './state/file-io';
import { ProjectFiles } from './state/project-files';
import { ProjectStore } from './state/project-store';
import { Recovery } from './state/recovery';
import { ThemeService } from './theme/theme.service';

@Component({
	selector: 'app-root',
	imports: [RouterOutlet],
	template: '<router-outlet />',
})
export class App {
	// Instantiated here so the theme attribute is applied before any route renders
	protected readonly theme = inject(ThemeService);
	private readonly recovery = inject(Recovery);
	private readonly store = inject(ProjectStore);
	private readonly files = inject(ProjectFiles);
	private readonly router = inject(Router);

	constructor() {
		if (isDesktop) {
			inject(AppMenu);
			void getCurrentWindow().onCloseRequested((e) => this.onClose(e));
			void this.openLaunchFile();
			void listen('launch-file', () => this.openLaunchFile());
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
