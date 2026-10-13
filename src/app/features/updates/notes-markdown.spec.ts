import { inline, parseNotes } from './notes-markdown';

describe('release notes markdown', () => {
	it('splits headings, paragraphs and lists', () => {
		const blocks = parseNotes(
			'### New\nAdds auto-update\nand more.\n\n- One\n- Two\n\n1. First\n2. Second',
		);
		expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list']);
		expect(blocks[1]).toEqual({
			kind: 'paragraph',
			content: [{ kind: 'text', text: 'Adds auto-update and more.' }],
		});
		expect(blocks[2]).toMatchObject({
			ordered: false,
			items: [[{ text: 'One' }], [{ text: 'Two' }]],
		});
		expect(blocks[3]).toMatchObject({ ordered: true });
	});

	it('parses bold, italic, code and links, nesting inside links', () => {
		expect(inline('a **b** _c_ `d` [**e**](https://x.dev/f)')).toEqual([
			{ kind: 'text', text: 'a ' },
			{ kind: 'bold', children: [{ kind: 'text', text: 'b' }] },
			{ kind: 'text', text: ' ' },
			{ kind: 'italic', children: [{ kind: 'text', text: 'c' }] },
			{ kind: 'text', text: ' ' },
			{ kind: 'code', text: 'd' },
			{ kind: 'text', text: ' ' },
			{
				kind: 'link',
				url: 'https://x.dev/f',
				children: [{ kind: 'bold', children: [{ kind: 'text', text: 'e' }] }],
			},
		]);
	});

	it('leaves non-web links and snake_case words as plain text', () => {
		expect(inline('[x](javascript:alert(1)) snake_case_name')).toEqual([
			{ kind: 'text', text: '[x](javascript:alert(1)) snake_case_name' },
		]);
	});
});
