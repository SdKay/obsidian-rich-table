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

describe('merge-cells carries a non-anchor cell\'s value onto the anchor', () => {
	// Reported: merging A1+A2 when A1 (the anchor) was empty and A2 held a
	// value produced a merged cell with no content at all — every reader
	// (resolveCellValue, getMergeOrigin+renderRow) resolves a merge's value
	// from its literal ANCHOR cell alone, and the anchor's own (empty) content
	// was pushed verbatim, never checking whether some other cell in the
	// rectangle actually held the value.
	it('promotes the second cell\'s value onto the anchor when the anchor is empty', () => {
		const model = baseModel();
		model.rows[1]!.cells['c_0'] = 'hello'; // r_1 has content, r_0 (the anchor) doesn't
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_1', endColId: 'c_0' });
		expect(model.rows[0]!.cells['c_0']).toBe('hello');
		expect(model.rows[1]!.cells['c_0']).toBeUndefined(); // cleared — value now lives only on the anchor
	});

	it('leaves the anchor\'s own value alone when the anchor already has content', () => {
		const model = baseModel();
		model.rows[0]!.cells['c_0'] = 'first';
		model.rows[1]!.cells['c_0'] = 'second';
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_1', endColId: 'c_0' });
		expect(model.rows[0]!.cells['c_0']).toBe('first');
		expect(model.rows[1]!.cells['c_0']).toBe('second'); // untouched — anchor already had a value to keep
	});

	it('leaves the merge genuinely empty when every cell in the rectangle is empty', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_1', endColId: 'c_0' });
		expect(model.rows[0]!.cells['c_0']).toBeUndefined();
		expect(model.rows[1]!.cells['c_0']).toBeUndefined();
	});

	it('scans in row-major order, taking the first non-empty cell across a rectangular merge', () => {
		const model = baseModel();
		model.rows[1]!.cells['c_1'] = 'later'; // r_1.c_1
		model.rows[1]!.cells['c_0'] = 'earlier'; // r_1.c_0 — earlier in row-major order than r_1.c_1
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_1', endColId: 'c_1' });
		expect(model.rows[0]!.cells['c_0']).toBe('earlier');
	});

	it('promotes a header cell\'s value onto the anchor via the header sentinel', () => {
		const model = baseModel();
		model.columns[0]!.name = ''; // header itself empty
		model.rows[0]!.cells['c_0'] = 'row value';
		applyStructuralOpV2(model, { type: 'merge-cells', anchorRowId: 'header', anchorColId: 'c_0', endRowId: 'r_0', endColId: 'c_0' });
		expect(model.columns[0]!.name).toBe('row value');
		expect(model.rows[0]!.cells['c_0']).toBeUndefined();
	});
});
