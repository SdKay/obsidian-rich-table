import { describe, it, expect } from 'vitest';
import { moveCell, clampToValidCell } from '../src/cellNav';
import { buildOccupied } from '../src/renderGridHelpers';
import type { TableModelV2 } from '../src/model';

/**
 * Unit tests for the DECIDING half of keyboard cell navigation — the same
 * split-decision-from-DOM shape renderFreezePlan.ts already uses for freeze.
 *
 * Every coordinate here is a DISPLAY index: row 0 is the header, rows 1..N are
 * data rows (so display row N reads model.rows[N-1]), and col is 0-based. That
 * 1-based-row convention is what rowId()/getMergeOrigin() already use across
 * the renderer, and mixing it up with the raw rows[] index is the single
 * easiest mistake to make in these fixtures — hence the explicit display-row
 * arithmetic spelled out in the merge tests' comments below.
 */

function model(over: Partial<TableModelV2> = {}): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_0', name: 'A' }, { id: 'c_1', name: 'B' }, { id: 'c_2', name: 'C' },
		],
		rows: [
			{ id: 'r_0', cells: {} }, { id: 'r_1', cells: {} }, { id: 'r_2', cells: {} },
		],
		merges: [],
		styles: [],
		...over,
	};
}

describe('moveCell — plain grid, no merges/hidden/wrap', () => {
	it('moves right within a row', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 0 }, 'right')).toEqual({ row: 1, col: 1 });
	});
	it('moves left within a row', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 1 }, 'left')).toEqual({ row: 1, col: 0 });
	});
	it('moves down within a column', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 0 }, 'down')).toEqual({ row: 2, col: 0 });
	});
	it('moves up within a column', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 2, col: 0 }, 'up')).toEqual({ row: 1, col: 0 });
	});
});

describe('moveCell — row-wrap and vertical clamp', () => {
	it('wraps right at the end of a row into the next row\'s first column', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 2 }, 'right')).toEqual({ row: 2, col: 0 });
	});
	it('wraps left at the start of a row into the previous row\'s last column', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 2, col: 0 }, 'left')).toEqual({ row: 1, col: 2 });
	});
	it('clamps (no movement) on Right at the absolute last cell of the table', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 3, col: 2 }, 'right')).toBeNull();
	});
	it('clamps (no movement) on Left at the absolute first cell (header)', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 0, col: 0 }, 'left')).toBeNull();
	});
	it('clamps (no wraparound) on Down at the last row', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 3, col: 0 }, 'down')).toBeNull();
	});
	it('clamps (no wraparound) on Up at the header', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 0, col: 0 }, 'up')).toBeNull();
	});
});

describe('moveCell — header participates', () => {
	it('moves Down from the header into row 1, same column', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 0, col: 1 }, 'down')).toEqual({ row: 1, col: 1 });
	});
	it('moves Up from row 1 into the header, same column', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 1 }, 'up')).toEqual({ row: 0, col: 1 });
	});
	it('Tab (Right) at the header\'s last column wraps into row 1\'s first column', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 0, col: 2 }, 'right')).toEqual({ row: 1, col: 0 });
	});
});

/**
 * Each fixture here is deliberately arranged so the move genuinely lands on a
 * COVERED (non-anchor) cell, or genuinely has to clear a span. A merge placed
 * anywhere else passes these assertions whether or not the redirect exists —
 * which is how a merge test ends up measuring nothing.
 */
