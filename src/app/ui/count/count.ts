import { Pipe, PipeTransform } from '@angular/core';

/** Format a number for the user to read */
export function count(n: number, singular: string, plural = `${singular}s`): string {
	return `${n} ${n === 1 ? singular : plural}`;
}

@Pipe({ name: 'count' })
export class CountPipe implements PipeTransform {
	transform(n: number, singular: string, plural?: string): string {
		return count(n, singular, plural);
	}
}
