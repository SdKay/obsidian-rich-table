/**
 * xlsxSource.ts unit tests. Fixtures are built via @office-kit/xlsx's own
 * writer, in memory — legitimate here specifically because these tests are
 * about "does OUR conversion code correctly transform whatever shape the
 * library hands us", not "does the library correctly parse real xlsx bytes
 * from other tools" (that question was answered separately, against an
 * independently-generated file, before this module was written at all — see
 * the feature's own design notes for why openpyxl-authored numeric XML
 * entities exposed a real decode gap in the library that mainstream Excel/
 * WPS/Sheets exports don't trigger, since they write raw UTF-8 instead).
 */
import { describe, it, expect } from 'vitest';
import { createWorkbook, addWorksheet, workbookToBytes } from '@office-kit/xlsx/workbook';
import { setCell, mergeCells, freezePanes } from '@office-kit/xlsx/worksheet';
import { setBold, setFontColor, setCellBackgroundColor } from '@office-kit/xlsx/styles';
import { saveWorkbook, toArrayBuffer } from '@office-kit/xlsx/io';
import { readXlsxAsModel, decodeXmlNumericEntities, colWidthToPx } from '../src/xlsxSource';
import type { TableModelV2, WorkbookV3 } from '../src/model';

async function buildSampleBytes(sheetNames: string[]): Promise<ArrayBuffer> {
	const wb = createWorkbook();
	for (const name of sheetNames) {
		const ws = addWorksheet(wb, name);
		setCell(ws, 1, 1, '任务');
		setCell(ws, 1, 2, '状态');
		const a1 = setCell(ws, 1, 1, '任务'); // re-fetch the Cell for styling
		setBold(wb, a1, true);
		setFontColor(wb, a1, 'FFFFFF');
		setCellBackgroundColor(wb, a1, '4472C4');

		setCell(ws, 2, 1, '设计架构');
		const b2 = setCell(ws, 2, 2, '完成');
		setCellBackgroundColor(wb, b2, 'C6EFCE');

		setCell(ws, 3, 1, '编码实现');
		setCell(ws, 3, 2, '进行中');

		mergeCells(ws, 'C2:C3');
		setCell(ws, 2, 3, '合并备注');
		mergeCells(ws, 'D1:D2'); // spans the header row itself — see the dedicated test below
		setCell(ws, 1, 4, '备注');
		freezePanes(ws, 1, 1); // 1 frozen row + 1 frozen column
	}
	const sink = toArrayBuffer();
	await saveWorkbook(wb, sink);
	return sink.result();
}

function asSingle(model: TableModelV2 | WorkbookV3): TableModelV2 {
	expect('sheets' in model).toBe(false);
	return model as TableModelV2;
}

