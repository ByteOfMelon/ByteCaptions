import { Draft, Patch, applyPatches, enablePatches, produceWithPatches } from 'immer';

enablePatches();

export type Recipe<T> = (draft: Draft<T>) => void;

interface Entry {
	label: string;
	patches: Patch[];
	inverse: Patch[];
}

/**
 * Undo/redo history
 *
 * Every mutation goes through `apply()`. Continuous gestures (dragging a block,
 * typing) should be wrapped in `begin()`/`end()` so they undo as one step
 */
export class History<T> {
	private past: Entry[] = [];
	private future: Entry[] = [];
	private group: Entry | null = null;

	constructor(
		private state: T,
		private readonly limit = 500,
	) {}

	get current(): T {
		return this.state;
	}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	get undoLabel(): string | undefined {
		return this.past.at(-1)?.label;
	}

	get redoLabel(): string | undefined {
		return this.future.at(-1)?.label;
	}

	apply(label: string, recipe: Recipe<T>): T {
		const [next, patches, inverse] = produceWithPatches(this.state, recipe);
		if (patches.length === 0) return this.state;
		this.state = next as T;
		if (this.group) {
			this.group.patches.push(...patches);
			this.group.inverse.unshift(...inverse);
		} else {
			this.push({ label, patches, inverse });
		}
		this.future = [];
		return this.state;
	}

	/** Start grouping subsequent apply() calls into one undo step */
	begin(label: string): void {
		if (!this.group) this.group = { label, patches: [], inverse: [] };
	}

	end(): void {
		const g = this.group;
		this.group = null;
		if (g && g.patches.length) this.push(g);
	}

	undo(): T {
		this.end();
		const e = this.past.pop();
		if (!e) return this.state;
		this.state = applyPatches(this.state as object, e.inverse) as T;
		this.future.push(e);
		return this.state;
	}

	redo(): T {
		const e = this.future.pop();
		if (!e) return this.state;
		this.state = applyPatches(this.state as object, e.patches) as T;
		this.past.push(e);
		return this.state;
	}

	/** Replace state without history */
	reset(state: T): void {
		this.state = state;
		this.past = [];
		this.future = [];
		this.group = null;
	}

	private push(e: Entry): void {
		this.past.push(e);
		if (this.past.length > this.limit) this.past.shift();
	}
}
