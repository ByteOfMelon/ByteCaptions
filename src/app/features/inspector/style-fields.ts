import { Component, booleanAttribute, input, output } from '@angular/core';
import {
	LucideBold,
	LucideItalic,
	LucideSubscript,
	LucideSuperscript,
	LucideUnderline,
} from '@lucide/angular';
import { CaptionStyle, EdgeType, YtFont } from '../../core/model/types';
import { ColorField } from '../../ui/controls/controls';
import { NumberField } from '../../ui/field/field';
import { Select } from '../../ui/select/select';
import { Tooltip } from '../../ui/tooltip/tooltip';
import { EDGE_LABEL, YT_FONT_LABEL } from '../player/caption-render';

/** One property change of a caption style */
export interface StyleChange<K extends keyof CaptionStyle = keyof CaptionStyle> {
	key: K;
	value: CaptionStyle[K];
}

const FONT_OPTIONS = (Object.keys(YT_FONT_LABEL) as YtFont[])
	.filter((f) => f !== 'default')
	.map((f) => ({ value: f, label: YT_FONT_LABEL[f] }));
const EDGE_OPTIONS = (Object.keys(EDGE_LABEL) as EdgeType[]).map((e) => ({
	value: e,
	label: EDGE_LABEL[e],
}));

/**
 * Caption style controls shared by the Inspector and the Style Presets dialog
 */
@Component({
	selector: 'bc-style-fields',
	imports: [
		ColorField,
		NumberField,
		Select,
		Tooltip,
		LucideBold,
		LucideItalic,
		LucideUnderline,
		LucideSubscript,
		LucideSuperscript,
	],
	templateUrl: './style-fields.html',
	styleUrl: './style-fields.css',
})
export class StyleFields {
	readonly captionStyle = input.required<CaptionStyle>({ alias: 'style' });
	readonly showEdge = input(false, { transform: booleanAttribute });
	readonly styleChange = output<StyleChange>();

	protected readonly fontOptions = FONT_OPTIONS;
	protected readonly edgeOptions = EDGE_OPTIONS;

	protected set<K extends keyof CaptionStyle>(key: K, value: CaptionStyle[K]): void {
		if (this.captionStyle()[key] !== value)
			this.styleChange.emit({ key, value } as StyleChange);
	}

	protected setPercent(key: 'scale' | 'textOpacity' | 'bgOpacity', pct: number): void {
		this.set(key, Math.round(pct) / 100);
	}
}
