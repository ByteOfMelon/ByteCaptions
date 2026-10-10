import { Component, booleanAttribute, computed, input } from '@angular/core';
import { CaptionStyle } from '../../core/model/types';
import { captionTextStyle } from './caption-render';

/** Text sample rendered with a caption style's real font, colors and edge for the timeline */
@Component({
	selector: 'bc-style-chip',
	template: `<span [style]="css()" aria-hidden="true">Aa</span>`,
	styles: `
		:host {
			display: inline-flex;
			flex-shrink: 0;
		}
		span {
			padding: 0 4px;
			border-radius: var(--radius-small);
			font-size: 12px;
			line-height: var(--line-height);
		}
		:host(.large) span {
			display: grid;
			place-items: center;
			width: 40px;
			height: 40px;
			padding: 0;
			font-size: 16px;
		}
	`,
	host: { '[class.large]': 'large()' },
})
export class StyleChip {
	readonly captionStyle = input.required<CaptionStyle>({ alias: 'style' });
	/** 40×40 tile used in the Style Presets list. */
	readonly large = input(false, { transform: booleanAttribute });
	protected readonly css = computed(() => captionTextStyle(this.captionStyle(), 1));
}
