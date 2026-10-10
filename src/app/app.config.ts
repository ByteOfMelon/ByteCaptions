import {
	ApplicationConfig,
	ErrorHandler,
	inject,
	provideAppInitializer,
	provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideLucideConfig } from '@lucide/angular';
import { routes } from './app.routes';
import { ErrorReporter } from './state/error-reporter';
import { initMediaUrls } from './state/file-io';
import { Recovery } from './state/recovery';
import { YouTube } from './state/youtube';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		{ provide: ErrorHandler, useClass: ErrorReporter },
		provideAppInitializer(() => {
			const recovery = inject(Recovery);
			const youtube = inject(YouTube);

			return Promise.all([initMediaUrls(), youtube.init()]).then(() => recovery.resume());
		}),
		provideRouter(routes),
		provideLucideConfig({ size: 16, strokeWidth: 2 }),
	],
};
