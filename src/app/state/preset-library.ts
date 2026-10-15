import { Injectable, computed, signal } from '@angular/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { newId } from '../core/model/defaults';
import { CaptionStyle } from '../core/model/types';
import {
	parseLibrary,
	sameLook,
	serializeLibrary,
	uniqueName,
	withUniqueNames,
} from '../core/project/library';
import {
	FileFilter,
	canPickSaveTarget,
	isDesktop,
	openFile,
	pickSaveTarget,
	writeText,
} from './file-io';
import { errorMessage } from './project-files';

export const LIBRARY_FILTER: FileFilter = {
	name: 'ByteCaptions preset library',
	extensions: ['bclib'],
};
const FILE_NAME = 'preset-library.json';
const BROWSER_KEY = 'bc.presetLibrary';

const storage = {
	async path(): Promise<string> {
		const dir = await appLocalDataDir();
		await mkdir(dir, { recursive: true });

		return join(dir, FILE_NAME);
	},
	async read(): Promise<string | null> {
		if (!isDesktop) return localStorage.getItem(BROWSER_KEY);

		const path = await this.path();

		return (await exists(path)) ? readTextFile(path) : null;
	},
	async write(text: string): Promise<void> {
		if (isDesktop) return writeTextFile(await this.path(), text);

		localStorage.setItem(BROWSER_KEY, text);
	},
};

/**
 * Style presets kept by the app for use in any project
 */
@Injectable({ providedIn: 'root' })
export class PresetLibrary {
	private readonly styles = signal<Record<string, CaptionStyle>>({});
	private loaded: Promise<void> | null = null;

	readonly list = computed(() =>
		Object.entries(this.styles())
			.map(([id, style]) => ({ id, style }))
			.sort((a, b) => a.style.name.localeCompare(b.style.name)),
	);
	/** Problem with the last load, save, import or export, for the presets dialog to show */
	readonly error = signal<string | null>(null);

	/** Read the saved library */
	load(): Promise<void> {
		return (this.loaded ??= storage
			.read()
			.then((text) => {
				if (text) this.styles.set(keyed(parseLibrary(text)));
			})
			.catch((e) =>
				this.error.set(`The preset library couldn't be loaded. ${errorMessage(e)}`),
			));
	}

	get(id: string): CaptionStyle | undefined {
		return this.styles()[id];
	}

	/**
	 * Add copies of `styles`, renamed "Name 2" etc. where a name is taken. A preset that looks the
	 * same as one already in the library isn't added again. Returns, per preset, the library name it
	 * ended up under and whether it was already there
	 */
	async add(styles: CaptionStyle[]): Promise<{ name: string; existing: boolean }[]> {
		await this.load();
		const kept = Object.values(this.styles());
		const outcomes: { name: string; existing: boolean }[] = [];
		const fresh: CaptionStyle[] = [];

		for (const style of styles) {
			const match = kept.find((k) => sameLook(k, style));

			if (match) {
				outcomes.push({ name: match.name, existing: true });
				continue;
			}

			const [copy] = withUniqueNames(
				[style],
				kept.map((k) => k.name),
			);
			kept.push(copy);
			fresh.push(copy);
			outcomes.push({ name: copy.name, existing: false });
		}

		if (fresh.length) {
			this.styles.update((all) => ({ ...all, ...keyed(fresh) }));
			await this.save();
		}

		return outcomes;
	}

	async rename(id: string, name: string): Promise<void> {
		const style = this.styles()[id];

		if (!style || !name.trim() || name.trim() === style.name) return;

		const others = Object.entries(this.styles())
			.filter(([other]) => other !== id)
			.map(([, s]) => s.name);
		this.styles.update((all) => ({
			...all,
			[id]: { ...style, name: uniqueName(name, others) },
		}));
		await this.save();
	}

	/** A copy of a preset, as "Name 2" etc */
	async duplicate(id: string): Promise<string | null> {
		const style = this.styles()[id];

		if (!style) return null;

		const names = Object.values(this.styles()).map((s) => s.name);
		const [copy] = withUniqueNames([style], names);
		const copyId = newId('lib');
		this.styles.update((all) => ({ ...all, [copyId]: copy }));
		await this.save();

		return copyId;
	}

	async remove(id: string): Promise<void> {
		this.styles.update((all) => {
			const { [id]: _removed, ...rest } = all;

			return rest;
		});
		await this.save();
	}

	/** Add the presets from a .bclib file */
	async importFile(): Promise<number | null> {
		const file = await openFile(LIBRARY_FILTER);

		if (!file) return null;

		try {
			const outcomes = await this.add(parseLibrary(await file.text()));
			this.error.set(null);

			return outcomes.filter((o) => !o.existing).length;
		} catch (e) {
			this.error.set(`${file.name} couldn't be imported. ${errorMessage(e)}`);

			return null;
		}
	}

	/** Save the whole library as a .bclib file */
	async exportFile(): Promise<void> {
		await this.load();
		// Browsers without a save picker download the file instead
		const to = canPickSaveTarget()
			? await pickSaveTarget('Presets.bclib', LIBRARY_FILTER)
			: { name: 'Presets.bclib', path: null };

		if (!to) return;

		try {
			await writeText(to, serializeLibrary(this.list().map((p) => p.style)));
			this.error.set(null);
		} catch (e) {
			this.error.set(`The preset library couldn't be exported. ${errorMessage(e)}`);
		}
	}

	private async save(): Promise<void> {
		try {
			await storage.write(serializeLibrary(Object.values(this.styles())));
			this.error.set(null);
		} catch (e) {
			this.error.set(`The preset library couldn't be saved. ${errorMessage(e)}`);
		}
	}
}

function keyed(styles: CaptionStyle[]): Record<string, CaptionStyle> {
	return Object.fromEntries(styles.map((s) => [newId('lib'), s]));
}
