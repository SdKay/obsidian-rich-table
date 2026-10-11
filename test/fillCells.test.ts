import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import { parseTable } from '../src/parser';
import { serializeTable } from '../src/serializer';
import type { TableModelV2 } from '../src/model';

const model = (): TableModelV2 => ({
	version: 2,
	columns: [{ id: 'c_a', name: 'A' }, { id: 'c_b', name: 'B' }],
	rows: [
		{ id: 'r_1', cells: { c_a: 'x' } },
		{ id: 'r_2', cells: { c_a: 'y' } },
		{ id: 'r_3', cells: {} },
		{ id: 'r_4', cells: { c_a: 'w', c_b: 'keep' } },
	],
	merges: [], styles: [],
});

const col = (m: TableModelV2, id = 'c_a') => m.rows.map(r => r.cells[id] ?? '');
const fill = (m: TableModelV2, values: string[], colId = 'c_a') =>
	applyStructuralOpV2(m, { type: 'fill-cells', cells: m.rows.map(r => ({ rowId: r.id, colId })), values });

describe('fill-cells', () => {
	it('overwrites existing content and fills empty cells, like typing', () => {
		const m = model();
		fill(m, ['1', '2', '3', '4']);
		expect(col(m)).toEqual(['1', '2', '3', '4']);
	});

	it('leaves other columns alone', () => {
		const m = model();
		fill(m, ['1', '2', '3', '4']);
		expect(m.rows[3]?.cells['c_b']).toBe('keep');
	});

	it('can fill a row across columns', () => {
		const m = model();
		applyStructuralOpV2(m, { type: 'fill-cells', cells: [{ rowId: 'r_1', colId: 'c_a' }, { rowId: 'r_1', colId: 'c_b' }], values: ['a', 'b'] });
		expect(m.rows[0]?.cells).toEqual({ c_a: 'a', c_b: 'b' });
	});

	it('an empty value clears the cell', () => {
		const m = model();
		fill(m, ['', '', '', '']);
		expect(m.rows[0]?.cells['c_a']).toBeUndefined();
	});

	it('leaves no mark on the column or rows: only cell values change', () => {
		const m = model();
		const before = JSON.stringify({ columns: m.columns, merges: m.merges, styles: m.styles });
		fill(m, ['1', '2', '3', '4']);
		expect(JSON.stringify({ columns: m.columns, merges: m.merges, styles: m.styles })).toBe(before);
		expect(serializeTable(m)).not.toMatch(/fill|auto|sequence/i);
	});

	it('survives a save and reload as ordinary cells', () => {
		const m = model();
		fill(m, ['①', '②', '③', '④']);
		expect(col(parseTable(serializeTable(m)))).toEqual(['①', '②', '③', '④']);
	});

	it('replaces a formula instead of letting the recompute put its result back', () => {
		const m = model();
		m.rows[0]!.formulas = { c_a: '=1+1' };
		m.rows[0]!.cells['c_a'] = '2';
		fill(m, ['9', '8', '7', '6']);
		expect(m.rows[0]?.cells['c_a']).toBe('9');
		expect(m.rows[0]?.formulas).toBeUndefined();
	});

	it('writes only the anchor of a merged cell and skips its covered cells', () => {
		const m = model();
		m.merges = [{ anchor: 'r_2.c_a', end: 'r_3.c_a' }];
		fill(m, ['1', '2', '3', '4']);
		expect(m.rows[1]?.cells['c_a']).toBe('2');
		expect(m.rows[2]?.cells['c_a']).toBeUndefined();
		expect(m.rows[3]?.cells['c_a']).toBe('4');
	});

	// values[i] belongs to cells[i], so a missing row consumes its slot rather than
	// shifting every later value up by one.
	it('keeps values aligned to their cells when a row no longer exists', () => {
		const m = model();
		applyStructuralOpV2(m, {
			type: 'fill-cells',
			cells: [{ rowId: 'r_gone', colId: 'c_a' }, { rowId: 'r_1', colId: 'c_a' }, { rowId: 'r_2', colId: 'c_a' }],
			values: ['A', 'B', 'C'],
		});
		expect(col(m)).toEqual(['B', 'C', '', 'w']);
	});

	it('stops at the values it has: surplus cells are left as they were', () => {
		const m = model();
		applyStructuralOpV2(m, { type: 'fill-cells', cells: m.rows.map(r => ({ rowId: r.id, colId: 'c_a' })), values: ['1', '2'] });
		expect(col(m)).toEqual(['1', '2', '', 'w']);
	});
});
