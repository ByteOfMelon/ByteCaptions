/**
 * Helpers for long backend jobs
 */

/** Error text the backend uses for a job stopped with job_cancel (see src-tauri/src/jobs.rs). */
const CANCELLED = 'Cancelled';

/** The error a stopped job rejects with */
export const stopped = () => new DOMException('Stopped', 'AbortError');

/** Whether an error means the user stopped the job */
export function wasCancelled(e: unknown, signal: AbortSignal): boolean {
	return e === CANCELLED || signal.aborted;
}

/** Whether err is a stopped job rather than a failure */
export function isStopped(err: unknown): boolean {
	return (err as Error).name === 'AbortError';
}

/** A failed job's "Title|detail" message */
export function jobErrorText(err: unknown): { title: string; detail: string } {
	const [title, detail = ''] = String((err as Error).message ?? err).split('|');

	return { title, detail };
}
