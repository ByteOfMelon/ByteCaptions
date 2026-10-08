import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
	// Instantiated here so the theme attribute is applied before any route renders.
	protected readonly theme = inject(ThemeService);
	// Autosave runs for the whole session, whichever screen is showing.
	private readonly recovery = inject(Recovery);
	private readonly store = inject(ProjectStore);
	private readonly files = inject(ProjectFiles);

	constructor() {
		if (isDesktop) void getCurrentWindow().onCloseRequested((e) => this.onClose(e));
		else
			window.addEventListener('beforeunload', (e) => {
				if (this.store.dirty()) e.preventDefault();
			});
	}

	/** Closing the window with unsaved changes asks to save first. */
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
