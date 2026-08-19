/**
 * "Convert to rich-table" — the editor-menu counterpart to pasting a
 * Markdown table onto a header cell (see renderCell.ts's onPasteGridHeader):
 * turns a plain GFM/Markdown pipe table already sitting in the note into a
 * rich-table block in place, instead of requiring the user to first insert an
 * empty block and then paste into it.
 */
import type { TableModelV2 } from './model';
import { genId } from './idGen';
import { parseMarkdownPipeTable } from './renderClipboard';
import { serializeTable } from './serializer';

/** True when `line` sits inside a fenced code block (```` ``` ```` or `~~~`),
 *  counting fence open/close toggles from the top of the document. Guards
 *  against offering to convert a table found inside ANY code fence — most
 *  importantly a leftover pipe-table mirror inside an existing rich-table
 *  block from before it was removed (see "Backward compatibility" in
 *  CLAUDE.md) — where replacing it would nest a fence inside a fence. */
function isInsideFence(lines: string[], line: number): boolean {
	let inFence = false;
	for (let i = 0; i < line; i++) {
		if (/^\s*(```|~~~)/.test(lines[i] ?? '')) inFence = !inFence;
	}
	return inFence;
}

/**
 * Finds the Markdown table (if any) containing `cursorLine`, by expanding
 * outward while adjacent lines still contain a `|` — the same cheap
 * heuristic `parseMarkdownPipeTable` itself uses for its header/delimiter
 * lines — then validating the whole candidate range through
 * `parseMarkdownPipeTable` itself rather than re-deriving the GFM
 * delimiter-row rule here. Returns null when the cursor isn't on a table row,
 * the candidate range isn't actually a valid table, or it's inside a fence.
 */
export function findMarkdownTableAtCursor(
	lines: string[],
	cursorLine: number,
): { startLine: number; endLine: number; values: string[][] } | null {
	if (isInsideFence(lines, cursorLine)) return null;
	if (!(lines[cursorLine] ?? '').includes('|')) return null;

	let startLine = cursorLine;
	while (startLine > 0 && (lines[startLine - 1] ?? '').includes('|')) startLine--;
	let endLine = cursorLine;
	while (endLine < lines.length - 1 && (lines[endLine + 1] ?? '').includes('|')) endLine++;

	const values = parseMarkdownPipeTable(lines.slice(startLine, endLine + 1).join('\n'));
	if (!values) return null;
	return { startLine, endLine, values };
}

/** Builds a fresh v2 model from a parsed grid — the topmost row becomes
 *  column names, every row below becomes data. Same shape as `buildBlankTable`
 *  (blankTable.ts), just with cell content filled in from `values` instead of
 *  left empty. A data row shorter than the header fills the missing cells
 *  with '' (`row[i] ?? ''`); a data row longer than the header drops the
 *  extra cells — the header's width is what defines the table's column count. */
export function buildTableFromGrid(values: string[][]): TableModelV2 {
	const colIds = new Set<string>();
	const rowIds = new Set<string>();
	const header = values[0] ?? [];
	const columns = header.map(name => ({ id: genId('c', colIds), name }));
	const rows = values.slice(1).map(row => {
		const cells: Record<string, string> = {};
		columns.forEach((col, i) => { cells[col.id] = row[i] ?? ''; });
		return { id: genId('r', rowIds), cells };
	});
	return { version: 2, columns, rows, merges: [], styles: [] };
}

export interface MarkdownTableConversionPlan {
	startLine: number;
	endLine: number;
	blockText: string;
}

/** Single entry point for main.ts: null when there's nothing convertible at
 *  the cursor, otherwise the exact line range to replace and the replacement
 *  text (fenced block, ready to splice in with Editor.replaceRange). */
export function planMarkdownTableConversion(
	lines: string[],
	cursorLine: number,
): MarkdownTableConversionPlan | null {
	const found = findMarkdownTableAtCursor(lines, cursorLine);
	if (!found) return null;
	const model = buildTableFromGrid(found.values);
	const blockText = ['```rich-table', serializeTable(model).trimEnd(), '```'].join('\n');
	return { startLine: found.startLine, endLine: found.endLine, blockText };
}
