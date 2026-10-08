import {
	ApplicationConfig,
	inject,
	provideAppInitializer,
	provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideLucideConfig } from '@lucide/angular';
import { routes } from './app.routes';
import { Recovery } from './state/recovery';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		// After a reload, reopen the project before anything shows the sample one.
		provideAppInitializer(() => inject(Recovery).resume()),
		provideRouter(routes),
		provideLucideConfig({ size: 16, strokeWidth: 2 }),
	],
};
