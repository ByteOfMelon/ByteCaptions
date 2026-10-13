/**
 * A small Markdown subset for release notes: headings, paragraphs, bullet and numbered lists,
 * bold, italic, inline code and links. Parsed to data and rendered by the template, never as HTML
 */

export type Inline =
	| { kind: 'text'; text: string }
	| { kind: 'bold' | 'italic'; children: Inline[] }
	| { kind: 'code'; text: string }
	| { kind: 'link'; url: string; children: Inline[] };

export type Block =
	| { kind: 'heading'; content: Inline[] }
	| { kind: 'paragraph'; content: Inline[] }
	| { kind: 'list'; ordered: boolean; items: Inline[][] };

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseNotes(md: string): Block[] {
	const blocks: Block[] = [];
	let paragraph: string[] = [];

	const flush = () => {
		if (paragraph.length)
			blocks.push({ kind: 'paragraph', content: inline(paragraph.join(' ')) });

		paragraph = [];
	};

	for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
		const heading = HEADING.exec(line);
		const item = BULLET.exec(line) ?? NUMBERED.exec(line);

		if (!line.trim()) flush();
		else if (heading) {
			flush();
			blocks.push({ kind: 'heading', content: inline(heading[1]) });
		} else if (item) {
			flush();
			const ordered = !BULLET.test(line);
			const last = blocks.at(-1);

			if (last?.kind === 'list' && last.ordered === ordered) last.items.push(inline(item[1]));
			else blocks.push({ kind: 'list', ordered, items: [inline(item[1])] });
		} else {
			const last = blocks.at(-1);

			// An indented line right after a list item continues that item
			if (!paragraph.length && last?.kind === 'list' && /^\s+/.test(line))
				last.items[last.items.length - 1].push(
					{ kind: 'text', text: ' ' },
					...inline(line.trim()),
				);
			else paragraph.push(line.trim());
		}
	}

	flush();

	return blocks;
}

// Longest-first so ** wins over *; links only for http(s), anything else stays as text
const TOKEN =
	/`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|(?<![\w])_(.+?)_(?![\w])/g;

export function inline(text: string): Inline[] {
	const out: Inline[] = [];
	let at = 0;

	for (const m of text.matchAll(TOKEN)) {
		if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });

		const [, code, label, url, bold1, bold2, em1, em2] = m;

		if (code !== undefined) out.push({ kind: 'code', text: code });
		else if (url !== undefined) out.push({ kind: 'link', url, children: inline(label) });
		else if ((bold1 ?? bold2) !== undefined)
			out.push({ kind: 'bold', children: inline(bold1 ?? bold2) });
		else out.push({ kind: 'italic', children: inline(em1 ?? em2) });

		at = m.index + m[0].length;
	}

	if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });

	return out;
}