describe('moveCell — merged cells', () => {
	it('exits past the FULL span of the merge you are leaving, not one cell into it', () => {
		// r_1..r_2 in column 0 = DISPLAY rows 2-3. A 4th row exists so there's
		// somewhere real to land after the span.
		const m = model({
			rows: [
				{ id: 'r_0', cells: {} }, { id: 'r_1', cells: {} },
				{ id: 'r_2', cells: {} }, { id: 'r_3', cells: {} },
			],
			merges: [{ anchor: 'r_1.c_0', end: 'r_2.c_0' }],
		});
		const occ = buildOccupied(m);
		// From the anchor (display row 2), Down must skip display row 3 — still
		// inside the same merge — and land on display row 4.
		expect(moveCell(m, occ, { row: 2, col: 0 }, 'down')).toEqual({ row: 4, col: 0 });
	});
	it('redirects a landing coordinate covered by a merge to that merge\'s anchor', () => {
		// Vertical merge in column 1: anchor r_0.c_1 (display row 1) through
		// r_2.c_1 (display row 3). Moving right from display row 2 column 0 lands
		// at (2, 1) — inside the merge but NOT its anchor — forcing the redirect
		// up to display row 1.
		const m = model({ merges: [{ anchor: 'r_0.c_1', end: 'r_2.c_1' }] });
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 2, col: 0 }, 'right')).toEqual({ row: 1, col: 1 });
	});
	it('a header-only merge is exited the same way a data-row merge is', () => {
		// header.c_1 through header.c_2 — the 'header' sentinel resolves to row
		// index -1 (resolveMergeRowIndex), so this must go through exactly the
		// same span-clearing path as a data row. From the anchor, Right has to
		// clear c_2 as well, run out of columns, and wrap into row 1.
		const m = model({ merges: [{ anchor: 'header.c_1', end: 'header.c_2' }] });
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 0, col: 1 }, 'right')).toEqual({ row: 1, col: 0 });
	});
});

describe('moveCell — hidden rows/columns are skipped, never landed on', () => {
	it('skips a hidden row when moving down', () => {
		// r_1 hidden = display row 2 hidden, so Down from display row 1 lands on 3.
		const m = model({ rows: [
			{ id: 'r_0', cells: {} },
			{ id: 'r_1', cells: {}, hidden: true },
			{ id: 'r_2', cells: {} },
		] });
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 0 }, 'down')).toEqual({ row: 3, col: 0 });
	});
	it('skips a hidden column when moving right', () => {
		const m = model({ columns: [
			{ id: 'c_0', name: 'A' },
			{ id: 'c_1', name: 'B', hidden: true },
			{ id: 'c_2', name: 'C' },
		] });
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 0 }, 'right')).toEqual({ row: 1, col: 2 });
	});
	it('a filtered-out row is skipped the same way a hidden one is', () => {
		// Column 0 filters to show only 'keep', so display row 2 ('drop') is
		// filtered out — Down from display row 1 must land on display row 3.
		const m = model({
			columns: [{ id: 'c_0', name: 'A', filter: ['keep'] }, { id: 'c_1', name: 'B' }],
			rows: [
				{ id: 'r_0', cells: { c_0: 'keep' } },
				{ id: 'r_1', cells: { c_0: 'drop' } },
				{ id: 'r_2', cells: { c_0: 'keep' } },
			],
		});
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 0 }, 'down')).toEqual({ row: 3, col: 0 });
	});
	it('lands on the first VISIBLE column when wrapping onto the next row', () => {
		const m = model({ columns: [
			{ id: 'c_0', name: 'A', hidden: true },
			{ id: 'c_1', name: 'B' },
			{ id: 'c_2', name: 'C' },
		] });
		const occ = buildOccupied(m);
		expect(moveCell(m, occ, { row: 1, col: 2 }, 'right')).toEqual({ row: 2, col: 1 });
	});
});

describe('clampToValidCell', () => {
	it('returns the same cell when still valid', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(clampToValidCell(m, occ, { row: 2, col: 1 })).toEqual({ row: 2, col: 1 });
	});
	it('returns null when the row no longer exists', () => {
		const m = model(); // display rows 1..3 only
		const occ = buildOccupied(m);
		expect(clampToValidCell(m, occ, { row: 5, col: 0 })).toBeNull();
	});
	it('returns null when the column no longer exists', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(clampToValidCell(m, occ, { row: 1, col: 9 })).toBeNull();
	});
	it('redirects to a merge anchor when the remembered cell is now covered', () => {
		// r_1.c_0 through r_1.c_1 = DISPLAY row 2, columns 0-1. The remembered
		// coordinate (2, 1) is covered but not the anchor.
		const m = model({ merges: [{ anchor: 'r_1.c_0', end: 'r_1.c_1' }] });
		const occ = buildOccupied(m);
		expect(clampToValidCell(m, occ, { row: 2, col: 1 })).toEqual({ row: 2, col: 0 });
	});
	it('keeps the header row valid', () => {
		const m = model();
		const occ = buildOccupied(m);
		expect(clampToValidCell(m, occ, { row: 0, col: 2 })).toEqual({ row: 0, col: 2 });
	});
});
