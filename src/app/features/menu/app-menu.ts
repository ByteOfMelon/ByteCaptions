import { Injectable, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import {
	CheckMenuItem,
	Menu,
	MenuItem,
	PredefinedMenuItem,
	PredefinedMenuItemOptions,
	Submenu,
} from '@tauri-apps/api/menu';
import { getTauriVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { version } from '../../../../package.json';
import { EditorUi } from '../../state/editor-ui';
import { WEBSITE, openExternal } from '../../state/file-io';
import { PanelLayout } from '../../state/panel-layout';
import { ProjectFiles } from '../../state/project-files';
import { ThemePreference, ThemeService } from '../../theme/theme.service';
import { Dialogs } from '../../ui/dialog/dialog';
import { IS_MAC } from '../../ui/kbd/keys';
import { CommandRegistry } from '../editor/command-registry';
import { EditorCommands } from '../editor/editor-commands';
import { EditorDialogs } from '../editor/editor-dialogs';
import { CommandPalette } from '../palette/command-palette';
import { SettingsDialog, confirmResetLayout } from '../settings/settings-dialog';

/** A menu entry: its own action, or a palette command (label, keys and enabled come from it). */
type Entry =
	| {
			text: string;
			keys?: string;
			run: () => void;
			/** Only in the editor (needs an open project). */
			editor?: boolean;
			enabled?: () => boolean;
	  }
	| { command: string }
	| 'separator';

/** Windows draws text after a tab right-aligned, like an accelerator. */
const SHOW_KEYS = navigator.userAgent.includes('Windows');

/**
 * The desktop window's menu bar (File, Edit, Project, View, Help). Shortcut keys are shown
 * but handled by the app (Editor.onKey), not registered with the menu, so they don't fire twice.
 */
@Injectable({ providedIn: 'root' })
export class AppMenu {
	private readonly router = inject(Router);
	private readonly files = inject(ProjectFiles);
	private readonly registry = inject(CommandRegistry);
	private readonly commands = inject(EditorCommands);
	private readonly editorDialogs = inject(EditorDialogs);
	private readonly dialogs = inject(Dialogs);
	private readonly ui = inject(EditorUi);
	private readonly layout = inject(PanelLayout);
	private readonly theme = inject(ThemeService);

	private readonly inEditor = signal(false);
	/** Menu items whose text or enabled state follow the app; synced by one effect. */
	private readonly live: {
		item: MenuItem;
		text: () => string;
		enabled: () => boolean;
		shown?: { text: string; enabled: boolean };
	}[] = [];
	private readonly themeItems: { item: CheckMenuItem; id: ThemePreference }[] = [];
	private readonly ready = signal(false);

	constructor() {
		this.router.events.subscribe((e) => {
			if (e instanceof NavigationEnd)
				this.inEditor.set(e.urlAfterRedirects.startsWith('/editor'));
		});
		effect(() => {
			if (!this.ready()) return;
			// Only changes go to the native menu: most edits change just undo / redo.
			for (const l of this.live) {
				const now = { text: l.text(), enabled: l.enabled() };
				if (now.text !== l.shown?.text) void l.item.setText(now.text);
				if (now.enabled !== l.shown?.enabled) void l.item.setEnabled(now.enabled);
				l.shown = now;
			}
			const pref = this.theme.preference();
			for (const t of this.themeItems) void t.item.setChecked(t.id === pref);
		});
		void this.build();
	}

	private async build(): Promise<void> {
		const predefined = (item: PredefinedMenuItemOptions['item']) =>
			PredefinedMenuItem.new({ item });
		const menu = await Menu.new({
			items: [
				// The Mac's first menu is the app's own, named after it.
				...(IS_MAC
					? [
							await this.submenu('ByteCaptions', [
								{ text: 'About ByteCaptions…', run: () => void this.about() },
								'separator',
								{ text: 'Settings…', keys: 'Ctrl+,', run: () => this.settings() },
								'separator',
								await predefined('Services'),
								'separator',
								await predefined('Hide'),
								await predefined('HideOthers'),
								await predefined('ShowAll'),
								'separator',
								await predefined('Quit'),
							]),
						]
					: []),
				await this.submenu('&File', [
					{
						text: 'New project from video…',
						keys: 'Ctrl+N',
						run: () => void this.newProject(),
					},
					{ text: 'Open project…', keys: 'Ctrl+O', run: () => void this.open() },
					'separator',
					{ command: 'save' },
					{ command: 'save-as' },
					'separator',
					{ text: 'Import captions…', keys: 'Ctrl+I', run: () => void this.import() },
					{ command: 'export' },
					...(this.registry.get('youtube') ? [{ command: 'youtube' }] : []),
					// On the Mac, Settings and Quit are in the app menu.
					...(IS_MAC
						? []
						: ([
								'separator',
								{ text: 'Settings…', keys: 'Ctrl+,', run: () => this.settings() },
								'separator',
								{
									text: 'Exit',
									keys: 'Alt+F4',
									run: () => void getCurrentWindow().close(),
								},
							] as Entry[])),
				]),
				await this.submenu('&Edit', [
					{ command: 'undo' },
					{ command: 'redo' },
					'separator',
					// The Mac's text fields only get ⌘X / ⌘C / ⌘V / ⌘A through its own Edit items;
					// with no text selected they pass the keys on, so cue copy and paste still work.
					...(IS_MAC
						? [
								await predefined('Cut'),
								await predefined('Copy'),
								await predefined('Paste'),
								await predefined('SelectAll'),
							]
						: ([
								{
									text: 'Cut',
									keys: 'Ctrl+X',
									editor: true,
									run: () => this.clipboard('cut'),
								},
								{
									text: 'Copy',
									keys: 'Ctrl+C',
									editor: true,
									run: () => this.clipboard('copy'),
								},
								{
									text: 'Paste',
									keys: 'Ctrl+V',
									editor: true,
									run: () => this.clipboard('paste'),
								},
							] as Entry[])),
					{ command: 'delete' },
					'separator',
					{ command: 'select-range' },
					{ command: 'shift-range' },
					{ command: 'delete-range' },
					{ command: 'ripple-range' },
					'separator',
					{ command: 'replace' },
					{
						text: 'Go to timecode…',
						keys: 'Ctrl+G',
						editor: true,
						run: () => this.palette('timecode'),
					},
					{
						text: 'Command palette…',
						keys: 'Ctrl+K',
						editor: true,
						run: () => this.palette('search'),
					},
				]),
				await this.submenu('&Project', [
					{ command: 'project-settings' },
					{ command: 'presets' },
					...(this.registry.get('transcribe') ? [{ command: 'transcribe' }] : []),
					'separator',
					{ command: 'new-track' },
				]),
				await this.submenu('&View', [
					{
						text: 'Zoom timeline in',
						keys: 'Ctrl+=',
						editor: true,
						run: () => this.ui.zoomTimeline?.('in'),
					},
					{
						text: 'Zoom timeline out',
						keys: 'Ctrl+-',
						editor: true,
						run: () => this.ui.zoomTimeline?.('out'),
					},
					{ command: 'zoom-fit' },
					{ command: 'snapping' },
					{ command: 'time-units' },
					'separator',
					await this.themeMenu(),
					{ text: 'Reset layout…', run: () => void this.resetLayout() },
				]),
				await this.submenu('Pla&yback', [
					{ command: 'play' },
					{ command: 'loop' },
					'separator',
					{ command: 'mark-in' },
					{ command: 'mark-out' },
					{ command: 'go-in' },
					{ command: 'go-out' },
					{ command: 'clear-range' },
					'separator',
					{ command: 'add-marker' },
					{ command: 'next-marker' },
					{ command: 'prev-marker' },
				]),
				...(IS_MAC
					? [
							await this.submenu('Window', [
								await predefined('Minimize'),
								await predefined('Maximize'),
								await predefined('Fullscreen'),
								'separator',
								await predefined('CloseWindow'),
							]),
						]
					: []),
				await this.submenu('&Help', [
					{ command: 'shortcuts' },
					'separator',
					{ text: 'ByteCaptions GitHub page', run: () => openExternal(WEBSITE) },
					...(IS_MAC
						? []
						: ([
								{ text: 'About ByteCaptions…', run: () => void this.about() },
							] as Entry[])),
				]),
			],
		});
		// The Mac has one menu bar for the whole app; Windows and Linux put it on the window.
		if (IS_MAC) await menu.setAsAppMenu();
		else await menu.setAsWindowMenu();
		this.ready.set(true);
	}

	private async submenu(
		text: string,
		entries: (Entry | Submenu | PredefinedMenuItem)[],
	): Promise<Submenu> {
		const items = [];
		for (const e of entries)
			items.push(
				e instanceof Submenu || e instanceof PredefinedMenuItem ? e : await this.item(e),
			);
		return Submenu.new({ text, items });
	}

	private async item(e: Entry): Promise<MenuItem | PredefinedMenuItem> {
		if (e === 'separator') return PredefinedMenuItem.new({ item: 'Separator' });
		const label = (text: string, keys?: string) =>
			SHOW_KEYS && keys ? `${text}\t${keys}` : text;
		let text: () => string;
		let enabled: () => boolean;
		let run: () => void;
		if ('command' in e) {
			const cmd = () => this.registry.get(e.command);
			text = () => label(cmd()?.label ?? e.command, cmd()?.keys);
			enabled = () => this.inEditor() && (cmd()?.enabled?.() ?? true);
			run = () => {
				const c = cmd();
				if (c && enabled()) c.run();
			};
		} else {
			text = () => label(e.text, e.keys);
			enabled = () => (!e.editor || this.inEditor()) && (e.enabled?.() ?? true);
			run = () => {
				if (enabled()) e.run();
			};
		}
		const shown = { text: text(), enabled: enabled() };
		const item = await MenuItem.new({ ...shown, action: run });
		this.live.push({ item, text, enabled, shown });
		return item;
	}

	private async themeMenu(): Promise<Submenu> {
		const options: { id: ThemePreference; text: string }[] = [
			{ id: 'system', text: 'Match system' },
			{ id: 'light', text: 'Light' },
			{ id: 'dark', text: 'Dark' },
		];
		const items = [];
		for (const o of options) {
			const item = await CheckMenuItem.new({
				text: o.text,
				checked: this.theme.preference() === o.id,
				action: () => this.theme.setPreference(o.id),
			});
			this.themeItems.push({ item, id: o.id });
			items.push(item);
		}
		return Submenu.new({ text: 'Theme', items });
	}

	/** Open the editor after File actions taken on the Start screen. */
	private go(ok: boolean): void {
		if (ok && !this.inEditor()) void this.router.navigateByUrl('/editor');
	}

	private async newProject(): Promise<void> {
		this.go(await this.files.newFromVideo());
	}

	private async open(): Promise<void> {
		this.go(await this.files.open());
	}

	/** In the editor, captions become a new track; on the Start screen, a new project. */
	private async import(): Promise<void> {
		if (this.inEditor()) await this.files.importCaptions();
		else this.go(await this.files.importAsNewProject());
	}

	/** Works on the Start screen too, so not via the editor's dialogs. */
	private settings(): void {
		if (!this.dialogs.isOpen) this.dialogs.open(SettingsDialog);
	}

	private palette(startMode: 'search' | 'timecode'): void {
		if (!this.dialogs.isOpen)
			this.dialogs.open(CommandPalette, { placement: 'top', inputs: { startMode } });
	}

	/** Text in a field or caption editor uses the system clipboard; otherwise cues do. */
	private clipboard(action: 'cut' | 'copy' | 'paste'): void {
		const el = document.activeElement as HTMLElement | null;
		const editing =
			!!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
		if (editing) {
			if (action === 'paste')
				void navigator.clipboard
					.readText()
					.then((t) => document.execCommand('insertText', false, t));
			else document.execCommand(action);
			return;
		}
		if (action === 'cut') this.commands.cut();
		else if (action === 'copy') this.commands.copy();
		else if (this.commands.canPaste) this.commands.paste();
	}

	/** Version and credits in a plain system dialog. */
	private async about(): Promise<void> {
		const webview = /Edg\/([\d.]+)/.exec(navigator.userAgent)?.[1];
		const runtime = [
			`Tauri ${await getTauriVersion()}`,
			webview ? `WebView2 ${webview}` : null,
		].filter(Boolean);
		await message(
			[
				`ByteCaptions ${version}`,
				'The open-source video editing-style subtitle editor',
				'',
				'Made by Michael Webb/Byte of Melon',
				WEBSITE.replace('https://', ''),
				'Licensed under the GNU GPL, version 3 or later',
				'',
				runtime.join(' • '),
			].join('\n'),
			{ title: 'About ByteCaptions', kind: 'info' },
		);
	}

	private async resetLayout(): Promise<void> {
		if (await confirmResetLayout()) this.layout.reset();
	}
}
