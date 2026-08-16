import { Notice } from 'obsidian';
import type { TableModelV2 } from './model';
import { t } from './i18n';
import { formatRow, displayLen } from './serializer';
import { cellRawValue } from './renderCellStyle';

export function buildRangeGrid(model: TableModelV2, r1: number, r2: number, c1: number, c2: number): string[][] {
	const grid: string[][] = [];
	for (let r = r1; r <= r2; r++) {
		const row: string[] = [];
		for (let c = c1; c <= c2; c++) row.push(cellRawValue(model, r, c));
		grid.push(row);
	}
	return grid;
}

/**
 * Copies a rectangular range to the system clipboard as both plain-text TSV and an
 * HTML <table> — spreadsheet apps (Excel, Sheets) read the HTML table on paste and
 * reconstruct the grid; anything else falls back to the tab/newline-delimited text.
 */
export function copyRangeToClipboard(model: TableModelV2, r1: number, r2: number, c1: number, c2: number): void {
	const grid = buildRangeGrid(model, r1, r2, c1, c2);
	const tsv  = grid.map(row => row.map(v => v.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')).join('\n');
	const esc  = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const html = `<table>${grid.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`;

	void activeWindow.navigator.clipboard.write([
		new ClipboardItem({
			'text/plain': new Blob([tsv], { type: 'text/plain' }),
			'text/html':  new Blob([html], { type: 'text/html' }),
		}),
	]).catch(() => new Notice(t('copyFailed')));
}

/**
 * Copies a rectangular range to the clipboard as a standard GFM pipe table (the
 * topmost selected row becomes the header row) — pastes as literal Markdown source,
 * e.g. into a note or a chat box. Cell pipes are escaped and newlines become <br>
 * so the table stays valid on a single physical line per row.
 */
export function copyRangeAsMarkdown(model: TableModelV2, r1: number, r2: number, c1: number, c2: number): void {
	const grid = buildRangeGrid(model, r1, r2, c1, c2).map(row =>
		row.map(v => v.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')));
	const header = grid[0];
	if (!header) return;
	const widths = header.map((_, ci) => Math.max(3, ...grid.map(row => displayLen(row[ci] ?? ''))));

	const lines = [
		formatRow(header, widths),
		'| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |',
		...grid.slice(1).map(row => formatRow(row, widths)),
	];

	void activeWindow.navigator.clipboard.writeText(lines.join('\n'))
		.catch(() => new Notice(t('copyFailed')));
}

/**
 * Recognizes pasted plain text as a standard GFM/Markdown pipe table and
 * splits it into a grid — the read-back counterpart to copyRangeAsMarkdown's
 * output, and the general case for a table typed by hand, copied from
 * another note, or pasted from an LLM reply/GitHub/etc. (none of which emit
 * an HTML `<table>` alongside the plain text, unlike Excel/Sheets — see
 * renderEditMode.ts's paste handler, which tries that first). Returns null
 * when the text doesn't look like a pipe table, so the caller falls back to
 * ordinary single-cell text paste.
 *
 * Detection requires a GFM delimiter row (cells made only of `-`/`:`/
 * whitespace) directly below a pipe-framed first line, with both lines
 * containing at least one `|` — that combination essentially never occurs in
 * ordinary prose, so this doesn't need to sniff for pipe characters alone.
 * The `|`-in-both-lines requirement specifically rules out a Setext heading
 * or a bare `---` horizontal rule right after a plain line, either of which
 * would otherwise satisfy a pipe-less delimiter-row regex on its own.
 */
export function parseMarkdownPipeTable(text: string): string[][] | null {
	const lines = text.split(/\r\n|\n|\r/);
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
	if (lines.length < 2) return null;

	const splitRow = (line: string): string[] => {
		const parts = line.split(/(?<!\\)\|/);
		if (parts.length > 1 && parts[0]!.trim() === '') parts.shift();
		if (parts.length > 1 && parts[parts.length - 1]!.trim() === '') parts.pop();
		return parts;
	};

	const header = lines[0] ?? '';
	const delimiter = lines[1] ?? '';
	if (!header.includes('|') || !delimiter.includes('|')) return null;

	const delimiterCells = splitRow(delimiter);
	if (!delimiterCells.every(c => /^:?-+:?$/.test(c.trim()))) return null;

	const unescape = (s: string) => s.trim().replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, '\n');
	return [splitRow(header), ...lines.slice(2).map(splitRow)].map(row => row.map(unescape));
}

/**
 * Extracts a grid of cell text directly from an HTML `<table>` string,
 * instead of assuming the clipboard's accompanying text/plain is
 * tab-separated. Excel/Sheets' own convention IS a TSV text/plain alongside
 * the HTML table, but that's not a rule every `<table>`-emitting source
 * follows — confirmed with Obsidian's own "copy a rendered table": its
 * text/html is a real `<table>`, but its text/plain is the ORIGINAL MARKDOWN
 * PIPE SOURCE, not TSV, so splitting that on `\t` left every pipe-delimited
 * line as one giant unsplit cell (reported: every row landed in column A).
 * Reading the HTML directly works regardless of what text/plain contains.
 *
 * `<br>` becomes a literal newline (matching parseMarkdownPipeTable's own
 * handling) before falling back to `textContent` to flatten any other
 * markup (bold, links, inline code) a cell might contain — paste-as-values
 * already discards formatting the same way TSV paste always has.
 */
export function parseHtmlTable(html: string): string[][] | null {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const table = doc.querySelector('table');
	if (!table) return null;
	// Walks the already-parsed (inert) DOM directly rather than round-tripping
	// through innerHTML — <br> becomes a literal newline, any other element
	// (bold, links, inline code) is flattened to its own text content the
	// same way plain single-cell paste already discards formatting.
	const cellText = (cell: Element): string => {
		let text = '';
		const walk = (node: ChildNode) => {
			if (node.nodeType === Node.TEXT_NODE) { text += node.textContent ?? ''; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if ((node as Element).tagName === 'BR') { text += '\n'; return; }
			node.childNodes.forEach(walk);
		};
		cell.childNodes.forEach(walk);
		return text.trim();
	};
	const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
		Array.from(tr.querySelectorAll('td, th')).map(cellText));
	return rows.length > 0 ? rows : null;
}
