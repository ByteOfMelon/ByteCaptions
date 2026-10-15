import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideCopy, LucidePencil, LucideTrash2 } from '@lucide/angular';
import { styleSummary } from '../../core/model/style-summary';
import { confirmAction } from '../../state/file-io';
import { PresetLibrary } from '../../state/preset-library';
import { Autofocus } from '../../ui/autofocus/autofocus';
import { Button, IconButton } from '../../ui/button/button';
import { count } from '../../ui/count/count';
import { Notice } from '../../ui/notice/notice';
import { Tooltip } from '../../ui/tooltip/tooltip';
import { StyleChip } from '../player/style-chip';

@Component({
	selector: 'bc-style-library',
	imports: [
		Autofocus,
		Button,
		IconButton,
		Notice,
		Tooltip,
		StyleChip,
		LucideCopy,
		LucidePencil,
		LucideTrash2,
	],
	templateUrl: './style-library.html',
	styleUrl: './style-library.css',
})
export class StyleLibrary implements OnInit {
	protected readonly library = inject(PresetLibrary);
	protected readonly selectedId = signal<string | null>(null);
	/** Preset whose name is being edited */
	protected readonly renaming = signal<string | null>(null);

	protected readonly rows = computed(() =>
		this.library.list().map((p) => ({ ...p, summary: styleSummary(p.style) })),
	);
	protected readonly total = computed(() => count(this.rows().length, 'preset'));

	ngOnInit(): void {
		void this.library.load();
	}

	protected startRename(id: string): void {
		this.selectedId.set(id);
		this.renaming.set(id);
	}

	protected async finishRename(id: string, name: string): Promise<void> {
		if (this.renaming() !== id) return;

		this.renaming.set(null);
		await this.library.rename(id, name);
	}

	protected onRenameKey(e: KeyboardEvent, id: string): void {
		if (e.key === 'Enter') void this.finishRename(id, (e.target as HTMLInputElement).value);
		else if (e.key === 'Escape') {
			// Cancel the rename without closing the dialog
			e.preventDefault();
			e.stopPropagation();
			this.renaming.set(null);
		}
	}

	protected async duplicate(id: string): Promise<void> {
		const copy = await this.library.duplicate(id);

		if (copy) this.selectedId.set(copy);
	}

	protected async remove(id: string): Promise<void> {
		const name = this.library.get(id)?.name;

		if (
			name &&
			(await confirmAction(
				`Delete ${name} from your library? Projects that already use it keep their copy.`,
				'Delete preset',
				'Delete',
			))
		)
			await this.library.remove(id);
	}
}
