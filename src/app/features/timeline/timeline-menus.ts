import { Injectable, inject } from '@angular/core';
import {
	LucideArrowDown,
	LucideArrowLeftToLine,
	LucideArrowRightToLine,
	LucideArrowUp,
	LucideBookmarkPlus,
	LucideClipboardPaste,
	LucideClock,
	LucideCopy,
	LucideDelete,
	LucideMerge,
	LucideMove,
	LucidePencil,
	LucidePlus,
	LucideRepeat,
	LucideScissors,
	LucideSquareDashedMousePointer,
	LucideTrash2,
	LucideType,
	LucideUpload,
	LucideX,
} from '@lucide/angular';
import { MARKER_COLORS } from '../../core/model/defaults';
import { CueId, MarkerColor, MarkerId, Ms, StyleId, Track, TrackId } from '../../core/model/types';
import { EditorUi } from '../../state/editor-ui';
import { TRACK_COLORS } from '../../state/project-files';
import { ProjectStore } from '../../state/project-store';
import { ContextMenu, MenuEntry } from '../../ui/menu/menu';
import { EditorCommands } from '../editor/editor-commands';
import { EditorDialogs } from '../editor/editor-dialogs';
import { Playback } from '../player/playback';
import { Markers } from '../markers/markers';

type At = { x: number; y: number } | MouseEvent;

/**
 * Right-click menus for the timeline (Timeline Menus board): a cue, several selected cues,
 * empty lane space, a track header, the ruler and a marker. Keys shown are the editor's current bindings.
 */
@Injectable({ providedIn: 'root' })
export class TimelineMenus {
	private readonly store = inject(ProjectStore);
	private readonly commands = inject(EditorCommands);
	private readonly dialogs = inject(EditorDialogs);
	private readonly ui = inject(EditorUi);
	private readonly menu = inject(ContextMenu);
	private readonly playback = inject(Playback);
	private readonly markers = inject(Markers);

	/** "Style preset" submenu: presets with a check on `current`, then "Edit presets…". */
	private presetMenu(current: StyleId | null): MenuEntry[] {
		return [
			...Object.entries(this.store.project().styles).map(([id, s]) => ({
				id: `preset:${id}`,
				label: s.name,
				checked: id === current,
			})),
			{ kind: 'separator' },
			{ id: 'edit-presets', label: 'Edit presets…', icon: LucidePencil.icon },
		];
	}

	private trackMenu(exclude: TrackId | null): MenuEntry[] {
		return this.store.project().tracks.map((t) => ({
			id: `track:${t.id}`,
			label: t.name,
			swatch: t.color,
			disabled: t.id === exclude || t.locked,
		}));
	}

	/** Shared handling for submenu ids. Returns true if `id` was one of them. */
	private runShared(id: string, cues: CueId[], styleId: StyleId | null): boolean {
		if (id.startsWith('preset:')) {
			this.commands.setPreset(cues, id.slice(7));
			return true;
		}
		if (id.startsWith('track:')) {
			this.commands.moveToTrack(cues, id.slice(6));
			return true;
		}
		if (id === 'edit-presets') {
			this.dialogs.presets(styleId ?? undefined);
			return true;
		}
		return false;
	}