describe('readXlsxAsModel — single sheet', () => {
	it('turns row 1 into column names and rows 2+ into data rows', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.columns.map(c => c.name)).toEqual(['任务', '状态', '', '备注']);
		expect(model.rows).toHaveLength(2);
		const [taskCol, statusCol] = model.columns;
		expect(model.rows[0]!.cells[taskCol!.id]).toBe('设计架构');
		expect(model.rows[0]!.cells[statusCol!.id]).toBe('完成');
		expect(model.rows[1]!.cells[taskCol!.id]).toBe('编码实现');
	});

	it('resolves bold/color/background into a StyleRuleV2 targeting the header cell', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		const headerRule = model.styles.find(s => s.target === 'header.c_1');
		expect(headerRule).toMatchObject({ bold: true, color: '#ffffff', bg: '#4472c4' });
	});

	it('resolves a data cell background color', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		const rule = model.styles.find(s => s.target === 'r_2.c_2');
		expect(rule).toMatchObject({ bg: '#c6efce' });
	});

	it('does not emit a style rule for a cell with no distinguishing style', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.styles.find(s => s.target === 'r_3.c_1')).toBeUndefined();
	});

	it('converts a data-only merge (C2:C3) into a plain row-ID-anchored MergeRangeV2', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.merges).toContainEqual({ anchor: 'r_2.c_3', end: 'r_3.c_3' });
	});

	it('converts a merge that spans the header row itself (D1:D2) using the "header" sentinel, not r_1', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.merges).toContainEqual({ anchor: 'header.c_4', end: 'r_2.c_4' });
		expect(model.merges.some(m => m.anchor.startsWith('r_1.'))).toBe(false);
	});

	it('maps a frozen 1 row + 1 col pane to freezeRows=0 (header only) and freezeCols=1', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const model = asSingle(await readXlsxAsModel(bytes));
		expect(model.freezeRows).toBe(0);
		expect(model.freezeCols).toBe(1);
	});

	it('round-trips through renderTable-shaped data without throwing on an empty sheet', async () => {
		const wb = createWorkbook();
		addWorksheet(wb, '空表');
		const sink = toArrayBuffer();
		await saveWorkbook(wb, sink);
		const model = asSingle(await readXlsxAsModel(sink.result()));
		expect(model.columns).toEqual([]);
		expect(model.rows).toEqual([]);
	});

	// A real xlsx commonly carries a "default width" ColumnDimension entry
	// spanning the whole 1..16384 column range (Excel/LibreOffice/WPS's own
	// "everything not explicitly overridden uses this width" record) ALONGSIDE
	// specific single-column overrides. Reported: a narrow-content column
	// rendered wide and a wide-content column rendered narrow — i.e. widths
	// swapped relative to what Excel itself shows.
	it('prefers a column-specific width over a wide default-width range that also covers it, regardless of Map insertion order', async () => {
		const wb = createWorkbook();
		const ws = addWorksheet(wb, 'Sheet1');
		setCell(ws, 1, 1, 'A-narrow'); setCell(ws, 1, 2, 'B-wide');
		setCell(ws, 1, 3, 'C-narrow'); setCell(ws, 1, 4, 'D-wide');
		// Default-width range registered FIRST — the real-world ordering that
		// exposed the bug: Array.prototype.find() (the old lookup) returns
		// whichever covering entry comes first in insertion order, not the
		// most specific one.
		ws.columnDimensions.set(1, { min: 1, max: 16384, width: 8.43 });
		ws.columnDimensions.set(2, { min: 2, max: 2, width: 45 });
		ws.columnDimensions.set(4, { min: 4, max: 4, width: 45 });

		const sink = toArrayBuffer();
		await saveWorkbook(wb, sink);
		const model = asSingle(await readXlsxAsModel(sink.result()));

		const narrowPx = colWidthToPx(8.43);
		const widePx = colWidthToPx(45);
		expect(model.columns[0]!.width).toBe(narrowPx); // A: only the default range covers it
		expect(model.columns[1]!.width).toBe(widePx);   // B: specific 45-wide override must win
		expect(model.columns[2]!.width).toBe(narrowPx); // C: only the default range covers it
		expect(model.columns[3]!.width).toBe(widePx);   // D: specific 45-wide override must win
	});

	// The same wide "default width" range (min:1, max:16384) also fed directly
	// into usedBounds' maxCol computation, so ANY sheet carrying one — extremely
	// common — rendered 16384 columns instead of however many actually have
	// content, which is both wrong and a real performance/rendering hazard.
	it('does not let a wide default-width range inflate the column count', async () => {
		const wb = createWorkbook();
		const ws = addWorksheet(wb, 'Sheet1');
		setCell(ws, 1, 1, 'A'); setCell(ws, 1, 2, 'B');
		ws.columnDimensions.set(1, { min: 1, max: 16384, width: 8.43 });

		const sink = toArrayBuffer();
		await saveWorkbook(wb, sink);
		const model = asSingle(await readXlsxAsModel(sink.result()));
		expect(model.columns).toHaveLength(2);
	});
});

describe('readXlsxAsModel — multi-sheet', () => {
	it('produces a WorkbookV3 with one SheetDefV2 per visible sheet when more than one exists', async () => {
		const bytes = await buildSampleBytes(['计划', '统计']);
		const model = await readXlsxAsModel(bytes);
		expect('sheets' in model).toBe(true);
		const wb = model as WorkbookV3;
		expect(wb.version).toBe(3);
		expect(wb.sheets.map(s => s.name)).toEqual(['计划', '统计']);
		expect(wb.activeSheetId).toBe(wb.sheets[0]!.id);
	});

	it('reads a single named sheet directly (bypassing the multi-sheet wrapper) via the sheet option', async () => {
		const bytes = await buildSampleBytes(['计划', '统计']);
		const model = asSingle(await readXlsxAsModel(bytes, '统计'));
		expect(model.columns.map(c => c.name)).toEqual(['任务', '状态', '', '备注']);
	});
});

// Confirmed live in the actual app (not just theoretically): a real
// openpyxl-authored file showed literal "&#20219;&#21153;" text instead of
// "任务" in both the header and data cells — @office-kit/xlsx's XML parser
// doesn't decode numeric character references. buildSampleBytes above can't
// reproduce this itself (the library's own writer emits raw UTF-8, not
// entities — the same reason readXlsxAsModel's other tests never see the bug
// even though they use non-ASCII text), so this tests the workaround
// function directly rather than through a full read.
describe('decodeXmlNumericEntities', () => {
	it('decodes decimal numeric references into the real characters', () => {
		expect(decodeXmlNumericEntities('&#20219;&#21153;')).toBe('任务');
	});

	it('decodes hex numeric references', () => {
		expect(decodeXmlNumericEntities('&#x4EFB;&#x52A1;')).toBe('任务');
	});

	it('decodes references mixed with plain text', () => {
		expect(decodeXmlNumericEntities('设计&#26550;构')).toBe('设计架构');
	});

	it('leaves text with no numeric references unchanged', () => {
		expect(decodeXmlNumericEntities('设计架构')).toBe('设计架构');
	});

	it('leaves a literal & that is not part of a numeric reference unchanged', () => {
		expect(decodeXmlNumericEntities('A & B')).toBe('A & B');
	});
});
