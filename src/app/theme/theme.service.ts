import { Injectable, computed, effect, signal } from '@angular/core';

export type Theme = 'dark' | 'light';
/** What the user picked: a fixed theme, or follow the system's. */
export type ThemePreference = Theme | 'system';

const KEY = 'bc.theme';

function loadPreference(): ThemePreference {
	try {
		const t = localStorage.getItem(KEY);

		return t === 'dark' || t === 'light' ? t : 'system';
	} catch {
		return 'system';
	}
}

// matchMedia is missing in some environments (e.g. the test DOM); fall back to dark.
const systemQuery = globalThis.matchMedia?.('(prefers-color-scheme: light)');
const systemTheme = (): Theme => (systemQuery?.matches ? 'light' : 'dark');

/**
 * Owns the active color theme; reflected as data-theme on <html>. Defaults to following the
 * system theme (live); the user can pin light or dark, or go back to the system's.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
	readonly preference = signal<ThemePreference>(loadPreference());
	private readonly system = signal<Theme>(systemTheme());
	readonly theme = computed(() => {
		const p = this.preference();

		return p === 'system' ? this.system() : p;
	});

	constructor() {
		systemQuery?.addEventListener('change', () => this.system.set(systemTheme()));
		effect(() => document.documentElement.setAttribute('data-theme', this.theme()));
	}

	setPreference(p: ThemePreference): void {
		this.preference.set(p);

		try {
			// Nothing stored means "system", which the pre-boot script in index.html also reads.
			if (p === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, p);
		} catch {
			// Storage can be unavailable; the choice just won't persist.
		}
	}

	toggle(): void {
		this.setPreference(this.theme() === 'dark' ? 'light' : 'dark');
	}
}