	async cue(at: At, track: Track, cueId: CueId): Promise<void> {
		if (!this.store.selection().has(cueId)) this.store.select(cueId);
		const sel = this.store.selectedCues();
		if (sel.length > 1) return this.several(at);

		// Number as the cue list does: across all tracks, in time order.
		const { cue, index } = sel[0];
		const styleId = cue.styleId ?? track.defaultStyleId;
		const t = this.store.playhead();
		const locked = track.locked;
		const id = await this.menu.open(at, [
			{ kind: 'header', label: `Cue ${index}` },
			{
				id: 'split',
				label: 'Split at playhead',
				icon: LucideScissors.icon,
				keys: 'S',
				disabled: locked || !(cue.start < t && t < cue.end),
			},
			{
				id: 'merge',
				label: 'Merge with next',
				icon: LucideMerge.icon,
				keys: 'M',
				disabled: locked || track.cues.at(-1)?.id === cue.id,
			},
			{
				id: 'duplicate',
				label: 'Duplicate',
				icon: LucideCopy.icon,
				keys: 'Ctrl+D',
				disabled: locked,
			},
			{ kind: 'separator' },
			{
				id: 'cut',
				label: 'Cut',
				icon: LucideScissors.icon,
				keys: 'Ctrl+X',
				disabled: locked,
			},
			{ id: 'copy', label: 'Copy', icon: LucideCopy.icon, keys: 'Ctrl+C' },
			{ kind: 'separator' },
			{
				id: 'preset',
				label: 'Style preset',
				icon: LucideType.icon,
				value: this.store.project().styles[styleId]?.name,
				disabled: locked,
				submenu: this.presetMenu(styleId),
			},
			{
				id: 'move',
				label: 'Move to track',
				icon: LucideMove.icon,
				disabled: locked,
				submenu: this.trackMenu(track.id),
			},
			{ kind: 'separator' },
			{
				id: 'set-start',
				label: 'Set start to playhead',
				icon: LucideClock.icon,
				keys: '[',
				disabled: locked || t >= cue.end,
			},
			{
				id: 'set-end',
				label: 'Set end to playhead',
				icon: LucideClock.icon,
				keys: ']',
				disabled: locked || t <= cue.start,
			},
			{ kind: 'separator' },
			{
				id: 'delete',
				label: 'Delete',
				icon: LucideTrash2.icon,
				keys: 'Del',
				danger: true,
				disabled: locked,
			},
			{
				id: 'ripple-delete',
				label: 'Ripple delete',
				icon: LucideDelete.icon,
				keys: 'Shift+Del',
				danger: true,
				disabled: locked,
			},
		]);
		if (!id || this.runShared(id, [cueId], styleId)) return;
		const run: Record<string, () => void> = {
			split: () => this.commands.splitAtPlayhead(),
			merge: () => this.commands.merge(),
			duplicate: () => this.commands.duplicateSelected(),
			'set-start': () => this.commands.setStartToPlayhead(),
			'set-end': () => this.commands.setEndToPlayhead(),
			delete: () => this.commands.deleteSelected(),
			'ripple-delete': () => this.commands.rippleDeleteSelected(),
		};
		run[id]?.();
	}

	async several(at: At): Promise<void> {
		const sel = this.store.selectedCues().filter((r) => !r.track.locked);
		const n = this.store.selectedCues().length;
		const ids = sel.map((r) => r.cue.id);
		const tracks = new Set(sel.map((r) => r.track.id));
		const styles = new Set(sel.map((r) => r.cue.styleId ?? r.track.defaultStyleId));
		const common = styles.size === 1 ? [...styles][0] : null;
		const id = await this.menu.open(at, [
			{ kind: 'header', label: `${n} cues selected` },
			{
				id: 'merge',
				label: 'Merge into one cue',
				icon: LucideMerge.icon,
				keys: 'M',
				// Merging only joins cues on one track.
				disabled: tracks.size !== 1 || sel.length !== n,
			},
			{
				id: 'preset',
				label: 'Style preset',
				icon: LucideType.icon,
				value: common ? this.store.project().styles[common]?.name : 'Mixed',
				disabled: !ids.length,
				submenu: this.presetMenu(common),
			},
			{
				id: 'move',
				label: 'Move to track',
				icon: LucideMove.icon,
				disabled: tracks.size !== 1,
				submenu: this.trackMenu(tracks.size === 1 ? [...tracks][0] : null),
			},
			{
				id: 'shift',
				label: 'Shift timing…',
				icon: LucideClock.icon,
				disabled: !ids.length,
			},
			{ kind: 'separator' },
			{
				id: 'cut',
				label: `Cut ${n} cues`,
				icon: LucideScissors.icon,
				keys: 'Ctrl+X',
				disabled: !ids.length,
			},
			{ id: 'copy', label: `Copy ${n} cues`, icon: LucideCopy.icon, keys: 'Ctrl+C' },
			{ kind: 'separator' },
			{
				id: 'delete',
				label: `Delete ${n} cues`,
				icon: LucideTrash2.icon,
				keys: 'Del',
				danger: true,
				disabled: !ids.length,
			},
			{
				id: 'ripple-delete',
				label: `Ripple delete ${n} cues`,
				icon: LucideDelete.icon,
				keys: 'Shift+Del',
				danger: true,
				disabled: !ids.length,
			},
		]);
		if (!id || this.runShared(id, ids, common)) return;
		if (id === 'merge') this.commands.merge();
		else if (id === 'shift') void this.dialogs.shiftTiming(ids);
		else if (id === 'cut') this.commands.cut();
		else if (id === 'copy') this.commands.copy();
		else if (id === 'delete') this.commands.deleteSelected();
		else if (id === 'ripple-delete') this.commands.rippleDeleteSelected();
	}

