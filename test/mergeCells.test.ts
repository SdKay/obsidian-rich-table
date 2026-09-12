/**
 * merge-cells used to only clear an existing merge sharing the NEW merge's
 * exact anchor — a merge anchored elsewhere that only partly overlapped the
 * new one's rectangle survived alongside it, leaving two merges with
 * overlapping cells (a state getMergeOrigin/buildOccupied were never
 * designed to represent — a covered cell is assumed to belong to exactly one
 * merge). Fixed by clearing any OVERLAPPING merge, not just a same-anchor one
 * (clearMergesOverlapping, operations.ts), shared with paste-values (see
 * pasteValues.test.ts) which stamps a whole copied range's worth of merges at
 * once and needs the identical guarantee.
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
			{ id: 'r_0', cells: {} },
			{ id: 'r_1', cells: {} },
			{ id: 'r_2', cells: {} },
		],
		merges: [],
		styles: [],
	};
}

describe('merge-cells', () => {
	it('a merge sharing the exact same anchor is replaced (existing behaviour)', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_0', end: 'r_1.c_0' });
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_2', endColId: 'c_0' });
		expect(model.merges).toEqual([{ anchor: 'r_0.c_0', end: 'r_2.c_0' }]);
	});

	it('a merge anchored elsewhere that partly overlaps the new one is absorbed too', () => {
		const model = baseModel();
		// Anchored at r_1.c_0, reaching UP into r_0 — same column, but its own
		// anchor is r_1, not r_0, so the old same-anchor-only check missed it.
		model.merges.push({ anchor: 'r_1.c_0', end: 'r_0.c_0' });
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_0', endColId: 'c_1' });
		expect(model.merges).toEqual([{ anchor: 'r_0.c_0', end: 'r_0.c_1' }]);
	});

	it('a merge with no overlap at all is left untouched', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_2.c_0', end: 'r_2.c_1' });
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_0', endColId: 'c_1' });
		expect(model.merges).toEqual([
			{ anchor: 'r_2.c_0', end: 'r_2.c_1' },
			{ anchor: 'r_0.c_0', end: 'r_0.c_1' },
		]);
	});

	it('overlap detection also resolves the header sentinel correctly', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_0', end: 'r_0.c_0' });
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'header', anchorColId: 'c_0', endRowId: 'header', endColId: 'c_1' });
		expect(model.merges).toEqual([{ anchor: 'header.c_0', end: 'header.c_1' }]);
	});
});
