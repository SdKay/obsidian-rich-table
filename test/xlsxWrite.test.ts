/**
 * Phase 1 of xlsx WRITE support (see CLAUDE.md's "xlsx write support"
 * section). Fixtures are built via @office-kit/xlsx's own writer, same
 * convention as xlsxSource.test.ts — legitimate here because these tests are
 * about "does OUR write code correctly map ops back onto the library's
 * object model", not "does the library correctly serialize arbitrary xlsx".
 */
import { describe, it, expect } from 'vitest';
import { createWorkbook, addWorksheet } from '@office-kit/xlsx/workbook';
import { setCell, getCell, mergeCells } from '@office-kit/xlsx/worksheet';
import { setCellBackgroundColor, setBold } from '@office-kit/xlsx/styles';
import { loadWorkbook, workbookToBytes, fromArrayBuffer } from '@office-kit/xlsx/io';
import { saveWorkbook, toArrayBuffer } from '@office-kit/xlsx/io';
import { readXlsxAsModel, writeXlsxOps, isXlsxWritableOp, applyXlsxWritableOps, type XlsxWritableOp } from '../src/xlsxSource';
import type { TableModelV2, WorkbookV3 } from '../src/model';

async function buildSampleBytes(sheetNames: string[]): Promise<ArrayBuffer> {
	const wb = createWorkbook();
	for (const name of sheetNames) {
		const ws = addWorksheet(wb, name);
		setCell(ws, 1, 1, '任务');
		setCell(ws, 1, 2, '数量');
		setCell(ws, 1, 3, '完成');

		setCell(ws, 2, 1, '设计架构');
		const b2 = setCell(ws, 2, 1, '设计架构');
		setCellBackgroundColor(wb, b2, 'C6EFCE');
		setCell(ws, 2, 2, 3);
		setCell(ws, 2, 3, true);

		setCell(ws, 3, 1, '编码实现');
		setCell(ws, 3, 2, 5);
		setCell(ws, 3, 3, false);

		mergeCells(ws, 'C4:D4');
		setCell(ws, 4, 1, '合并行');
	}
	const sink = toArrayBuffer();
	await saveWorkbook(wb, sink);
	return sink.result();
}

function asSingle(model: TableModelV2 | WorkbookV3): TableModelV2 {
	expect('sheets' in model).toBe(false);
	return model as TableModelV2;
}

describe('isXlsxWritableOp', () => {
	it('accepts the phase-1 writable op types', () => {
		expect(isXlsxWritableOp({ type: 'set-cell-content' })).toBe(true);
		expect(isXlsxWritableOp({ type: 'set-col-name' })).toBe(true);
		expect(isXlsxWritableOp({ type: 'merge-cells' })).toBe(true);
		expect(isXlsxWritableOp({ type: 'unmerge-cells' })).toBe(true);
	});

	it('rejects every other StructuralOpV2 type', () => {
		expect(isXlsxWritableOp({ type: 'delete-row' })).toBe(false);
		expect(isXlsxWritableOp({ type: 'set-col-type' })).toBe(false);
		expect(isXlsxWritableOp({ type: 'set-cell-style' })).toBe(false);
		expect(isXlsxWritableOp({ type: 'toggle-lock' })).toBe(false);
	});
});

describe('writeXlsxOps — cell content', () => {
	it('overwrites a plain string cell and leaves everything else unchanged', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-cell-content', rowId: 'r_3', colId: 'c_1', value: '重写内容' },
		]);
		const model = asSingle(await readXlsxAsModel(written));
		const [taskCol] = model.columns;
		expect(model.rows[1]!.cells[taskCol!.id]).toBe('重写内容');
		// Untouched row/cell keeps its original value.
		expect(model.rows[0]!.cells[taskCol!.id]).toBe('设计架构');
	});

	it('preserves the cell\'s existing style (styleId) when only its content changes', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-cell-content', rowId: 'r_2', colId: 'c_1', value: '重新设计架构' },
		]);
		const model = asSingle(await readXlsxAsModel(written));
		const rule = model.styles.find(s => s.target === 'r_2.c_1');
		expect(rule).toMatchObject({ bg: '#c6efce' });
	});

	it('preserves a number cell\'s type when the new text still parses as a number', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-cell-content', rowId: 'r_2', colId: 'c_2', value: '42' },
		]);
		const wb = await loadWorkbook(fromArrayBuffer(written));
		const entry = wb.sheets.find(s => s.kind === 'worksheet');
		const cell = entry?.kind === 'worksheet' ? getCell(entry.sheet, 2, 2) : undefined;
		expect(cell?.value).toBe(42);
		expect(typeof cell?.value).toBe('number');
	});

	it('falls back to Excel "General" auto-detect when the new text no longer parses as the original number type', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-cell-content', rowId: 'r_2', colId: 'c_2', value: 'n/a' },
		]);
		const wb = await loadWorkbook(fromArrayBuffer(written));
		const entry = wb.sheets.find(s => s.kind === 'worksheet');
		const cell = entry?.kind === 'worksheet' ? getCell(entry.sheet, 2, 2) : undefined;
		expect(cell?.value).toBe('n/a');
	});

	it('preserves a boolean cell\'s type when the new text is TRUE/FALSE (any case)', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-cell-content', rowId: 'r_2', colId: 'c_3', value: 'FALSE' },
		]);
		const wb = await loadWorkbook(fromArrayBuffer(written));
		const entry = wb.sheets.find(s => s.kind === 'worksheet');
		const cell = entry?.kind === 'worksheet' ? getCell(entry.sheet, 2, 3) : undefined;
		expect(cell?.value).toBe(false);
	});

	it('General-auto-detects a brand new cell with no prior type (number-looking text becomes a number)', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-cell-content', rowId: 'r_5', colId: 'c_2', value: '99' },
		]);
		const wb = await loadWorkbook(fromArrayBuffer(written));
		const entry = wb.sheets.find(s => s.kind === 'worksheet');
		const cell = entry?.kind === 'worksheet' ? getCell(entry.sheet, 5, 2) : undefined;
		expect(cell?.value).toBe(99);
	});

	it('clears the cell outright when the new text is empty', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-cell-content', rowId: 'r_3', colId: 'c_1', value: '' },
		]);
		const model = asSingle(await readXlsxAsModel(written));
		const [taskCol] = model.columns;
		expect(model.rows[1]!.cells[taskCol!.id]).toBeUndefined();
	});

	it('turns leading "=" text into a real formula, replacing whatever was there before', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-cell-content', rowId: 'r_2', colId: 'c_2', value: '=1+2' },
		]);
		const wb = await loadWorkbook(fromArrayBuffer(written));
		const entry = wb.sheets.find(s => s.kind === 'worksheet');
		const cell = entry?.kind === 'worksheet' ? getCell(entry.sheet, 2, 2) : undefined;
		expect(cell?.value).toMatchObject({ kind: 'formula', formula: '1+2' });
	});

	it('edits the header (set-col-name) into xlsx row 1', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'set-col-name', colId: 'c_1', name: '任务名称' },
		]);
		const model = asSingle(await readXlsxAsModel(written));
		expect(model.columns[0]!.name).toBe('任务名称');
	});
});

