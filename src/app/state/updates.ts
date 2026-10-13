import { Injectable, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { message } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { Update, check } from '@tauri-apps/plugin-updater';
import { askSaveChanges, isDesktop } from './file-io';
import { ProjectFiles } from './project-files';
import { ProjectStore } from './project-store';
import { Recovery } from './recovery';
import { Transcription } from './transcription';
import { YouTube } from './youtube';

const AUTO_CHECK_KEY = 'bc.updates.autoCheck';
export const RELEASES_PAGE = 'https://github.com/ByteOfMelon/ByteCaptions/releases/latest';

function loadAutoCheck(): boolean {
	try {
		return localStorage.getItem(AUTO_CHECK_KEY) !== 'false';
	} catch {
		return true;
	}
}

export type UpdatePhase =
	'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error';

/**
 * Checks GitHub Releases for a newer version, then downloads, installs and restarts into it
 * Releases and their signatures come from the release workflow (see .github/workflows/build.yml)
 */
@Injectable({ providedIn: 'root' })
export class Updates {
	private readonly store = inject(ProjectStore);
	private readonly files = inject(ProjectFiles);
	private readonly recovery = inject(Recovery);
	private readonly transcription = inject(Transcription);
	private readonly youtube = inject(YouTube);

	readonly autoCheck = signal(loadAutoCheck());
	readonly phase = signal<UpdatePhase>('idle');
	readonly update = signal<Update | null>(null);
	readonly progress = signal<number | null>(null);
	readonly error = signal<string | null>(null);
	/** False for Linux .deb/.rpm installs */
	readonly canSelfUpdate = signal(true);

	setAutoCheck(on: boolean): void {
		this.autoCheck.set(on);

		try {
			localStorage.setItem(AUTO_CHECK_KEY, String(on));
		} catch {
			console.warn("[Updates] Couldn't save auto-check setting to localStorage");
		}
	}

	/** Looks for an update and returns whether one is available */
	async check(manual = false): Promise<boolean> {
		if (!isDesktop || this.phase() === 'checking' || this.busyInstalling()) return false;

		this.phase.set('checking');
		this.error.set(null);

		try {
			this.canSelfUpdate.set(await invoke<boolean>('can_self_update'));
			const update = await check();
			this.update.set(update);
			this.phase.set(update ? 'available' : 'idle');

			if (!update && manual)
				await message(`You're on the latest version of ByteCaptions.`, {
					title: 'No updates available',
					kind: 'info',
				});

			return !!update;
		} catch (e) {
			this.phase.set('idle');

			if (manual)
				await message(`ByteCaptions couldn't check for updates.\n\n${String(e)}`, {
					title: 'Update check failed',
					kind: 'error',
				});

			return false;
		}
	}

	/** Why the update can't start right now */
	blocker(): string | null {
		if (this.transcription.running())
			return 'Please wait for your transcription to finish first.';

		if (this.youtube.running()) return 'Please wait for your YouTube upload to finish first.';

		return null;
	}

	/**
	 * Downloads and installs the update, then restarts. Unsaved changes are saved (or knowingly
	 * thrown away) first, since the app closes. Returns false if the user cancelled
	 */
	async install(): Promise<boolean> {
		const update = this.update();

		if (!update || this.blocker()) return false;

		if (this.store.dirty()) {
			const choice = await askSaveChanges(this.store.project().name);

			if (choice === 'cancel') return false;

			if (choice === 'save' && !(await this.files.save())) return false;

			if (choice === 'discard') await this.recovery.discard(this.store.project().id);
		}

		this.phase.set('downloading');
		this.progress.set(null);
		let total = 0,
			done = 0;

		try {
			await update.downloadAndInstall((e) => {
				if (e.event === 'Started') total = e.data.contentLength ?? 0;
				else if (e.event === 'Progress') {
					done += e.data.chunkLength;
					this.progress.set(total ? Math.min(100, (done / total) * 100) : null);
				} else this.phase.set('installing');
			});
			// On Windows the installer closes the app itself; elsewhere restart into the new version
			await relaunch();

			return true;
		} catch (e) {
			this.error.set(String(e));
			this.phase.set('error');

			return false;
		}
	}

	private busyInstalling(): boolean {
		return this.phase() === 'downloading' || this.phase() === 'installing';
	}
}
