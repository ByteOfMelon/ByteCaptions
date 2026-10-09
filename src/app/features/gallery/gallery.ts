import { Component, inject, signal } from '@angular/core';
import {
	LucideCopy,
	LucideFolder,
	LucideMerge,
	LucideMoon,
	LucidePlus,
	LucideRepeat,
	LucideScissors,
	LucideSearch,
	LucideSun,
	LucideTimer,
	LucideTrash2,
	LucideType,
} from '@lucide/angular';
import { ThemeService } from '../../theme/theme.service';
import { Button, IconButton } from '../../ui/button/button';
import { Checkbox, ColorField, Radio, Slider, Toggle } from '../../ui/controls/controls';
import { Field, NumberField } from '../../ui/field/field';
import { Kbd } from '../../ui/kbd/kbd';
import { ContextMenu, MenuEntry } from '../../ui/menu/menu';
import { Select } from '../../ui/select/select';
import { Tabs } from '../../ui/tabs/tabs';
import { Tooltip } from '../../ui/tooltip/tooltip';

/** Dev-only component gallery (/gallery). */
@Component({
	imports: [
		Button,
		IconButton,
		Field,
		NumberField,
		Checkbox,
		Radio,
		Toggle,
		Slider,
		ColorField,
		Select,
		Kbd,
		Tabs,
		Tooltip,
		LucideSun,
		LucideMoon,
		LucidePlus,
		LucideScissors,
		LucideSearch,
		LucideFolder,
	],
	selector: 'bc-gallery',
	styleUrl: './gallery.css',
	templateUrl: './gallery.html',
})
export class Gallery {
	protected readonly theme = inject(ThemeService);
	protected readonly fonts = [
		{ value: 'prop-sans', label: 'Proportional Sans' },
		{ value: 'mono-serif', label: 'Monospaced Serif' },
		{ value: 'casual', label: 'Casual' },
		{ value: 'small-caps', label: 'Small Capitals' },
	];
	protected readonly font = signal('mono-serif');
	protected readonly maxChars = signal(42);
	protected readonly size = signal(100);
	protected readonly karaoke = signal(true);
	protected readonly snapping = signal(true);
	protected readonly anchor = signal('bottom');
	protected readonly bgOpacity = signal(60);
	protected readonly progress = signal(4);
	protected readonly tab = signal('cues');
	protected readonly tabs = [
		{ value: 'cues', label: 'Cues' },
		{ value: 'transcript', label: 'Transcript' },
		{ value: 'problems', label: 'Problems' },
	];
	private readonly contextMenu = inject(ContextMenu);
	protected readonly lastMenu = signal('');
	protected async openCueMenu(e: MouseEvent): Promise<void> {
		const items: MenuEntry[] = [
			{ kind: 'header', label: 'Cue 14' },
			{ id: 'split', label: 'Split at playhead', icon: LucideScissors.icon, keys: 'S' },
			{ id: 'merge', label: 'Merge with next', icon: LucideMerge.icon, keys: 'M' },
			{ id: 'duplicate', label: 'Duplicate', icon: LucideCopy.icon, keys: 'Ctrl+D' },
			{ kind: 'separator' },
			{
				id: 'preset',
				label: 'Style preset',
				icon: LucideType.icon,
				value: 'Dialogue',
				submenu: [
					{ id: 'p-dialogue', label: 'Dialogue', checked: true },
					{ id: 'p-sfx', label: 'Sound effect' },
					{ id: 'p-speaker2', label: 'Speaker 2' },
					{ kind: 'separator' },
					{ id: 'p-edit', label: 'Edit presets…' },
				],
			},
			{
				id: 'move',
				label: 'Move to track',
				icon: LucideRepeat.icon,
				submenu: [{ id: 'm-sfx', label: 'Sound effects', swatch: 'var(--color-track-2)' }],
			},
			{ kind: 'separator' },
			{ id: 'start', label: 'Set start to playhead', icon: LucideTimer.icon, keys: '[' },
			{ id: 'end', label: 'Set end to playhead', icon: LucideTimer.icon, keys: ']' },
			{ kind: 'separator' },
			{ id: 'delete', label: 'Delete', icon: LucideTrash2.icon, keys: 'Del', danger: true },
		];
		this.lastMenu.set((await this.contextMenu.open(e, items)) ?? 'dismissed');
	}
}
