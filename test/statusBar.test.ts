/**
 * Status bar (FR-017) — pure-logic pieces: the two structural ops here, and
 * (added in a later task) the selection-stats computation. See
 * solutions/status-bar.md for the full design.
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import { computeSelectionStats } from '../src/renderStatusBar';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_a', name: 'A' },
			{ id: 'c_b', name: 'B' },
		],
		rows: [
			{ id: 'r_0', cells: { c_a: '1', c_b: '2' } },
			{ id: 'r_1', cells: { c_a: '3', c_b: '4' } },
		],
		merges: [],
		styles: [],
	};
}

describe('set-status-bar-mode', () => {
	it('sets pinned', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-status-bar-mode', mode: 'pinned' });
		expect(model.statusBarMode).toBe('pinned');
	});

	it('sets hover', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-status-bar-mode', mode: 'hover' });
		expect(model.statusBarMode).toBe('hover');
	});

	it('null clears back to the default (field absent, not literally "pinned")', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-status-bar-mode', mode: 'hover' });
		applyStructuralOpV2(model, { type: 'set-status-bar-mode', mode: null });
		expect(model.statusBarMode).toBeUndefined();
	});
});

describe('set-status-bar-scroll-width', () => {
	it('sets and rounds a fractional width', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-status-bar-scroll-width', width: 120.6 });
		expect(model.statusBarScrollWidth).toBe(121);
	});

	it('null resets to the default (field absent)', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-status-bar-scroll-width', width: 120 });
		applyStructuralOpV2(model, { type: 'set-status-bar-scroll-width', width: null });
		expect(model.statusBarScrollWidth).toBeUndefined();
	});

	it('a non-positive width is treated the same as null (matches set-view-width)', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-status-bar-scroll-width', width: 120 });
		applyStructuralOpV2(model, { type: 'set-status-bar-scroll-width', width: -10 });
		expect(model.statusBarScrollWidth).toBeUndefined();
	});
});

describe('computeSelectionStats', () => {
	it('reports only totals when there is no selection', () => {
		const stats = computeSelectionStats(baseModel(), null);
		expect(stats).toEqual({ totalRows: 2, totalCols: 2 });
	});

	it('reports only totals for a single-cell selection — not worth its own stats', () => {
		const stats = computeSelectionStats(baseModel(), { r1: 1, r2: 1, c1: 0, c2: 0 });
		expect(stats).toEqual({ totalRows: 2, totalCols: 2 });
	});

	it('excludes hidden rows/columns from the totals', () => {
		const model = baseModel();
		model.rows[1]!.hidden = true;
		model.columns[1]!.hidden = true;
		const stats = computeSelectionStats(model, null);
		expect(stats).toEqual({ totalRows: 1, totalCols: 1 });
	});

	it('reports selected row/col counts and sum/avg for a multi-cell numeric selection', () => {
		const stats = computeSelectionStats(baseModel(), { r1: 1, r2: 2, c1: 0, c2: 1 });
		expect(stats.selectedRows).toBe(2);
		expect(stats.selectedCols).toBe(2);
		// 1 + 2 + 3 + 4 = 10, avg = 2.5
		expect(stats.sum).toBe('10');
		expect(stats.avg).toBe('2.5');
	});

	it('handles a selection dragged in either direction identically', () => {
		const forward = computeSelectionStats(baseModel(), { r1: 1, r2: 2, c1: 0, c2: 1 });
		const backward = computeSelectionStats(baseModel(), { r1: 2, r2: 1, c1: 1, c2: 0 });
		expect(backward).toEqual(forward);
	});

	it('skips non-numeric cells and omits sum/avg entirely when nothing in the selection is numeric', () => {
		const model = baseModel();
		model.rows[0]!.cells.c_a = 'text';
		model.rows[1]!.cells.c_a = 'also text';
		const stats = computeSelectionStats(model, { r1: 1, r2: 2, c1: 0, c2: 0 });
		expect(stats.selectedRows).toBe(2);
		expect(stats.selectedCols).toBe(1);
		expect(stats.sum).toBeUndefined();
		expect(stats.avg).toBeUndefined();
	});

	it('excludes a row hidden or filtered out of view from the sum, even if the selection rect spans it', () => {
		const model = baseModel();
		model.rows[1]!.hidden = true;
		const stats = computeSelectionStats(model, { r1: 1, r2: 2, c1: 0, c2: 1 });
		expect(stats.selectedRows).toBe(2); // the rect itself is unchanged
		expect(stats.sum).toBe('3'); // only row r_0's 1 + 2
	});

	it('excludes a hidden column from the sum, even if the selection rect spans it', () => {
		const model = baseModel();
		model.columns[1]!.hidden = true;
		const stats = computeSelectionStats(model, { r1: 1, r2: 2, c1: 0, c2: 1 });
		expect(stats.selectedCols).toBe(2);
		expect(stats.sum).toBe('4'); // only column c_a's 1 + 3
	});
});
