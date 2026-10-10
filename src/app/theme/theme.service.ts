import { Injectable, computed, effect, signal } from '@angular/core';

export type Theme = 'dark' | 'light';
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

const systemQuery = globalThis.matchMedia?.('(prefers-color-scheme: light)');
const systemTheme = (): Theme => (systemQuery?.matches ? 'light' : 'dark');

/**
 * Owns the active color theme
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
			if (p === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, p);
		} catch {
			console.log('[Themes] Failed to set theme preference in localStorage');
		}
	}

	toggle(): void {
		this.setPreference(this.theme() === 'dark' ? 'light' : 'dark');
	}
}
