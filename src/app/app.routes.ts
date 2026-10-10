import { inject } from '@angular/core';
import { CanDeactivateFn, Routes } from '@angular/router';
import { askSaveChanges, isDesktop } from './state/file-io';
import { ProjectFiles } from './state/project-files';
import { ProjectStore } from './state/project-store';
import { Transcription } from './state/transcription';

/** Leaving the editor with unsaved changes asks to save first, as closing the window does. */
const leaveEditor: CanDeactivateFn<unknown> = async () => {
	const store = inject(ProjectStore);
	const files = inject(ProjectFiles);
	const transcription = inject(Transcription);

	if (!store.dirty()) return true;

	const choice = isDesktop
		? await askSaveChanges(store.project().name)
		: (await files.confirmDiscard())
			? 'discard'
			: 'cancel';

	if (choice === 'cancel') return false;

	if (choice === 'save') return files.save();

	// Close the project (its recovery copy goes with it), so a transcription can't add to it.
	transcription.stop();
	files.newEmpty();

	return true;
};

export const routes: Routes = [
	{ path: '', loadComponent: () => import('./features/start/start').then((m) => m.Start) },
	{
		path: 'editor',
		loadComponent: () => import('./features/editor/editor').then((m) => m.Editor),
		canDeactivate: [leaveEditor],
	},
	{
		path: 'gallery',
		loadComponent: () => import('./features/gallery/gallery').then((m) => m.Gallery),
	},
	{ path: '**', redirectTo: '' },
];
