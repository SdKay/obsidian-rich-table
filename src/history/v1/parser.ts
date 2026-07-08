import { parseYaml } from 'obsidian';
import type { ColumnDef, MergeRange, StyleRule, TableModel } from '../../model';
import { parseCellCoord } from '../../utils';

export function parseTable(source: string): TableModel {
	const lines = source.split('\n');
	const [yamlStr, gridLines] = splitFrontmatter(lines);

	const yaml = yamlStr !== null ? (parseYaml(yamlStr) as Record<string, unknown>) : null;
	const yamlCols = extractYamlColumns(yaml);
	const { headerCells, dataRows } = parseGrid(gridLines);

	const columns = resolveColumns(yamlCols, headerCells);
	// rows[0] = header (column names), rows[1..n] = data
	const headerRow = columns.map(c => c.name);
	const rows = [headerRow, ...dataRows];

	const merges     = extractMerges(yaml?.merges);
	const styles     = extractStyles(yaml?.styles);
	const hiddenRows = extractHiddenRows(yaml?.hiddenRows);
	const rowHeights = extractRowHeights(yaml?.rowHeights);
	const title      = typeof yaml?.title  === 'string' ? yaml.title  : undefined;
	const footer     = extractFooter(yaml?.footer);
	const filter     = extractFilter(yaml?.filter);
	const locked     = yaml?.locked === true ? true : undefined;

	return { title, columns, rows, merges, styles, hiddenRows, rowHeights, footer, filter, locked };
}

function splitFrontmatter(lines: string[]): [string | null, string[]] {
	if (lines[0]?.trim() !== '---') return [null, lines];

	const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
	if (closeIdx === -1) return [null, lines];

	return [lines.slice(1, closeIdx).join('\n'), lines.slice(closeIdx + 1)];
}

function extractYamlColumns(yaml: Record<string, unknown> | null): Partial<ColumnDef>[] {
	if (!yaml || !Array.isArray(yaml.columns)) return [];
	return (yaml.columns as unknown[]).map(col => {
		if (typeof col !== 'object' || col === null) return {};
		const c = col as Record<string, unknown>;
		const result: Partial<ColumnDef> = {};
		if (typeof c.name === 'string') result.name = c.name;
		if (c.hidden === true) result.hidden = true;
		if (typeof c.type === 'string') result.type = c.type;
		if (typeof c.width === 'number') result.width = c.width;
		if (c.align === 'left' || c.align === 'center' || c.align === 'right') result.align = c.align;
		return result;
	});
}

function parseGrid(lines: string[]): { headerCells: string[]; dataRows: string[][] } {
	const tableLines = lines
		.map(l => l.trim())
		.filter(l => l.startsWith('|') && l.endsWith('|'));

	if (tableLines.length === 0) return { headerCells: [], dataRows: [] };

	// Split on | but not \| (escaped pipe inside cell values)
	const parseRow = (line: string): string[] => {
		const cells: string[] = [];
		let current = '';
		const inner = line.slice(1, -1); // strip outer | … |
		for (let i = 0; i < inner.length; i++) {
			if (inner[i] === '\\' && inner[i + 1] === '|') {
				current += '|'; // unescape \| → |
				i++;
			} else if (inner[i] === '|') {
				cells.push(current.trim());
				current = '';
			} else {
				current += inner[i];
			}
		}
		cells.push(current.trim());
		return cells;
	};

	const isSeparator = (cells: string[]) => cells.every(c => /^[-: ]+$/.test(c));

	const [headerLine, ...rest] = tableLines;
	if (!headerLine) return { headerCells: [], dataRows: [] };
	const headerCells = parseRow(headerLine);
	const dataRows = rest
		.map(parseRow)
		.filter(cells => !isSeparator(cells));

	return { headerCells, dataRows };
}

function resolveColumns(
	yamlCols: Partial<ColumnDef>[],
	gridHeader: string[],
): ColumnDef[] {
	const count = Math.max(yamlCols.length, gridHeader.length);
	return Array.from({ length: count }, (_, i) => {
		const y = yamlCols[i] ?? {};
		const fallback = gridHeader[i] ?? `Column ${i + 1}`;
		return {
			name:   y.name   ?? fallback,
			hidden: y.hidden,
			type:   y.type,
			width:  y.width,
			align:  y.align,
		};
	});
}

function extractMerges(raw: unknown): MergeRange[] {
	if (!Array.isArray(raw)) return [];
	return (raw as unknown[])
		.filter((s): s is string => typeof s === 'string')
		.flatMap(s => {
			const idx = s.indexOf(':');
			if (idx === -1) return [];
			const start = parseCellCoord(s.slice(0, idx));
			const end = parseCellCoord(s.slice(idx + 1));
			if (!start || !end) return [];
			return [{
				startRow: Math.min(start.row, end.row),
				startCol: Math.min(start.col, end.col),
				endRow:   Math.max(start.row, end.row),
				endCol:   Math.max(start.col, end.col),
			}];
		});
}

function extractHiddenRows(raw: unknown): number[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0);
}

function extractRowHeights(raw: unknown): number[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const nums = (raw as unknown[]).map(n => (typeof n === 'number' && n > 0 ? n : 0));
	const trimmed = [...nums];
	while (trimmed.length > 0 && trimmed[trimmed.length - 1] === 0) trimmed.pop();
	return trimmed.length > 0 ? trimmed : undefined;
}

function extractFooter(raw: unknown): string | string[] | undefined {
	if (typeof raw === 'string') return raw;
	if (Array.isArray(raw) && raw.every(x => typeof x === 'string')) return raw;
	return undefined;
}

function extractFilter(raw: unknown): Record<string, string[]> | undefined {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
	const result: Record<string, string[]> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof k === 'string' && /^[A-Z]+$/.test(k) && Array.isArray(v)) {
			const vals = (v as unknown[]).filter((x): x is string => typeof x === 'string');
			if (vals.length > 0) result[k] = vals;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function extractStyles(raw: unknown): StyleRule[] {
	if (!Array.isArray(raw)) return [];
	return (raw as unknown[])
		.filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
		.map(s => {
			const rule: StyleRule = { target: typeof s.target === 'string' ? s.target : '' };
			if (typeof s.bg === 'string') rule.bg = s.bg;
			if (typeof s.color === 'string') rule.color = s.color;
			if (s.bold === true) rule.bold = true;
			if (s.italic === true) rule.italic = true;
			if (typeof s.size === 'number' && s.size > 0) rule.size = s.size;
			return rule;
		})
		.filter(r => r.target !== '');
}
