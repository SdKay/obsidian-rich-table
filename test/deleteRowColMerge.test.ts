/**
 * delete-row / delete-col vs. row/col-spanning merges.
 *
 * Both reducers clean up merges with an `endsWith`/`startsWith` filter that
 * unconditionally DROPS any merge whose anchor or end is the row/column being
 * deleted — correct when the merge only spans that one row/column, but wrong
 * when it spans MORE than one and merely happens to have the deleted one as
 * its literal boundary: reported case — a 3-column-wide merge in row 2
 * disappeared entirely (not just shrank by one column) when the rightmost of
 * its 3 columns (which happened to be the merge's literal `end`) was deleted.
 * See reanchorMergesForRowDeletion/reanchorMergesForColumnDeletion in
 * operations.ts for the fix — a shrink-the-boundary counterpart to
 * reanchorRowMerges/reanchorColMerges (move-row/move-col's own merge fix,
 * tested in moveRowMerge.test.ts), not a reuse of that machinery: a deleted
 * row/col can't "scatter", it's just gone, so only the two boundary members
 * ever need adjusting.
 *
 * A follow-up gap in that same fix: shrinking a merge across two SEPARATE
 * deletions (not caught by either deletion's own endsWith/startsWith filter,
 * since the merge gets reanchored AWAY from each deleted id before that
 * filter runs) can leave it at anchor===end — a "merge" spanning exactly one
 * cell, which merges nothing. pruneDegenerateMerges (operations.ts) removes
 * these; reported via a real table that had accumulated several after many
 * manual row/column splits and deletions.
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import type { TableModelV2 } from '../src/model';

function colModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_a', name: 'A' },
			{ id: 'c_b', name: 'B' },
			{ id: 'c_c', name: 'C' },
		],
		rows: [
			{ id: 'r_0', cells: {} },
			{ id: 'r_1', cells: {} },
		],
		merges: [{ anchor: 'r_1.c_a', end: 'r_1.c_c' }], // spans c_a, c_b, c_c in row r_1 — exact reported shape
		styles: [],
	};
}

function rowModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_0', name: 'A' },
			{ id: 'c_1', name: 'B' },
		],
		rows: [
			{ id: 'r_a', cells: {} },
			{ id: 'r_b', cells: {} },
			{ id: 'r_c', cells: {} },
		],
		merges: [{ anchor: 'r_a.c_0', end: 'r_c.c_0' }], // spans r_a, r_b, r_c in column c_0
		styles: [],
	};
}

describe('delete-col shrinks (not removes) a multi-column merge whose literal end is the deleted column', () => {
	it('reproduces the reported bug: deleting the merge\'s end column used to drop the whole merge', () => {
		const model = colModel();
		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_c' });

		expect(model.merges).toHaveLength(1); // this is what the bug lost entirely
		expect(model.merges[0]).toEqual({ anchor: 'r_1.c_a', end: 'r_1.c_b' });
	});

	it('deleting the merge\'s literal anchor column shrinks the left boundary instead', () => {
		const model = colModel();
		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_a' });

		expect(model.merges).toHaveLength(1);
		expect(model.merges[0]).toEqual({ anchor: 'r_1.c_b', end: 'r_1.c_c' });
	});

	it('deleting a MIDDLE column of the span needs no boundary change — merge keeps its original anchor/end ids', () => {
		const model = colModel();
		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_b' });

		expect(model.merges).toHaveLength(1);
		expect(model.merges[0]).toEqual({ anchor: 'r_1.c_a', end: 'r_1.c_c' });
	});

	it('a single-column merge is still correctly removed (not shrunk into nothing) when its only column is deleted', () => {
		const model = colModel();
		model.merges = [{ anchor: 'r_0.c_a', end: 'r_1.c_a' }]; // vertical, single-column merge
		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_a' });

		expect(model.merges).toHaveLength(0);
	});

	it('an unrelated merge in a different row is left untouched', () => {
		const model = colModel();
		model.merges.push({ anchor: 'r_0.c_b', end: 'r_0.c_c' });
		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_a' });

		const unrelated = model.merges.find(m => m.anchor === 'r_0.c_b');
		expect(unrelated).toEqual({ anchor: 'r_0.c_b', end: 'r_0.c_c' });
	});

	it('shrinking across two SEPARATE deletions down to one remaining column removes the now-degenerate merge instead of leaving an anchor===end record', () => {
		const model = colModel(); // merge spans c_a, c_b, c_c
		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_c' }); // shrinks to c_a:c_b
		expect(model.merges).toHaveLength(1);

		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_b' }); // would shrink to c_a:c_a — degenerate
		expect(model.merges).toHaveLength(0);
	});
});

describe('delete-row shrinks (not removes) a multi-row merge whose literal end is the deleted row (column-axis mirror)', () => {
	it('deleting the merge\'s end row shrinks the bottom boundary', () => {
		const model = rowModel();
		applyStructuralOpV2(model, { type: 'delete-row', rowId: 'r_c' });

		expect(model.merges).toHaveLength(1);
		expect(model.merges[0]).toEqual({ anchor: 'r_a.c_0', end: 'r_b.c_0' });
	});

	it('deleting the merge\'s literal anchor row shrinks the top boundary instead', () => {
		const model = rowModel();
		applyStructuralOpV2(model, { type: 'delete-row', rowId: 'r_a' });

		expect(model.merges).toHaveLength(1);
		expect(model.merges[0]).toEqual({ anchor: 'r_b.c_0', end: 'r_c.c_0' });
	});

	it('deleting a MIDDLE row of the span needs no boundary change', () => {
		const model = rowModel();
		applyStructuralOpV2(model, { type: 'delete-row', rowId: 'r_b' });

		expect(model.merges).toHaveLength(1);
		expect(model.merges[0]).toEqual({ anchor: 'r_a.c_0', end: 'r_c.c_0' });
	});

	it('a single-row merge is still correctly removed when its only row is deleted', () => {
		const model = rowModel();
		model.merges = [{ anchor: 'r_a.c_0', end: 'r_a.c_1' }]; // horizontal, single-row merge
		applyStructuralOpV2(model, { type: 'delete-row', rowId: 'r_a' });

		expect(model.merges).toHaveLength(0);
	});

	it('shrinking across two SEPARATE deletions down to one remaining row removes the now-degenerate merge (column-axis mirror)', () => {
		const model = rowModel(); // merge spans r_a, r_b, r_c
		applyStructuralOpV2(model, { type: 'delete-row', rowId: 'r_c' }); // shrinks to r_a:r_b
		expect(model.merges).toHaveLength(1);

		applyStructuralOpV2(model, { type: 'delete-row', rowId: 'r_b' }); // would shrink to r_a:r_a — degenerate
		expect(model.merges).toHaveLength(0);
	});
});