	async lane(at: At, track: Track, atMs: Ms): Promise<void> {
		const id = await this.menu.open(at, [
			{
				id: 'new',
				label: 'New cue here',
				icon: LucidePlus.icon,
				keys: 'Enter',
				disabled: track.locked,
			},
			{
				id: 'paste',
				label: 'Paste',
				icon: LucideClipboardPaste.icon,
				keys: 'Ctrl+V',
				disabled: track.locked || !this.commands.canPaste,
			},
			{ kind: 'separator' },
			{
				id: 'select-all',
				label: 'Select all on track',
				icon: LucideSquareDashedMousePointer.icon,
				keys: 'Ctrl+A',
				disabled: !track.cues.length,
			},
		]);
		if (id === 'new') this.commands.newCueAt(atMs, track.id);
		else if (id === 'paste') this.commands.paste(atMs, track.id);
		else if (id === 'select-all') this.commands.selectAllOnTrack(track.id);
	}

	/** Ruler: add a marker or set the in/out points where it was clicked, or clear them. */
	async ruler(at: At, atMs: Ms): Promise<void> {
		const r = this.playback.range();
		// Right-clicking inside the range offers what can be done with the cues in it.
		const inRange = !!r && atMs >= r.start && atMs <= r.end;
		const n = inRange ? this.commands.rangeCues().length : 0;
		const rangeItems: MenuEntry[] = inRange
			? [
					{ kind: 'header', label: `In/out range • ${n === 1 ? '1 cue' : `${n} cues`}` },
					{
						id: 'select-range',
						label: 'Select cues in range',
						icon: LucideSquareDashedMousePointer.icon,
						disabled: !n,
					},
					{
						id: 'shift-range',
						label: 'Shift cues in range…',
						icon: LucideMove.icon,
						disabled: !n,
					},
					{
						id: 'delete-range',
						label: 'Delete cues in range',
						icon: LucideTrash2.icon,
						disabled: !n,
					},
					{
						id: 'ripple-range',
						label: 'Ripple delete range',
						icon: LucideDelete.icon,
						danger: true,
					},
					{ kind: 'separator' },
				]
			: [];
		const id = await this.menu.open(at, [
			...rangeItems,
			{ id: 'marker', label: 'Add marker here', icon: LucideBookmarkPlus.icon },
			{ kind: 'separator' },
			{ id: 'in', label: 'Mark in here', icon: LucideArrowRightToLine.icon },
			{ id: 'out', label: 'Mark out here', icon: LucideArrowLeftToLine.icon },
			{
				id: 'clear',
				label: 'Clear in and out',
				icon: LucideX.icon,
				keys: 'Alt+X',
				disabled: !this.playback.range(),
			},
			{ kind: 'separator' },
			{
				id: 'loop',
				label: 'Loop playback',
				icon: LucideRepeat.icon,
				keys: 'Ctrl+L',
				checked: this.playback.loop(),
			},
		]);
		if (id === 'select-range') this.commands.selectRange();
		else if (id === 'shift-range')
			void this.dialogs.shiftTiming(this.commands.rangeCues().map((x) => x.cue.id));
		else if (id === 'delete-range') this.commands.deleteRange(false);
		else if (id === 'ripple-range') this.commands.deleteRange(true);
		else if (id === 'marker') this.markers.addAt(atMs);
		else if (id === 'in') this.playback.setIn(atMs);
		else if (id === 'out') this.playback.setOut(atMs);
		else if (id === 'clear') this.playback.clearRange();
		else if (id === 'loop') this.playback.loop.update((on) => !on);
	}

