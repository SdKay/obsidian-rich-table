/**
 * xlsxExport.ts unit tests — the write-side mirror of xlsxSource.test.ts's
 * read-side coverage: build a TableModelV2/WorkbookV3 in memory, export it,
 * then read the resulting bytes back with @office-kit/xlsx's OWN reader
 * (not readXlsxAsModel — this deliberately checks the raw xlsx object model,
 * so a bug shared between xlsxExport.ts and xlsxSource.ts couldn't mask
 * itself by having both sides agree on the wrong thing).
 */
import { describe, it, expect } from 'vitest';
import { loadWorkbook, fromArrayBuffer } from '@office-kit/xlsx/io';
import { getCell, getMergedCells, getColumnDimension, getRowDimension } from '@office-kit/xlsx/worksheet';
import { getCellFont, getCellFill } from '@office-kit/xlsx/styles';
import { exportModelToXlsx, exportWorkbookToXlsx } from '../src/xlsxExport';
import type { TableModelV2, WorkbookV3 } from '../src/model';

function sampleModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_1', name: 'Task', width: 152 },
			{ id: 'c_2', name: 'Status' },
		],
		rows: [
			{ id: 'r_1', cells: { c_1: 'Design', c_2: 'Done' }, height: 40 },
			{ id: 'r_2', cells: { c_1: 'Code', c_2: 'Done' } },
		],
		merges: [{ anchor: 'r_1.c_2', end: 'r_2.c_2' }],
		styles: [
			{ target: 'header.c_1', bold: true, bg: '#4472c4', color: '#ffffff' },
			{ target: 'r_1.c_1', bg: '#c6efce', italic: true, size: 16 },
		],
	};
}

