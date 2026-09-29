import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import type { TableModelV2 } from '../src/model';

function model(): TableModelV2 {
	return {
		version: 2,
		columns: ['c_a', 'c_b', 'c_c', 'c_d'].map(id => ({ id, name: id })),
		rows: ['r_a', 'r_b', 'r_c', 'r_d', 'r_e'].map(id => ({ id, cells: { c_a: id, c_b: id } })),
		merges: [],
		styles: [],
	};
}
const rowIds = (m: TableModelV2) => m.rows.map(r => r.id);
const colIds = (m: TableModelV2) => m.columns.map(c => c.id);

describe('move-rows / move-cols', () => {
	it('moves a block down to just before the target, keeping its internal order', () => {
		const m = model();
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_a', 'r_b'], beforeRowId: 'r_e' });
		expect(rowIds(m)).toEqual(['r_c', 'r_d', 'r_a', 'r_b', 'r_e']);
	});

	it('moves a block up', () => {
		const m = model();
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_d', 'r_e'], beforeRowId: 'r_b' });
		expect(rowIds(m)).toEqual(['r_a', 'r_d', 'r_e', 'r_b', 'r_c']);
	});

	it('null target moves the block to the end', () => {
		const m = model();
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_a'], beforeRowId: null });
		expect(rowIds(m)).toEqual(['r_b', 'r_c', 'r_d', 'r_e', 'r_a']);
	});

	it('keeps relative order even when ids are listed out of order', () => {
		const m = model();
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_c', 'r_a'], beforeRowId: 'r_e' });
		expect(rowIds(m)).toEqual(['r_b', 'r_d', 'r_a', 'r_c', 'r_e']);
	});

	it('is a no-op when the target is inside the block or the order would not change', () => {
		const m = model();
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_b', 'r_c'], beforeRowId: 'r_c' });
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_b', 'r_c'], beforeRowId: 'r_d' });
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_a'], beforeRowId: 'nope' });
		expect(rowIds(m)).toEqual(['r_a', 'r_b', 'r_c', 'r_d', 'r_e']);
	});

	it('moves a column block', () => {
		const m = model();
		applyStructuralOpV2(m, { type: 'move-cols', colIds: ['c_a', 'c_b'], beforeColId: null });
		expect(colIds(m)).toEqual(['c_c', 'c_d', 'c_a', 'c_b']);
	});

	it('moving a whole row-spanning merge re-anchors it', () => {
		const m = model();
		m.merges = [{ anchor: 'r_a.c_a', end: 'r_b.c_a' }];
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_a', 'r_b'], beforeRowId: 'r_e' });
		expect(m.merges).toEqual([{ anchor: 'r_a.c_a', end: 'r_b.c_a' }]);
		expect(rowIds(m)).toEqual(['r_c', 'r_d', 'r_a', 'r_b', 'r_e']);
	});

	it('moving a whole column-spanning merge re-anchors it', () => {
		const m = model();
		m.merges = [{ anchor: 'r_a.c_b', end: 'r_a.c_c' }];
		applyStructuralOpV2(m, { type: 'move-cols', colIds: ['c_b', 'c_c'], beforeColId: null });
		expect(m.merges).toEqual([{ anchor: 'r_a.c_b', end: 'r_a.c_c' }]);
		expect(colIds(m)).toEqual(['c_a', 'c_d', 'c_b', 'c_c']);
	});

	it('moving only part of a merge out of it leaves the merge record alone', () => {
		const m = model();
		m.merges = [{ anchor: 'r_a.c_a', end: 'r_c.c_a' }];
		applyStructuralOpV2(m, { type: 'move-rows', rowIds: ['r_b'], beforeRowId: null });
		expect(m.merges).toEqual([{ anchor: 'r_a.c_a', end: 'r_c.c_a' }]);
	});
});