describe('writeXlsxOps — merge / unmerge', () => {
	it('creates a new merge spanning the given anchor/end', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'merge-cells', anchorRowId: 'r_2', anchorColId: 'c_2', endRowId: 'r_3', endColId: 'c_2' },
		]);
		const model = asSingle(await readXlsxAsModel(written));
		expect(model.merges).toContainEqual({ anchor: 'r_2.c_2', end: 'r_3.c_2' });
	});

	it('removes an existing merge anchored at the given cell', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'unmerge-cells', anchorRowId: 'r_4', anchorColId: 'c_3' },
		]);
		const model = asSingle(await readXlsxAsModel(written));
		expect(model.merges.some(m => m.anchor === 'r_4.c_3')).toBe(false);
	});

	it('creates a merge that reaches into the header using the "header" sentinel', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const written = await writeXlsxOps(bytes, undefined, [
			{ type: 'merge-cells', anchorRowId: 'header', anchorColId: 'c_1', endRowId: 'r_2', endColId: 'c_1' },
		]);
		const model = asSingle(await readXlsxAsModel(written));
		expect(model.merges).toContainEqual({ anchor: 'header.c_1', end: 'r_2.c_1' });
	});
});

describe('writeXlsxOps — batching and sheet targeting', () => {
	it('applies a whole batch of ops in one read-mutate-save cycle', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const ops: XlsxWritableOp[] = [
			{ type: 'set-cell-content', rowId: 'r_3', colId: 'c_1', value: 'A' },
			{ type: 'set-cell-content', rowId: 'r_3', colId: 'c_2', value: '7' },
		];
		const written = await writeXlsxOps(bytes, undefined, ops);
		const model = asSingle(await readXlsxAsModel(written));
		const [taskCol, qtyCol] = model.columns;
		expect(model.rows[1]!.cells[taskCol!.id]).toBe('A');
		expect(model.rows[1]!.cells[qtyCol!.id]).toBe('7');
	});

	it('targets the named sheet in a multi-sheet workbook, leaving the other sheet untouched', async () => {
		const bytes = await buildSampleBytes(['计划', '统计']);
		const written = await writeXlsxOps(bytes, '统计', [
			{ type: 'set-cell-content', rowId: 'r_3', colId: 'c_1', value: '仅统计表' },
		]);
		const wb = await readXlsxAsModel(written) as WorkbookV3;
		const plan = wb.sheets.find(s => s.name === '计划')!;
		const stats = wb.sheets.find(s => s.name === '统计')!;
		const [taskColStats] = stats.columns;
		const [taskColPlan] = plan.columns;
		expect(stats.rows[1]!.cells[taskColStats!.id]).toBe('仅统计表');
		expect(plan.rows[1]!.cells[taskColPlan!.id]).toBe('编码实现');
	});

	it('applyXlsxWritableOps mutates an already-loaded Workbook in place (the primitive writeXlsxOps builds on)', async () => {
		const bytes = await buildSampleBytes(['计划']);
		const wb = await loadWorkbook(fromArrayBuffer(bytes));
		applyXlsxWritableOps(wb, undefined, [
			{ type: 'set-cell-content', rowId: 'r_3', colId: 'c_1', value: 'X' },
		]);
		const written = await workbookToBytes(wb);
		const model = asSingle(await readXlsxAsModel(written));
		const [taskCol] = model.columns;
		expect(model.rows[1]!.cells[taskCol!.id]).toBe('X');
	});
});
