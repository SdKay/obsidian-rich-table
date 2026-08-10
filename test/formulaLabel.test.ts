import { describe, it, expect } from 'vitest';
import {
	cellIdsToLabel, labelToCellIds, rangeIdsToLabel, labelToRangeIds,
	idFormulaToLabel, labelFormulaToIds,
} from '../src/formulaLabel';
import type { TableModelV2 } from '../src/model';

function model(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_a', name: 'A列' },
			{ id: 'c_b', name: 'B列' },
		],
		rows: [
			{ id: 'r_1', cells: {} },
			{ id: 'r_2', cells: {} },
		],
		merges: [],
		styles: [],
	};
}

describe('cellIdsToLabel / labelToCellIds', () => {
	it('first data row, first column is A1 (no header offset)', () => {
		const m = model();
		expect(cellIdsToLabel(m, 'r_1', 'c_a')).toBe('A1');
		expect(labelToCellIds(m, 'A1')).toEqual({ rowId: 'r_1', colId: 'c_a' });
	});

	it('second data row, second column is B2', () => {
		const m = model();
		expect(cellIdsToLabel(m, 'r_2', 'c_b')).toBe('B2');
		expect(labelToCellIds(m, 'B2')).toEqual({ rowId: 'r_2', colId: 'c_b' });
	});

	it('returns null for an id/label that is out of bounds', () => {
		const m = model();
		expect(cellIdsToLabel(m, 'r_missing', 'c_a')).toBeNull();
		expect(labelToCellIds(m, 'Z99')).toBeNull();
		expect(labelToCellIds(m, 'not-a-label')).toBeNull();
	});
});

describe('rangeIdsToLabel / labelToRangeIds', () => {
	it('round-trips a two-cell range', () => {
		const m = model();
		const label = rangeIdsToLabel(m, 'r_1', 'c_a', 'r_2', 'c_b');
		expect(label).toBe('A1:B2');
		expect(labelToRangeIds(m, 'A1:B2')).toEqual({
			start: { rowId: 'r_1', colId: 'c_a' },
			end:   { rowId: 'r_2', colId: 'c_b' },
		});
	});
});

describe('idFormulaToLabel / labelFormulaToIds', () => {
	it('converts a simple arithmetic formula both ways', () => {
		const m = model();
		expect(idFormulaToLabel(m, '=r_1.c_a+1')).toBe('=A1+1');
		expect(labelFormulaToIds(m, '=A1+1')).toBe('=r_1.c_a+1');
	});

	it('converts a function-call range reference both ways', () => {
		const m = model();
		expect(idFormulaToLabel(m, '=SUM(r_1.c_a:r_2.c_a)')).toBe('=SUM(A1:A2)');
		expect(labelFormulaToIds(m, '=SUM(A1:A2)')).toBe('=SUM(r_1.c_a:r_2.c_a)');
	});

	it('leaves an unresolvable id reference as #REF! when converting to label', () => {
		const m = model();
		expect(idFormulaToLabel(m, '=r_gone.c_gone+1')).toBe('=#REF!+1');
	});

	it('leaves an unresolvable label unchanged when converting to ids (evaluator surfaces the error)', () => {
		const m = model();
		expect(labelFormulaToIds(m, '=Z99+1')).toBe('=Z99+1');
	});
});
