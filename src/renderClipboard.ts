import { Notice } from 'obsidian';
import type { TableModelV2 } from './model';
import { t } from './i18n';
import { formatRow, displayLen } from './serializer';
import { cellRawValue } from './renderCellStyle';
import { resolveMergeBounds } from './renderGridHelpers';

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
 * Builds a merge-aware HTML <table> for a copied range: a merge fully or partly
 * inside the range becomes a real rowspan/colspan (clipped to the range's own
 * edges), and the cells it covers are omitted rather than repeating the anchor's
 * value — this is what lets pasting into Excel/Sheets/Word reconstruct the same
 * merged cells instead of a flat grid with the anchor's text duplicated everywhere.
 * A merge whose anchor sits OUTSIDE the copied range (a selection that starts
 * mid-merge) can't attach a span to anything still in range, so its covered cells
 * inside the range are left as ordinary blank cells instead — the same ambiguity
 * a spreadsheet itself faces when a merged region is only partially selected.
 */
export function buildRangeHtml(model: TableModelV2, r1: number, r2: number, c1: number, c2: number): string {
	const covered = new Set<string>();
	const spanFor = new Map<string, { rowspan: number; colspan: number }>();

	for (const m of resolveMergeBounds(model)) {
		if (m.rowHi < r1 || m.rowLo > r2 || m.colHi < c1 || m.colLo > c2) continue;
		if (m.rowLo < r1 || m.rowLo > r2 || m.colLo < c1 || m.colLo > c2) continue; // anchor outside range
		const rowHi = Math.min(m.rowHi, r2);
		const colHi = Math.min(m.colHi, c2);
		spanFor.set(`${m.rowLo},${m.colLo}`, { rowspan: rowHi - m.rowLo + 1, colspan: colHi - m.colLo + 1 });
		for (let r = m.rowLo; r <= rowHi; r++)
			for (let c = m.colLo; c <= colHi; c++)
				if (r !== m.rowLo || c !== m.colLo) covered.add(`${r},${c}`);
	}

	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const rows: string[] = [];
	for (let r = r1; r <= r2; r++) {
		const cells: string[] = [];
		for (let c = c1; c <= c2; c++) {
			const key = `${r},${c}`;
			if (covered.has(key)) continue;
			const span = spanFor.get(key);
			const attrs = span
				? `${span.rowspan > 1 ? ` rowspan="${span.rowspan}"` : ''}${span.colspan > 1 ? ` colspan="${span.colspan}"` : ''}`
				: '';
			cells.push(`<td${attrs}>${esc(cellRawValue(model, r, c))}</td>`);
		}
		rows.push(`<tr>${cells.join('')}</tr>`);
	}
	return `<table>${rows.join('')}</table>`;
}

/**
 * Copies a rectangular range to the system clipboard as both plain-text TSV and an
 * HTML <table> — spreadsheet apps (Excel, Sheets) read the HTML table on paste and
 * reconstruct the grid; anything else falls back to the tab/newline-delimited text.
 * The HTML side preserves merged cells (see buildRangeHtml); TSV has no concept of
 * a merge, so it stays a flat grid with the anchor's value repeated, as before.
 */
export function copyRangeToClipboard(model: TableModelV2, r1: number, r2: number, c1: number, c2: number): void {
	const grid = buildRangeGrid(model, r1, r2, c1, c2);
	const tsv  = grid.map(row => row.map(v => v.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')).join('\n');
	const html = buildRangeHtml(model, r1, r2, c1, c2);

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
export interface PastedRange {
	values: string[][];
	/** Rectangles, 0-indexed and relative to the pasted block's own top-left —
	 *  one per source `<td>`/`<th>` that had a real rowspan/colspan>1. */
	merges: { r1: number; c1: number; r2: number; c2: number }[];
}

/**
 * Parses an HTML `<table>` into both a flat values grid AND the merge
 * rectangles a real rowspan/colspan implies — the read-back counterpart to
 * buildRangeHtml's own output, so copying a range with merged cells and
 * pasting it back (into this table or a different one) reconstructs the
 * same merges rather than flattening them away. A covered cell (inside a
 * span, not the span's own top-left) gets the SAME text as the cell that
 * covers it — matches how a merge already looks to every value-only reader
 * in this codebase (cellRawValue et al. treat every covered cell as holding
 * the anchor's value) — so a caller that ignores `.merges` entirely (the
 * plain-values paste path) still sees a sane, fully-populated grid instead
 * of blanks at every covered position.
 *
 * Walks the already-parsed (inert) DOM directly rather than round-tripping
 * through innerHTML — `<br>` becomes a literal newline (matching
 * parseMarkdownPipeTable's own handling), any other element (bold, links,
 * inline code) is flattened to its own text content the same way plain
 * single-cell paste already discards formatting.
 */
export function parseHtmlTableWithMerges(html: string): PastedRange | null {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const table = doc.querySelector('table');
	if (!table) return null;
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

	const trs = Array.from(table.querySelectorAll('tr'));
	if (trs.length === 0) return null;

	const values: string[][] = [];
	const merges: { r1: number; c1: number; r2: number; c2: number }[] = [];
	// Columns in a given row already claimed by an earlier row's rowspan
	// reaching down into it — the same "occupied" idea buildOccupied uses for
	// the live model's own merges, just over the freshly-parsed source grid.
	const occupied = new Map<number, Set<number>>();
	const isOccupied = (r: number, c: number) => occupied.get(r)?.has(c) ?? false;
	const markOccupied = (r: number, c: number) => {
		if (!occupied.has(r)) occupied.set(r, new Set());
		occupied.get(r)!.add(c);
	};

	trs.forEach((tr, r) => {
		let c = 0;
		for (const cell of Array.from(tr.querySelectorAll(':scope > td, :scope > th'))) {
			while (isOccupied(r, c)) c++;
			const text = cellText(cell);
			const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') ?? '1') || 1);
			const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') ?? '1') || 1);
			for (let dr = 0; dr < rowspan; dr++) {
				for (let dc = 0; dc < colspan; dc++) {
					const rr = r + dr, cc = c + dc;
					(values[rr] ??= [])[cc] = text;
					if (dr > 0 || dc > 0) markOccupied(rr, cc);
				}
			}
			if (rowspan > 1 || colspan > 1) merges.push({ r1: r, c1: c, r2: r + rowspan - 1, c2: c + colspan - 1 });
			c += colspan;
		}
	});
	return values.length > 0 ? { values, merges } : null;
}
