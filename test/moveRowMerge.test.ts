/**
 * move-row / move-col vs. row/col-spanning merges.
 *
 * Merges resolve by CURRENT INDEX RANGE between anchor/end (buildOccupied /
 * getMergeOrigin, renderGridHelpers.ts), not by an explicit member list — so
 * reordering a row/col that's a merge MEMBER (not the literal anchor/end) can
 * silently shrink the merge if its new position falls outside the anchor/end's
 * now-current range, even though it never left the group. Reported case:
 * dragging one row past another inside a 3-row merged block left the third,
 * unmoved member behind. See reanchorRowMerges/reanchorColMerges in
 * operations.ts for the fix.
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
		],
		rows: [
			{ id: 'r_a', cells: { c_0: 'a', c_1: '1' } },
			{ id: 'r_b', cells: { c_0: 'b', c_1: '2' } },
			{ id: 'r_c', cells: { c_0: 'c', c_1: '3' } },
			{ id: 'r_d', cells: { c_0: 'd', c_1: '4' } },
			{ id: 'r_e', cells: { c_0: 'e', c_1: '5' } },
		],
		merges: [{ anchor: 'r_b.c_0', end: 'r_d.c_0' }], // spans r_b, r_c, r_d
		styles: [],
	};
}

describe('move-row preserves merge membership when reordering within the group', () => {
	it('swapping two members keeps the same 3-row set merged, re-anchored to the new top', () => {
		const model = baseModel();
		// Swap r_b and r_c (both members, neither is r_d/the end) — matches the
		// reported bug's exact shape.
		applyStructuralOpV2(model, { type: 'move-row', fromRowId: 'r_b', toRowId: 'r_c' });

		expect(model.rows.map(r => r.id)).toEqual(['r_a', 'r_c', 'r_b', 'r_d', 'r_e']);
		expect(model.merges).toEqual([{ anchor: 'r_c.c_0', end: 'r_d.c_0' }]);
		// The re-anchored range [r_c, r_d] must still contain exactly the original
		// 3 members {r_b, r_c, r_d} by position — r_b sits at index 2, inside it.
		const rowIds = model.rows.map(r => r.id);
		const lo = rowIds.indexOf('r_c'), hi = rowIds.indexOf('r_d');
		expect(rowIds.slice(lo, hi + 1).sort()).toEqual(['r_b', 'r_c', 'r_d']);
	});

	it('moving the anchor row within the group re-anchors to whichever member is now on top', () => {
		const model = baseModel();
		// r_b is the literal anchor; move it past r_c and r_d, staying inside the group.
		applyStructuralOpV2(model, { type: 'move-row', fromRowId: 'r_b', toRowId: 'r_d' });

		expect(model.rows.map(r => r.id)).toEqual(['r_a', 'r_c', 'r_d', 'r_b', 'r_e']);
		expect(model.merges).toEqual([{ anchor: 'r_c.c_0', end: 'r_b.c_0' }]);
	});

	it('does not corrupt an unrelated row when a member is dragged far outside the group', () => {
		const model = baseModel();
		// r_c is a pure middle member (not anchor/end); move it before r_a entirely.
		applyStructuralOpV2(model, { type: 'move-row', fromRowId: 'r_c', toRowId: 'r_a' });

		expect(model.rows.map(r => r.id)).toEqual(['r_c', 'r_a', 'r_b', 'r_d', 'r_e']);
		// Member set is no longer contiguous (r_a now sits between r_b and r_d) —
		// left as the original record rather than blindly re-anchored, which would
		// otherwise have swallowed r_a into the merge.
		expect(model.merges).toEqual([{ anchor: 'r_b.c_0', end: 'r_d.c_0' }]);
	});

	it('leaves a merge alone entirely when the moved row is not one of its members', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'move-row', fromRowId: 'r_a', toRowId: 'r_e' });
		expect(model.merges).toEqual([{ anchor: 'r_b.c_0', end: 'r_d.c_0' }]);
	});
});

function baseColModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_a', name: 'A' },
			{ id: 'c_b', name: 'B' },
			{ id: 'c_c', name: 'C' },
			{ id: 'c_d', name: 'D' },
		],
		rows: [{ id: 'r_0', cells: { c_a: '1', c_b: '2', c_c: '3', c_d: '4' } }],
		merges: [{ anchor: 'r_0.c_a', end: 'r_0.c_c' }], // spans c_a, c_b, c_c
		styles: [],
	};
}

describe('move-col preserves merge membership when reordering within the group (column-axis mirror)', () => {
	it('swapping two members keeps the same 3-col set merged, re-anchored to the new left edge', () => {
		const model = baseColModel();
		applyStructuralOpV2(model, { type: 'move-col', fromColId: 'c_a', toColId: 'c_b' });

		expect(model.columns.map(c => c.id)).toEqual(['c_b', 'c_a', 'c_c', 'c_d']);
		expect(model.merges).toEqual([{ anchor: 'r_0.c_b', end: 'r_0.c_c' }]);
	});

	it('preserves a header column-range merge the same way', () => {
		const model = baseColModel();
		model.merges = [{ anchor: 'header.c_a', end: 'header.c_c' }];
		applyStructuralOpV2(model, { type: 'move-col', fromColId: 'c_a', toColId: 'c_b' });

		expect(model.merges).toEqual([{ anchor: 'header.c_b', end: 'header.c_c' }]);
	});
});
