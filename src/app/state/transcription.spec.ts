import { TestBed } from '@angular/core/testing';
import { TranscribeDialog } from '../features/transcribe/transcribe-dialog';
import { DialogRef } from '../ui/dialog/dialog';
import { EngineEvent, Transcription, TranscriptionEngine } from './transcription';

/** An engine whose run reports `events`, then fails with `message`. */
function failingEngine(events: EngineEvent[], message: string): TranscriptionEngine {
	return {
		isDownloaded: () => true,
		refresh: async () => {},
		downloaded: () => new Map(),
		delete: async () => {},
		device: async () => null,
		run: async (_opts, _ms, _signal, emit) => {
			events.forEach(emit);

			throw new Error(message);
		},
	} satisfies TranscriptionEngine;
}

function setup(engine: TranscriptionEngine) {
	TestBed.configureTestingModule({
		providers: [{ provide: DialogRef, useValue: new DialogRef() }],
	});
	const job = TestBed.inject(Transcription);
	Object.defineProperty(job, 'engine', { value: engine });
	const dialog = TestBed.runInInjectionContext(() => new TranscribeDialog());

	return { job, retryLabel: () => (dialog as unknown as { retryLabel(): string }).retryLabel() };
}

describe('Transcription errors', () => {
	it('marks a failed download and offers to retry the download', async () => {
		const { job, retryLabel } = setup(
			failingEngine(
				[
					{ type: 'step', step: 'download', status: 'running', detail: '' },
					{ type: 'step', step: 'download', status: 'error', detail: '12 MB of 1.6 GB' },
				],
				'Model download failed|connection reset',
			),
		);
		await job.start();
		expect(job.phase()).toBe('error');
		expect(job.error()).toEqual({ title: 'Model download failed', detail: 'connection reset' });
		expect(job.steps().find((s) => s.status === 'error')?.id).toBe('download');
		expect(retryLabel()).toBe('Retry download');
	});

	it('marks the step that was running when transcription fails', async () => {
		const { job, retryLabel } = setup(
			failingEngine(
				[
					{ type: 'step', step: 'download', status: 'done', detail: '1.6 GB' },
					{ type: 'step', step: 'extract', status: 'done', detail: '14:03' },
					{ type: 'step', step: 'transcribe', status: 'running', detail: '0%' },
				],
				'Transcription failed|out of memory',
			),
		);
		await job.start();
		expect(job.error()?.title).toBe('Transcription failed');
		expect(job.steps().map((s) => s.status)).toEqual(['done', 'done', 'error', 'waiting']);
		expect(retryLabel()).toBe('Try again');
		job.reset();
		expect(job.phase()).toBe('setup');
	});
});