describe('exportModelToXlsx', () => {
	it('writes the header row and data rows at the expected coordinates', async () => {
		const bytes = await exportModelToXlsx(sampleModel(), 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		expect(entry?.kind).toBe('worksheet');
		if (entry?.kind !== 'worksheet') return;
		const ws = entry.sheet;
		expect(ws.title).toBe('Plan');

		expect(getCell(ws, 1, 1)?.value).toBe('Task');
		expect(getCell(ws, 1, 2)?.value).toBe('Status');
		expect(getCell(ws, 2, 1)?.value).toBe('Design');
		expect(getCell(ws, 3, 1)?.value).toBe('Code');
	});

	it('round-trips a merge to the correct 1-based xlsx range', async () => {
		const bytes = await exportModelToXlsx(sampleModel(), 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		expect(getMergedCells(entry.sheet)).toContainEqual({ minRow: 2, minCol: 2, maxRow: 3, maxCol: 2 });
	});

	it('maps a header-anchored merge target ("header.cX") to xlsx row 1', async () => {
		const model = sampleModel();
		model.merges = [{ anchor: 'header.c_1', end: 'r_1.c_1' }];
		const bytes = await exportModelToXlsx(model, 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		expect(getMergedCells(entry.sheet)).toContainEqual({ minRow: 1, minCol: 1, maxRow: 2, maxCol: 1 });
	});

	it('resolves a header StyleRuleV2 into real font/fill on the header cell', async () => {
		const bytes = await exportModelToXlsx(sampleModel(), 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		const a1 = getCell(entry.sheet, 1, 1);
		expect(a1).toBeDefined();
		if (!a1) return;
		const font = getCellFont(wb, a1);
		expect(font.bold).toBe(true);
		expect(font.color?.rgb?.toLowerCase()).toBe('00ffffff');
		const fill = getCellFill(wb, a1);
		expect(fill.kind).toBe('pattern');
		if (fill.kind === 'pattern') expect(fill.fgColor?.rgb?.toLowerCase()).toBe('004472c4');
	});

	it('resolves a data-cell StyleRuleV2 into font size/italic/background', async () => {
		const bytes = await exportModelToXlsx(sampleModel(), 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		const a2 = getCell(entry.sheet, 2, 1);
		expect(a2).toBeDefined();
		if (!a2) return;
		const font = getCellFont(wb, a2);
		expect(font.italic).toBe(true);
		// px -> pt inverse of xlsxSource.ts's pt -> px (*96/72): 16 * 72/96 = 12
		expect(font.size).toBe(12);
		const fill = getCellFill(wb, a2);
		expect(fill.kind).toBe('pattern');
		if (fill.kind === 'pattern') expect(fill.fgColor?.rgb?.toLowerCase()).toBe('00c6efce');
	});

	it('estimates a width for a column with no explicit ColumnDefV2.width, from its own longest line', async () => {
		const model: TableModelV2 = {
			version: 2,
			columns: [{ id: 'c_1', name: 'Name' }],
			rows: [
				{ id: 'r_1', cells: { c_1: 'short' } },
				{ id: 'r_2', cells: { c_1: 'a much longer piece of text than the others' } },
			],
			merges: [], styles: [],
		};
		const bytes = await exportModelToXlsx(model, 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		// "a much longer piece of text than the others" is 43 chars + 2 padding = 45
		expect(getColumnDimension(entry.sheet, 1)?.width).toBe(45);
	});

	it('does not let an estimated column width shrink below the floor for short/empty content', async () => {
		const model: TableModelV2 = {
			version: 2,
			columns: [{ id: 'c_1', name: 'X' }],
			rows: [{ id: 'r_1', cells: { c_1: '' } }],
			merges: [], styles: [],
		};
		const bytes = await exportModelToXlsx(model, 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		expect(getColumnDimension(entry.sheet, 1)?.width).toBe(8); // MIN_ESTIMATED_COLUMN_WIDTH
	});

	it('caps an estimated column width so one outlier cell does not blow out the sheet', async () => {
		const model: TableModelV2 = {
			version: 2,
			columns: [{ id: 'c_1', name: 'X' }],
			rows: [{ id: 'r_1', cells: { c_1: 'x'.repeat(500) } }],
			merges: [], styles: [],
		};
		const bytes = await exportModelToXlsx(model, 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		expect(getColumnDimension(entry.sheet, 1)?.width).toBe(80); // MAX_ESTIMATED_COLUMN_WIDTH
	});

	it('sizes an estimated column width by CJK content at double the width of ASCII, same as displayLen', async () => {
		const modelAscii: TableModelV2 = {
			version: 2, columns: [{ id: 'c_1', name: 'X' }],
			rows: [{ id: 'r_1', cells: { c_1: 'aaaaaaaaaa' } }], // 10 ascii chars
			merges: [], styles: [],
		};
		const modelCjk: TableModelV2 = {
			version: 2, columns: [{ id: 'c_1', name: 'X' }],
			rows: [{ id: 'r_1', cells: { c_1: '设计设计设计' } }], // 6 CJK chars = 12 display units
			merges: [], styles: [],
		};
		const [asciiBytes, cjkBytes] = await Promise.all([
			exportModelToXlsx(modelAscii, 'Plan'),
			exportModelToXlsx(modelCjk, 'Plan'),
		]);
		const asciiWb = await loadWorkbook(fromArrayBuffer(asciiBytes));
		const cjkWb = await loadWorkbook(fromArrayBuffer(cjkBytes));
		const asciiSheet = asciiWb.sheets[0];
		const cjkSheet = cjkWb.sheets[0];
		if (asciiSheet?.kind !== 'worksheet' || cjkSheet?.kind !== 'worksheet') throw new Error('expected worksheets');
		expect(getColumnDimension(cjkSheet.sheet, 1)?.width).toBe((getColumnDimension(asciiSheet.sheet, 1)?.width ?? 0) + 2);
	});

	it('estimates a taller row height for multi-line cell content, and leaves a single-line row\'s height unset', async () => {
		const model: TableModelV2 = {
			version: 2,
			columns: [{ id: 'c_1', name: 'X' }],
			rows: [
				{ id: 'r_1', cells: { c_1: 'line1\nline2\nline3' } },
				{ id: 'r_2', cells: { c_1: 'single line' } },
			],
			merges: [], styles: [],
		};
		const bytes = await exportModelToXlsx(model, 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		expect(getRowDimension(entry.sheet, 2)?.height).toBe(45); // 3 lines * 15pt
		expect(getRowDimension(entry.sheet, 3)?.height).toBeUndefined();
	});

	it('converts a column width from px back to xlsx character units', async () => {
		const bytes = await exportModelToXlsx(sampleModel(), 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		// px -> char units inverse of xlsxSource.ts's char*7+5: (152-5)/7 = 21
		expect(getColumnDimension(entry.sheet, 1)?.width).toBeCloseTo(21, 5);
	});

	it('converts a row height from px back to xlsx points', async () => {
		const bytes = await exportModelToXlsx(sampleModel(), 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		// px -> pt inverse of xlsxSource.ts's pt*96/72: 40 * 72/96 = 30
		expect(getRowDimension(entry.sheet, 2)?.height).toBeCloseTo(30, 5);
	});

	it('leaves a genuinely empty cell unmaterialized rather than writing an empty string', async () => {
		const model = sampleModel();
		model.rows[0]!.cells.c_2 = '';
		const bytes = await exportModelToXlsx(model, 'Plan');
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const entry = wb.sheets[0];
		if (entry?.kind !== 'worksheet') throw new Error('expected worksheet');
		expect(getCell(entry.sheet, 2, 2)).toBeUndefined();
	});
});

describe('exportWorkbookToXlsx', () => {
	function sampleWorkbook(): WorkbookV3 {
		return {
			version: 3,
			sheets: [
				{ id: 's1', version: 2, name: 'Plan', columns: [{ id: 'c_1', name: 'A' }], rows: [{ id: 'r_1', cells: { c_1: 'x' } }], merges: [], styles: [] },
				{ id: 's2', version: 2, columns: [{ id: 'c_1', name: 'B' }], rows: [{ id: 'r_1', cells: { c_1: 'y' } }], merges: [], styles: [] },
			],
		};
	}

	it('exports one xlsx worksheet per sheet, in order', async () => {
		const bytes = await exportWorkbookToXlsx(sampleWorkbook());
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const titles = wb.sheets.map(s => (s.kind === 'worksheet' ? s.sheet.title : null));
		expect(titles).toEqual(['Plan', 'Sheet 2']);
	});

	it('falls back to a positional "Sheet N" title, matching the on-screen tab-bar fallback, when a sheet has no explicit name', async () => {
		const wb3 = sampleWorkbook();
		wb3.sheets[1]!.name = undefined;
		const bytes = await exportWorkbookToXlsx(wb3);
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const second = wb.sheets[1];
		expect(second?.kind === 'worksheet' && second.sheet.title).toBe('Sheet 2');
	});

	it('disambiguates two sheets sharing the same name, the way Excel\'s own duplicate-sheet naming does', async () => {
		const wb3 = sampleWorkbook();
		wb3.sheets[1]!.name = 'Plan';
		const bytes = await exportWorkbookToXlsx(wb3);
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const titles = wb.sheets.map(s => (s.kind === 'worksheet' ? s.sheet.title : null));
		expect(titles).toEqual(['Plan', 'Plan (2)']);
	});

	it('preserves each sheet\'s own content independently', async () => {
		const bytes = await exportWorkbookToXlsx(sampleWorkbook());
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		const [first, second] = wb.sheets;
		if (first?.kind !== 'worksheet' || second?.kind !== 'worksheet') throw new Error('expected worksheets');
		expect(getCell(first.sheet, 2, 1)?.value).toBe('x');
		expect(getCell(second.sheet, 2, 1)?.value).toBe('y');
	});
});
