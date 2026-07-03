import { stringifyYaml } from 'obsidian';
import type { MergeRange, TableModel } from './model';
import { colIndexToLetter } from './utils';

export function serializeTable(model: TableModel): string {
	const needsHeader =
		!!model.title ||
		!!model.footer ||
		model.columns.some(c => !!(c.type || c.width || c.align || c.hidden)) ||
		(model.hiddenRows?.length ?? 0) > 0 ||
		(model.rowHeights?.length ?? 0) > 0 ||
		model.merges.length > 0 ||
		model.styles.length > 0;

	const parts: string[] = [];

	if (needsHeader) {
		parts.push('---');
		parts.push(buildYamlBlock(model).trimEnd());
		parts.push('---');
	}

	parts.push(buildGrid(model));
	return parts.join('\n');
}

function buildYamlBlock(model: TableModel): string {
	const obj: Record<string, unknown> = {};

	if (model.title)  obj.title  = model.title;

	obj.columns = model.columns.map(c => {
		const entry: Record<string, unknown> = { name: c.name };
		if (c.hidden) entry.hidden = true;
		if (c.type)   entry.type   = c.type;
		if (c.width)  entry.width  = c.width;
		if (c.align)  entry.align  = c.align;
		return entry;
	});

	if ((model.hiddenRows?.length ?? 0) > 0) {
		obj.hiddenRows = model.hiddenRows;
	}

	if ((model.rowHeights?.length ?? 0) > 0) {
		obj.rowHeights = model.rowHeights;
	}

	if (model.merges.length > 0) {
		obj.merges = model.merges.map(mergeToStr);
	}

	if (model.styles.length > 0) {
		obj.styles = model.styles.map(s => {
			const e: Record<string, unknown> = { target: s.target };
			if (s.bg) e.bg = s.bg;
			if (s.color) e.color = s.color;
			if (s.bold) e.bold = true;
			if (s.italic) e.italic = true;
			if (s.size) e.size = s.size;
			return e;
		});
	}

	if (model.footer) obj.footer = model.footer;

	return stringifyYaml(obj);
}

function buildGrid(model: TableModel): string {
	const numCols = model.columns.length;
	if (numCols === 0) return '';

	const pad = (row: string[]) =>
		row.slice(0, numCols).concat(
			Array(Math.max(0, numCols - row.length)).fill('') as string[],
		);

	const paddedRows = model.rows.map(pad);

	const widths = Array<number>(numCols).fill(3);
	for (const row of paddedRows) {
		for (let c = 0; c < numCols; c++) {
			widths[c] = Math.max(widths[c] ?? 3, (row[c] ?? '').length);
		}
	}

	// Escape | inside cells so the grid parser doesn't confuse them with column separators
	const escape = (cell: string) => cell.replace(/\|/g, '\\|');
	const fmt = (cells: string[]) =>
		'| ' + cells.map((cell, i) => escape(cell ?? '').padEnd(widths[i] ?? 3)).join(' | ') + ' |';

	const sep = '| ' + widths.map(w => '-'.repeat(w ?? 3)).join(' | ') + ' |';

	return [
		fmt(paddedRows[0] ?? []),
		sep,
		...paddedRows.slice(1).map(fmt),
	].join('\n');
}

function mergeToStr(m: MergeRange): string {
	const start = colIndexToLetter(m.startCol) + (m.startRow + 1);
	const end = colIndexToLetter(m.endCol) + (m.endRow + 1);
	return `${start}:${end}`;
}
