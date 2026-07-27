/**
 * Sheet-level (workbook) operations — the sheet-axis counterpart to
 * test/views.test.ts. Every op here mutates WHICH sheets exist or which one
 * is active, never a sheet's own columns/rows/styles (that's still
 * applyStructuralOpV2, unchanged, applied to whichever sheet is active).
 */
import { describe, it, expect } from 'vitest';
import { applyWorkbookOp } from '../src/workbookOperations';
import type { WorkbookV3, SheetDefV2 } from '../src/model';

function sheet(id: string, name?: string): SheetDefV2 {
	return { id, version: 2, columns: [{ id: `c_${id}`, name: 'A' }], rows: [], merges: [], styles: [], ...(name ? { name } : {}) };
}

function baseWorkbook(): WorkbookV3 {
	return { version: 3, activeSheetId: 's_1', sheets: [sheet('s_1', 'First')] };
}

describe('create-sheet', () => {
	it('appends a genuinely empty sheet at the end and switches to it', () => {
		const wb = baseWorkbook();
		applyWorkbookOp(wb, { type: 'create-sheet' });

		expect(wb.sheets).toHaveLength(2);
		const created = wb.sheets[1]!;
		expect(created.columns).toHaveLength(0);
		expect(wb.activeSheetId).toBe(created.id);
	});

	it('generates a unique id even among many existing sheets', () => {
		const wb: WorkbookV3 = { version: 3, activeSheetId: 's_1', sheets: [sheet('s_1'), sheet('s_2'), sheet('s_3')] };
		applyWorkbookOp(wb, { type: 'create-sheet' });
		const ids = wb.sheets.map(s => s.id);
		expect(new Set(ids).size).toBe(ids.length); // no duplicates
	});
});

describe('delete-sheet', () => {
	it('removes the sheet and falls back the active pointer to a sibling', () => {
		const wb: WorkbookV3 = { version: 3, activeSheetId: 's_1', sheets: [sheet('s_1'), sheet('s_2')] };
		applyWorkbookOp(wb, { type: 'delete-sheet', sheetId: 's_1' });

		expect(wb.sheets).toHaveLength(1);
		expect(wb.sheets[0]!.id).toBe('s_2');
		expect(wb.activeSheetId).toBe('s_2');
	});

	it('deleting a non-active sheet leaves the active pointer untouched', () => {
		const wb: WorkbookV3 = { version: 3, activeSheetId: 's_2', sheets: [sheet('s_1'), sheet('s_2')] };
		applyWorkbookOp(wb, { type: 'delete-sheet', sheetId: 's_1' });

		expect(wb.activeSheetId).toBe('s_2');
	});

	it('deleting the last remaining sheet leaves an empty sheets array — tableBlock.ts collapses this to an empty code block', () => {
		const wb = baseWorkbook();
		applyWorkbookOp(wb, { type: 'delete-sheet', sheetId: 's_1' });

		expect(wb.sheets).toHaveLength(0);
	});

	it('deleting an unknown sheetId is a no-op', () => {
		const wb = baseWorkbook();
		applyWorkbookOp(wb, { type: 'delete-sheet', sheetId: 's_does_not_exist' });
		expect(wb.sheets).toHaveLength(1);
	});
});

describe('rename-sheet', () => {
	it('sets the name without touching anything else', () => {
		const wb = baseWorkbook();
		applyWorkbookOp(wb, { type: 'rename-sheet', sheetId: 's_1', name: 'Renamed' });
		expect(wb.sheets[0]!.name).toBe('Renamed');
	});
});

describe('reorder-sheets', () => {
	it('reorders sheets by id array', () => {
		const wb: WorkbookV3 = { version: 3, activeSheetId: 's_1', sheets: [sheet('s_1'), sheet('s_2'), sheet('s_3')] };
		applyWorkbookOp(wb, { type: 'reorder-sheets', sheetIds: ['s_3', 's_1', 's_2'] });
		expect(wb.sheets.map(s => s.id)).toEqual(['s_3', 's_1', 's_2']);
	});

	it('bails out (no change) if the id set does not match exactly', () => {
		const wb: WorkbookV3 = { version: 3, activeSheetId: 's_1', sheets: [sheet('s_1'), sheet('s_2')] };
		applyWorkbookOp(wb, { type: 'reorder-sheets', sheetIds: ['s_1'] }); // missing s_2
		expect(wb.sheets.map(s => s.id)).toEqual(['s_1', 's_2']);
	});
});

describe('set-active-sheet', () => {
	it('switches the active pointer', () => {
		const wb: WorkbookV3 = { version: 3, activeSheetId: 's_1', sheets: [sheet('s_1'), sheet('s_2')] };
		applyWorkbookOp(wb, { type: 'set-active-sheet', sheetId: 's_2' });
		expect(wb.activeSheetId).toBe('s_2');
	});

	it('an unknown sheetId is a no-op — the active pointer never dangles', () => {
		const wb = baseWorkbook();
		applyWorkbookOp(wb, { type: 'set-active-sheet', sheetId: 's_does_not_exist' });
		expect(wb.activeSheetId).toBe('s_1');
	});
});

describe('set-sheet-tab-style', () => {
	it('sets both colors', () => {
		const wb = baseWorkbook();
		applyWorkbookOp(wb, { type: 'set-sheet-tab-style', sheetId: 's_1', tabColor: '#ff0000', tabTextColor: '#ffffff' });
		expect(wb.sheets[0]!.tabColor).toBe('#ff0000');
		expect(wb.sheets[0]!.tabTextColor).toBe('#ffffff');
	});

	it('null clears a color independently of the other', () => {
		const wb = baseWorkbook();
		wb.sheets[0]!.tabColor = '#ff0000';
		wb.sheets[0]!.tabTextColor = '#ffffff';
		applyWorkbookOp(wb, { type: 'set-sheet-tab-style', sheetId: 's_1', tabColor: null, tabTextColor: '#ffffff' });
		expect(wb.sheets[0]!.tabColor).toBeUndefined();
		expect(wb.sheets[0]!.tabTextColor).toBe('#ffffff');
	});
});

describe('set-sheet-content', () => {
	it('replaces the sheet\'s own data while keeping its identity (id/name/tabColor)', () => {
		const wb = baseWorkbook();
		wb.sheets[0]!.name = 'Keep me';
		wb.sheets[0]!.tabColor = '#abcdef';
		applyWorkbookOp(wb, {
			type: 'set-sheet-content', sheetId: 's_1',
			content: { columns: [{ id: 'c_new', name: 'New col' }], rows: [{ id: 'r_new', cells: {} }], merges: [], styles: [] },
		});
		const sheetAfter = wb.sheets[0]!;
		expect(sheetAfter.id).toBe('s_1');
		expect(sheetAfter.name).toBe('Keep me');
		expect(sheetAfter.tabColor).toBe('#abcdef');
		expect(sheetAfter.columns).toEqual([{ id: 'c_new', name: 'New col' }]);
	});
});
