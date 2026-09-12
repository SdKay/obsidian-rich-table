/**
 * Two related bugs in how row filtering interacts with vertical merges.
 *
 * 1. A column-vertical merge whose anchor row gets hidden by another
 *    column's active filter used to break: buildOccupied/getMergeOrigin only
 *    promoted a merge's effective anchor past a HIDDEN row (row.hidden),
 *    never past a FILTERED-OUT one — but a filtered row gets no <tr> at all
 *    (isRowFiltered's call site in renderer.ts skips it entirely), so the
 *    filtered anchor's cell never rendered while the surviving row's own
 *    cell in that column was still marked "occupied" by the (never-rendered)
 *    merge and skipped too. Net result: the surviving row lost a whole
 *    <td>, shifting every later column in that row left of where it belongs.
 *
 * 2. isRowFiltered itself compared a row's raw cell value against the
 *    filter — but a row COVERED by a merge on the filtered column has a
 *    genuinely empty cell of its own (the value it visibly shows lives only
 *    on the merge's anchor), so it was filtered out even when it visibly
 *    shows the exact value the filter allows. See the second describe block
 *    below.
 */
import { describe, it, expect } from 'vitest';
import { buildOccupied, getMergeOrigin, isRowFiltered } from '../src/renderGridHelpers';
import type { TableModelV2 } from '../src/model';

function repro(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_a', name: 'A1' },
			{ id: 'c_b', name: 'B1' },
			{ id: 'c_c', name: 'C1', filter: ['C3'] },
		],
		rows: [
			{ id: 'r_1', cells: { c_a: 'A23', c_b: 'B2', c_c: 'C2' } },
			{ id: 'r_2', cells: { c_b: 'B3', c_c: 'C3' } },
		],
		merges: [{ anchor: 'r_1.c_a', end: 'r_2.c_a' }],
		styles: [],
	};
}

describe('a merge whose anchor row is filtered out', () => {
	it('filters row 1 but not row 2, as the fixture intends', () => {
		const model = repro();
		expect(isRowFiltered(1, model)).toBe(true);
		expect(isRowFiltered(2, model)).toBe(false);
	});

	it('promotes the effective anchor to the surviving row, not the filtered one', () => {
		const model = repro();
		// The filtered-out row (display idx 1) is never queried by the render
		// loop for a merge origin, but the surviving row (display idx 2) must
		// resolve to this merge — otherwise its A1 cell renders as a plain,
		// unmerged cell (correct here, since only one row of the span survives).
		expect(getMergeOrigin(1, 0, model)).toBeUndefined();
		const origin = getMergeOrigin(2, 0, model);
		expect(origin).toBeDefined();
		expect(origin?.anchorRowId).toBe('r_1');
		expect(origin?.startRow).toBe(2);
		expect(origin?.endRow).toBe(2);
	});

	it('does not mark the surviving row\'s cell as occupied (it is the effective anchor, not a covered cell)', () => {
		const model = repro();
		const occupied = buildOccupied(model);
		expect(occupied.has('r_2.c_a')).toBe(false);
		expect(occupied.has('r_1.c_a')).toBe(false);
	});
});

/**
 * A row COVERED by a merge on the filtered column (its own raw cell is
 * empty — the value it visibly shows lives only on the merge's anchor) used
 * to be filtered out anyway, because isRowFiltered compared the raw cell
 * instead of resolving through the merge. Reported: column C1 filters to
 * "C3"; row 2 (its own C1) matches and survives; row 3's own C1 is empty
 * but is merged with row 2's, so it visibly shows "C3" too — it must survive
 * as well, not vanish. A second merge on column A1 spans all three rows, so
 * fixing this also exercises promoting a merge's anchor past ONE filtered
 * row while a LATER row in its span stays genuinely visible (row 1 filtered,
 * rows 2-3 both survive).
 */
function coveredCellRepro(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_a', name: 'A1' },
			{ id: 'c_b', name: 'B1' },
			{ id: 'c_c', name: 'C1', filter: ['C3'] },
		],
		rows: [
			{ id: 'r_1', cells: { c_a: 'A23', c_b: 'B2', c_c: 'C2' } },
			{ id: 'r_2', cells: { c_b: 'B3', c_c: 'C3' } },
			{ id: 'r_3', cells: { c_b: 'B4' } },
		],
		merges: [
			{ anchor: 'r_1.c_a', end: 'r_3.c_a' },
			{ anchor: 'r_2.c_c', end: 'r_3.c_c' },
		],
		styles: [],
	};
}

describe('a row covered by a merge on the filtered column', () => {
	it('resolves through the merge instead of filtering on its own empty cell', () => {
		const model = coveredCellRepro();
		expect(isRowFiltered(1, model)).toBe(true);  // own C1 "C2" — genuinely doesn't match
		expect(isRowFiltered(2, model)).toBe(false); // own C1 "C3" — matches
		expect(isRowFiltered(3, model)).toBe(false); // covered cell resolves to row 2's "C3"
	});
});
