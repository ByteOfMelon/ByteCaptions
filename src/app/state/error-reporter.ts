import { ErrorHandler, Injectable, NgZone, inject } from '@angular/core';
import { ProjectFiles } from './project-files';

/** Browser noise that doesn't mean anything went wrong. */
const IGNORED = [/ResizeObserver loop/];

/**
 * Anything that throws without being handled (a failed command, a rejected promise) shows in
 * the app's error banner instead of only reaching the console.
 */
@Injectable()
export class ErrorReporter implements ErrorHandler {
	private readonly zone = inject(NgZone);
	private readonly files = inject(ProjectFiles);

	handleError(error: unknown): void {
		console.error(error);
		const text = describe(error);
		if (IGNORED.some((r) => r.test(text))) return;
		// Keep the first message: later ones are usually knock-on effects of it.
		this.zone.run(() => {
			if (!this.files.error()) this.files.error.set(text);
		});
	}
}

function describe(error: unknown): string {
	const e = (error as { rejection?: unknown })?.rejection ?? error;
	const text = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
	return text.trim() || 'An unexpected error happened.';
}
