import { Pipe, PipeTransform } from '@angular/core';

/** "1 cue", "3 cues". Pass the plural when it isn't just an added "s". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
	return `${n} ${n === 1 ? singular : plural}`;
}

@Pipe({ name: 'count' })
export class CountPipe implements PipeTransform {
	transform(n: number, singular: string, plural?: string): string {
		return count(n, singular, plural);
	}
}
