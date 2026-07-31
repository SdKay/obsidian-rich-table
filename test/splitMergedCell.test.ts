/**
 * split-cell-row / split-cell-col on an ALREADY-merged cell.
 *
 * Only two of the three merge shapes are eligible at all:
 *   - vertical-only (spans rows, one column) → split into 2 COLUMNS only.
 *   - horizontal-only (spans columns, one row) → split into 2 ROWS only.
 *   - both axes (a true rectangle) → neither op applies.
 * A vertical-only merge splitting into columns produces TWO separate
 * vertical merges (old column keeps its original merge untouched, new
 * column gets an identical-shape "twin"), not one merge grown into a
 * rectangle — a rectangle would immediately become the unsplittable "both"
 * shape, closing off further splits. See splitMergedCellIntoRows/Cols in
 * operations.ts.
 *
 * Row/column IDs use the real `r_`/`c_` prefix convention — see
 * test/split-cell.test.ts's own note on why (parseStyleTarget keys off it).
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_0', name: 'A' },
			{ id: 'c_1', name: 'B' },
			{ id: 'c_2', name: 'C' },
		],
		rows: [
			{ id: 'r_0', cells: {} },
			{ id: 'r_1', cells: {} },
			{ id: 'r_2', cells: {} },
		],
		merges: [],
		styles: [],
	};
}

describe('split-cell-col on a vertical-only merge', () => {
	it('splits into two parallel vertical merges, one per column, leaving the original untouched', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_1', end: 'r_1.c_1' }); // spans r_0..r_1, column c_1 only
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_0', colId: 'c_1' });

		expect(model.columns.map(c => c.id)).toEqual(['c_0', 'c_1', expect.any(String), 'c_2']);
		const newColId = model.columns[2]!.id;

		// Original merge unchanged — not grown into a rectangle.
		expect(model.merges).toContainEqual({ anchor: 'r_0.c_1', end: 'r_1.c_1' });
		// New column gets its own identical-shape twin.
		expect(model.merges).toContainEqual({ anchor: `r_0.${newColId}`, end: `r_1.${newColId}` });
	});

	it('every OTHER row (outside the merge\'s own span) keeps its shape — plain rows get a fresh 2-col merge', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_1', end: 'r_1.c_1' });
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_0', colId: 'c_1' });

		const newColId = model.columns[2]!.id;
		// r_2 (not part of the r_0..r_1 span) was plain at c_1 — gets a fresh merge.
		expect(model.merges).toContainEqual({ anchor: 'r_2.c_1', end: `r_2.${newColId}` });
		// The header row is also "another row" and gets the same treatment.
		expect(model.merges).toContainEqual({ anchor: `header.c_1`, end: `header.${newColId}` });
	});

	it('extends an existing merge in another row that ends exactly at the split column', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_1', end: 'r_1.c_1' });
		model.merges.push({ anchor: 'r_2.c_0', end: 'r_2.c_1' }); // c_0..c_1 already merged in r_2
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_0', colId: 'c_1' });

		const newColId = model.columns[2]!.id;
		expect(model.merges).toContainEqual({ anchor: 'r_2.c_0', end: `r_2.${newColId}` });
	});

	it('is a no-op on a horizontal-only merge (already multi-column, wrong axis)', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_0.c_1' }); // horizontal, one row
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_0', colId: 'c_0' });

		expect(model.columns).toHaveLength(3); // no column inserted
		expect(model.merges).toEqual([{ anchor: 'r_0.c_0', end: 'r_0.c_1' }]); // untouched
	});

	it('is a no-op on a rectangular (both-axis) merge', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_1.c_1' }); // 2 rows x 2 cols
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_0', colId: 'c_0' });

		expect(model.columns).toHaveLength(3);
		expect(model.merges).toEqual([{ anchor: 'r_0.c_0', end: 'r_1.c_1' }]);
	});
});

describe('split-cell-row on a horizontal-only merge (column-axis mirror)', () => {
	it('splits into two parallel horizontal merges, one per row, leaving the original untouched', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_1.c_0', end: 'r_1.c_2' }); // spans c_0..c_2, row r_1 only
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_0' });

		expect(model.rows.map(r => r.id)).toEqual(['r_0', 'r_1', expect.any(String), 'r_2']);
		const newRowId = model.rows[2]!.id;

		expect(model.merges).toContainEqual({ anchor: 'r_1.c_0', end: 'r_1.c_2' });
		expect(model.merges).toContainEqual({ anchor: `${newRowId}.c_0`, end: `${newRowId}.c_2` });
	});

	it('is a no-op on a vertical-only merge (already multi-row, wrong axis)', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_1.c_0' }); // vertical, one column
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_0', colId: 'c_0' });

		expect(model.rows).toHaveLength(3);
		expect(model.merges).toEqual([{ anchor: 'r_0.c_0', end: 'r_1.c_0' }]);
	});

	it('is a no-op on a rectangular (both-axis) merge', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_1.c_1' });
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_0', colId: 'c_0' });

		expect(model.rows).toHaveLength(3);
		expect(model.merges).toEqual([{ anchor: 'r_0.c_0', end: 'r_1.c_1' }]);
	});

	it('is a no-op on a header-anchored horizontal merge (no second header row to split into)', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_0', end: 'header.c_2' });
		// 'header' is a valid rowId here — resolveMergeRowIndex treats it as a
		// sentinel row (index -1), same as every other header-merge lookup in
		// this codebase (see getMergeOrigin/findMergeCoveringCell).
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'header', colId: 'c_0' });

		expect(model.rows).toHaveLength(3); // no row inserted
		expect(model.merges).toEqual([{ anchor: 'header.c_0', end: 'header.c_2' }]); // untouched
	});
});
