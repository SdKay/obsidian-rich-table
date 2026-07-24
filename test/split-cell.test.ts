/**
 * split-cell-row / split-cell-col: splitting a plain (unmerged) cell into two
 * rows/columns while every other cell in that row/column keeps its current
 * shape — either becoming a new 2-span merge (if it was plain) or having its
 * existing merge extended (if it already spanned this far), or needing no
 * change at all (if its existing merge already spanned past the split point,
 * since merges resolve by row/col ID rather than position).
 *
 * Row/column IDs use the real `r_`/`c_` prefix convention (see idGen.ts) —
 * not just for realism, but because parseStyleTarget (styleTarget.ts) uses
 * that literal prefix to disambiguate a style target's kind, so a fixture
 * without it would silently no-op the style-inheritance assertions below.
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
			{ id: 'r_0', cells: { c_0: 'a0', c_1: 'b0', c_2: 'c0v' } },
			{ id: 'r_1', cells: { c_0: 'a1', c_1: 'b1', c_2: 'c1v' } },
			{ id: 'r_2', cells: { c_0: 'a2', c_1: 'b2', c_2: 'c2v' } },
		],
		merges: [],
		styles: [],
	};
}

describe('split-cell-row', () => {
	it('inserts a row and wraps every other plain column in a new 2-row merge', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_1' });

		expect(model.rows.map(r => r.id)).toEqual(['r_0', 'r_1', expect.any(String), 'r_2']);
		const newRowId = model.rows[2]!.id;

		// Target column: unchanged, no merge — the split cell keeps its content as-is.
		expect(model.rows[1]!.cells.c_1).toBe('b1');
		expect(model.merges.some(m => m.anchor === `r_1.c_1`)).toBe(false);

		// Every other column got a fresh 2-row merge covering the original + new row.
		expect(model.merges).toContainEqual({ anchor: 'r_1.c_0', end: `${newRowId}.c_0` });
		expect(model.merges).toContainEqual({ anchor: 'r_1.c_2', end: `${newRowId}.c_2` });
	});

	it('extends an existing merge that ends exactly at the split row', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_1.c_0' }); // c_0 already spans r_0..r_1
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_1' });

		const newRowId = model.rows[2]!.id;
		expect(model.merges).toContainEqual({ anchor: 'r_0.c_0', end: newRowId + '.c_0' });
		// c_2 (plain) still gets a fresh merge of its own.
		expect(model.merges).toContainEqual({ anchor: 'r_1.c_2', end: `${newRowId}.c_2` });
	});

	it('leaves a merge that already extends past the split row untouched (auto-absorbed by ID resolution)', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_2.c_0' }); // c_0 spans r_0..r_2, past the split point
		const mergesBefore = JSON.stringify(model.merges);
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_1' });

		// Merge record itself is untouched...
		expect(JSON.stringify(model.merges.filter(m => m.anchor === 'r_0.c_0'))).toBe(mergesBefore);
		// ...but now spans 4 physical rows (r_0, r_1, new row, r_2) since resolution is by ID/position, not a stored span count.
		const newRowId = model.rows[2]!.id;
		expect(model.rows.map(r => r.id)).toEqual(['r_0', 'r_1', newRowId, 'r_2']);
	});

	it('no-ops when the target cell is already part of a merge', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_1.c_1', end: 'r_2.c_1' });
		const before = JSON.parse(JSON.stringify(model));
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_1' });
		expect(model).toEqual(before);
	});
});

describe('split-cell-col', () => {
	it('inserts a column and wraps every other plain row — including the header — in a new 2-col merge', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_1', colId: 'c_1' });

		expect(model.columns.map(c => c.id)).toEqual(['c_0', 'c_1', expect.any(String), 'c_2']);
		const newColId = model.columns[2]!.id;

		expect(model.rows[1]!.cells.c_1).toBe('b1');
		expect(model.merges.some(m => m.anchor === 'r_1.c_1')).toBe(false);
		expect(model.merges).toContainEqual({ anchor: 'r_0.c_1', end: `r_0.${newColId}` });
		expect(model.merges).toContainEqual({ anchor: 'r_2.c_1', end: `r_2.${newColId}` });
		// The header is never the split target — it keeps its unsplit look via the
		// same 'header' sentinel row ID the general merge system resolves to "one
		// row before the first data row" (see resolveMergeRowIndex).
		expect(model.merges).toContainEqual({ anchor: 'header.c_1', end: `header.${newColId}` });
	});

	it('extends an existing header merge that ends exactly at the split column', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_0', end: 'header.c_1' }); // header already spans c_0..c_1
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_1', colId: 'c_1' });

		const newColId = model.columns[2]!.id;
		expect(model.merges).toContainEqual({ anchor: 'header.c_0', end: `header.${newColId}` });
	});

	it('leaves a header merge that already extends past the split column untouched (auto-absorbed by ID resolution)', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_0', end: 'header.c_2' }); // header spans c_0..c_2, past the split point
		const mergesBefore = JSON.stringify(model.merges);
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_1', colId: 'c_1' });

		expect(JSON.stringify(model.merges.filter(m => m.anchor === 'header.c_0'))).toBe(mergesBefore);
		const newColId = model.columns[2]!.id;
		expect(model.columns.map(c => c.id)).toEqual(['c_0', 'c_1', newColId, 'c_2']);
	});

	it('no-ops when the target cell is already part of a merge', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_1.c_1', end: 'r_1.c_2' });
		const before = JSON.parse(JSON.stringify(model));
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_1', colId: 'c_1' });
		expect(model).toEqual(before);
	});
});

describe('style inheritance on split', () => {
	it('split-cell-row duplicates a whole-row style rule onto the new row', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_1', bg: '#ff0000' });
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_1' });

		const newRowId = model.rows[2]!.id;
		// Original row keeps its own rule untouched...
		expect(model.styles).toContainEqual({ target: 'r_1', bg: '#ff0000' });
		// ...and the new row gets an equivalent copy, so its unmerged split-target
		// cell doesn't default to unstyled.
		expect(model.styles).toContainEqual({ target: newRowId, bg: '#ff0000' });
	});

	it('split-cell-row extends a row-range style ending exactly at the split row', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0:r_1', bg: '#00ff00' }); // range ends exactly at r_1
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_1' });

		const newRowId = model.rows[2]!.id;
		expect(model.styles).toContainEqual({ target: `r_0:${newRowId}`, bg: '#00ff00' });
		expect(model.styles.some(s => s.target === 'r_0:r_1')).toBe(false); // retargeted in place, not duplicated
	});

	it('split-cell-row leaves a row-range that already extends past the split row untouched', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0:r_2', bg: '#0000ff' }); // spans past the split point
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_1' });

		expect(model.styles).toContainEqual({ target: 'r_0:r_2', bg: '#0000ff' });
	});

	it('split-cell-col duplicates a whole-column style rule onto the new column', () => {
		const model = baseModel();
		model.styles.push({ target: 'c_1', bg: '#ff0000' });
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_1', colId: 'c_1' });

		const newColId = model.columns[2]!.id;
		expect(model.styles).toContainEqual({ target: 'c_1', bg: '#ff0000' });
		expect(model.styles).toContainEqual({ target: newColId, bg: '#ff0000' });
	});

	it('split-cell-col extends a column-range style ending exactly at the split column', () => {
		const model = baseModel();
		model.styles.push({ target: 'c_0:c_1', bg: '#00ff00' });
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_1', colId: 'c_1' });

		const newColId = model.columns[2]!.id;
		expect(model.styles).toContainEqual({ target: `c_0:${newColId}`, bg: '#00ff00' });
		expect(model.styles.some(s => s.target === 'c_0:c_1')).toBe(false);
	});

	it('split-cell-col leaves a column-range that already extends past the split column untouched', () => {
		const model = baseModel();
		model.styles.push({ target: 'c_0:c_2', bg: '#0000ff' });
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_1', colId: 'c_1' });

		expect(model.styles).toContainEqual({ target: 'c_0:c_2', bg: '#0000ff' });
	});

	it('split-cell-row duplicates the split target cell\'s own cell-specific style onto its new twin cell', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_1.c_1', bg: '#abcdef' }); // style set directly on the exact cell being split
		applyStructuralOpV2(model, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_1' });

		const newRowId = model.rows[2]!.id;
		expect(model.styles).toContainEqual({ target: 'r_1.c_1', bg: '#abcdef' }); // original untouched
		expect(model.styles).toContainEqual({ target: `${newRowId}.c_1`, bg: '#abcdef' }); // new twin cell
	});

	it('split-cell-col duplicates the split target cell\'s own cell-specific style onto its new twin cell', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_1.c_1', bg: '#abcdef' });
		applyStructuralOpV2(model, { type: 'split-cell-col', rowId: 'r_1', colId: 'c_1' });

		const newColId = model.columns[2]!.id;
		expect(model.styles).toContainEqual({ target: 'r_1.c_1', bg: '#abcdef' });
		expect(model.styles).toContainEqual({ target: `r_1.${newColId}`, bg: '#abcdef' });
	});
});