	async marker(at: At, id: MarkerId): Promise<void> {
		const m = this.markers.find(id);
		if (!m) return;
		const colors: MarkerColor[] = ['yellow', 'red', 'blue', 'purple', 'green'];
		const choice = await this.menu.open(at, [
			{ kind: 'header', label: `Marker ${this.markers.number(id)}` },
			{ id: 'edit', label: 'Edit note…', icon: LucidePencil.icon },
			{
				id: 'color',
				label: 'Color',
				swatch: MARKER_COLORS[m.color],
				submenu: colors.map((c) => ({
					id: `color:${c}`,
					label: c[0].toUpperCase() + c.slice(1),
					swatch: MARKER_COLORS[c],
					checked: c === m.color,
				})),
			},
			{ kind: 'separator' },
			{ id: 'delete', label: 'Delete marker', icon: LucideTrash2.icon, danger: true },
		]);
		if (choice === 'edit') this.markers.edit(id);
		else if (choice === 'delete') this.markers.remove(id);
		else if (choice?.startsWith('color:'))
			this.markers.setColor(id, choice.slice(6) as MarkerColor);
	}

	async header(at: At, track: Track): Promise<void> {
		const tracks = this.store.project().tracks;
		const id = await this.menu.open(at, [
			{ kind: 'header', label: `${track.name} track` },
			{ id: 'rename', label: 'Rename', icon: LucidePencil.icon, keys: 'F2' },
			{
				id: 'preset',
				label: 'Style preset',
				icon: LucideType.icon,
				value: this.store.project().styles[track.defaultStyleId]?.name,
				submenu: this.presetMenu(track.defaultStyleId),
			},
			{
				id: 'color',
				label: 'Track color',
				swatch: track.color,
				submenu: TRACK_COLORS.map((c, i) => ({
					id: `color:${c}`,
					label: `Color ${i + 1}`,
					swatch: c,
					checked: c.toLowerCase() === track.color.toLowerCase(),
				})),
			},
			{ kind: 'separator' },
			{ id: 'new-track', label: 'New track', icon: LucidePlus.icon },
			{ id: 'duplicate', label: 'Duplicate track', icon: LucideCopy.icon },
			{
				id: 'up',
				label: 'Move up',
				icon: LucideArrowUp.icon,
				disabled: tracks[0].id === track.id,
			},
			{
				id: 'down',
				label: 'Move down',
				icon: LucideArrowDown.icon,
				disabled: tracks.at(-1)!.id === track.id,
			},
			{ id: 'export', label: 'Export this track…', icon: LucideUpload.icon },
			{ kind: 'separator' },
			{
				id: 'delete',
				label: 'Delete track',
				icon: LucideTrash2.icon,
				danger: true,
				disabled: tracks.length < 2,
			},
		]);
		if (!id) return;
		if (id.startsWith('preset:')) this.commands.setTrackPreset(track.id, id.slice(7));
		else if (id.startsWith('color:')) this.commands.setTrackColor(track.id, id.slice(6));
		else if (id === 'edit-presets') this.dialogs.presets(track.defaultStyleId);
		else if (id === 'rename') this.ui.renamingTrack.set(track.id);
		else if (id === 'new-track') this.ui.renamingTrack.set(this.commands.newTrack(track.id));
		else if (id === 'duplicate') this.commands.duplicateTrack(track.id);
		else if (id === 'up') this.commands.moveTrack(track.id, -1);
		else if (id === 'down') this.commands.moveTrack(track.id, 1);
		else if (id === 'export') this.dialogs.export([track.id]);
		else if (id === 'delete') this.commands.deleteTrack(track.id);
	}
}
