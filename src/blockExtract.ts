import { parseSource } from './parser';
import { getTableVersion, CURRENT_TABLE_VERSION, MIN_STABLE_VERSION } from './tableVersion';
import { columnLetterFromIndex, formatSheetQualifiedRef } from '@office-kit/xlsx/utils';
import type { TableModelV2 } from './model';
import type { ExtractedLine, ExtractResult } from './richSearchApi';

/**
 * The text of a rich-table block as a reader sees it: cell text, column names, title, footer and sheet
 * names. Ids, styles, widths and every other field are structure and are left out. Pure: no Obsidian,
 * no I/O. The YAML adapter must be installed, as for any parse.
 */

/** Stable ids, so the anchor survives sorting and hiding. Opaque to Rich Search. `sheetId` is set only for a workbook. */
export type BlockAnchor =
	| { kind: 'title'; sheetId?: string }
	| { kind: 'footer'; sheetId?: string; line: number }
	| { kind: 'sheet'; sheetId: string }
	| { kind: 'header'; sheetId?: string; colId: string }
	| { kind: 'cell'; sheetId?: string; rowId: string; colId: string };

export function isBlockAnchor(value: unknown): value is BlockAnchor {
	if (typeof value !== 'object' || value === null) return false;
	const a = value as Record<string, unknown>;
	const sheetOk = a.sheetId === undefined || typeof a.sheetId === 'string';
	switch (a.kind) {
		case 'title': return sheetOk;
		case 'footer': return sheetOk && Number.isInteger(a.line) && (a.line as number) >= 0;
		case 'sheet': return typeof a.sheetId === 'string';
		case 'header': return sheetOk && typeof a.colId === 'string';
		case 'cell': return sheetOk && typeof a.rowId === 'string' && typeof a.colId === 'string';
		default: return false;
	}
}

/** Bump whenever extractBlock would return different output for the same source. Part of Rich Search's cache key. */
export const BLOCK_EXTRACT_VERSION = 1;

export const BLOCK_LANGUAGES = ['rich-table'];

const fail = (error: string): ExtractResult => ({ ok: false, error });

function footerLines(model: TableModelV2): string[] {
	if (!model.footer) return [];
	const raw = Array.isArray(model.footer) ? model.footer : [model.footer];
	return raw.flatMap(l => l.split('\n')).filter(l => l !== '');
}

/**
 * One table or one sheet of a workbook, in reading order: title, column names, rows, footer.
 * A cell's `location` is its spreadsheet coordinate (header row 1, as in an .xlsx), with the sheet
 * name in front for a workbook, so it reads the same in every interface language.
 */
function pushTable(out: ExtractedLine[], model: TableModelV2, sheet: { id: string; name: string } | undefined): void {
	const at = <T extends BlockAnchor>(a: T): T => (sheet === undefined ? a : { ...a, sheetId: sheet.id });
	const ref = (col: number, row: number): string => {
		const a1 = `${columnLetterFromIndex(col + 1)}${row}`;
		return sheet ? formatSheetQualifiedRef(sheet.name, a1) : a1;
	};
	const label = (word: string): string => (sheet ? `${sheet.name} · ${word}` : word);
	if (model.title) out.push({ text: model.title, location: label('title'), anchor: at({ kind: 'title' }) });
	model.columns.forEach((col, c) => {
		if (col.name === '') return;
		out.push({ text: col.name, location: ref(c, 1), anchor: at({ kind: 'header', colId: col.id }) });
	});
	model.rows.forEach((row, r) => {
		model.columns.forEach((col, c) => {
			const text = row.cells[col.id] ?? '';
			if (text === '') return;
			out.push({ text, location: ref(c, r + 2), anchor: at({ kind: 'cell', rowId: row.id, colId: col.id }) });
		});
	});
	footerLines(model).forEach((text, line) => out.push({ text, location: label('footer'), anchor: at({ kind: 'footer', line }) }));
}

/** Reads one block's source. Never throws. */
export function extractBlock(source: string): ExtractResult {
	if (source.trim() === '') return { ok: true, value: [] };
	try {
		const version = getTableVersion(source);
		if (version > CURRENT_TABLE_VERSION) return fail(`The table was written by a newer Rich Table (format ${version}) and cannot be read`);
		// A v1 table renders as a read-only upgrade preview; it is not read here, so its source is searched instead.
		if (version < MIN_STABLE_VERSION) return fail('The table uses the old format (v1) and is not read; upgrade it to search its cells');
		const doc = parseSource(source);

		const out: ExtractedLine[] = [];
		if (doc.version === 3) {
			doc.sheets.forEach((sheet, i) => {
				const name = sheet.name || `Sheet${i + 1}`;
				if (sheet.name) out.push({ text: sheet.name, location: 'sheet', anchor: { kind: 'sheet', sheetId: sheet.id } });
				pushTable(out, sheet, { id: sheet.id, name });
			});
			return { ok: true, value: out };
		}
		// The rows of a block that points at a file are read from that file, which is searched on its own.
		if (doc.xlsxSource) return { ok: true, value: [] };
		pushTable(out, doc, undefined);
		return { ok: true, value: out };
	} catch (err) {
		return fail(`The table could not be read: ${err instanceof Error ? (err.message.split('\n')[0] ?? 'unknown error') : 'unknown error'}`);
	}
}
