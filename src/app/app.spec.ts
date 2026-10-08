import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [App],
		}).compileComponents();
	});

	it('should create the app', () => {
		const fixture = TestBed.createComponent(App);
		expect(fixture.componentInstance).toBeTruthy();
	});

	it('should apply the dark theme by default', async () => {
		const fixture = TestBed.createComponent(App);
		await fixture.whenStable();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});
});
