import { inject } from '@angular/core';
import { CanDeactivateFn, Routes } from '@angular/router';
import { askSaveChanges, isDesktop } from './state/file-io';
import { ProjectFiles } from './state/project-files';
import { ProjectStore } from './state/project-store';
import { Transcription } from './state/transcription';

/** Leaving the editor with unsaved changes asks to save first */
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

	// Ensure any ongoing transcription job is properly stopped
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
	{ path: '**', redirectTo: '' },
];
