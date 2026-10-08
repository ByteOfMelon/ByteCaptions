import { Routes } from '@angular/router';

export const routes: Routes = [
	{ path: '', loadComponent: () => import('./features/start/start').then((m) => m.Start) },
	{
		path: 'editor',
		loadComponent: () => import('./features/editor/editor').then((m) => m.Editor),
	},
	{
		path: 'gallery',
		loadComponent: () => import('./features/gallery/gallery').then((m) => m.Gallery),
	},
	{ path: '**', redirectTo: '' },
];
