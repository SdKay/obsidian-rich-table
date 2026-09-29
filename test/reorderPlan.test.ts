import { describe, it, expect } from 'vitest';
import { planBlockReorder, canBlockReorder, blockReorderBlocker, axisSpans, blockFloor } from '../src/reorderPlan';
import type { TableModelV2 } from '../src/model';

const items = [0, 1, 2, 3].map(i => ({ start: i * 60, size: 60 }));

describe('planBlockReorder', () => {
	it('stays put for a tiny drag', () => {
		const p = planBlockReorder(items, 1, 1, 10, 0);
		expect(p.slot).toBe(1);
		expect(p.shifts).toEqual([0, 0, 0, 0]);
	});
	it('moving right past a neighbour midpoint shifts it left by the block size', () => {
		const p = planBlockReorder(items, 0, 0, 35, 0);
		expect(p.slot).toBe(2);
		expect(p.shifts).toEqual([0, -60, 0, 0]);
		expect(p.settle).toBe(60);
	});
	it('a multi-item block can reach the very end even though it is clamped inside', () => {
		const p = planBlockReorder(items, 0, 1, 500, 0);
		expect(p.slot).toBe(4);
		expect(p.offset).toBe(120);
		expect(p.shifts).toEqual([0, 0, -120, -120]);
		expect(p.settle).toBe(120);
	});
	it('moving left shifts earlier items right and picks the earliest passed slot', () => {
		const p = planBlockReorder(items, 3, 3, -500, 0);
		expect(p.slot).toBe(0);
		expect(p.shifts).toEqual([60, 60, 60, 0]);
		expect(p.settle).toBe(-180);
	});
	it('never goes above the floor (the header row)', () => {
		const rows = [0, 1, 2].map(i => ({ start: i * 30, size: 30 }));
		const p = planBlockReorder(rows, 2, 2, -500, 1);
		expect(p.slot).toBe(1);
		expect(p.shifts[0]).toBe(0);
		expect(p.offset).toBe(-30);
	});
	it('skips zero-size (filtered out) items', () => {
		const withGap = [{ start: 0, size: 60 }, { start: 60, size: 0 }, { start: 60, size: 60 }];
		const p = planBlockReorder(withGap, 0, 0, 50, 0);
		expect(p.slot).toBe(3);
		expect(p.shifts).toEqual([0, 0, -60]);
	});
});

describe('planBlockReorder with merged spans', () => {
	it('a merged pair moves past a neighbour as one unit', () => {
		const p = planBlockReorder(items, 2, 2, -40, 0, [[0, 0], [1, 1], [2, 2], [3, 3]]);
		expect(p.slot).toBe(1);
		const spans: [number, number][] = [[0, 0], [1, 2], [3, 3]];
		const q = planBlockReorder(items, 0, 0, 100, 0, spans);
		expect(q.slot).toBe(3);
		expect(q.shifts).toEqual([0, -60, -60, 0]);
		expect(q.settle).toBe(120);
	});
	it('a single row cannot be dropped in the middle of a merged span', () => {
		const spans: [number, number][] = [[0, 0], [1, 1], [2, 3]];
		const p = planBlockReorder(items, 1, 1, 70, 0, spans);
		expect(p.slot).toBe(4);
		expect(p.shifts).toEqual([0, 0, -60, -60]);
		const q = planBlockReorder(items, 1, 1, 40, 0, spans);
		expect(q.slot).toBe(1);
	});
	it('a block never goes into the frozen area', () => {
		const p = planBlockReorder(items, 3, 3, -500, 2);
		expect(p.slot).toBe(2);
		expect(p.shifts.slice(0, 2)).toEqual([0, 0]);
	});
});

describe('axisSpans / blockFloor', () => {
	const base = (): TableModelV2 => ({
		version: 2,
		columns: ['a', 'b', 'c', 'd'].map(id => ({ id: 'c_' + id, name: id })),
		rows: ['a', 'b', 'c', 'd'].map(id => ({ id: 'r_' + id, cells: {} })),
		merges: [], styles: [],
	});
	it('every index is its own span without merges', () => {
		expect(axisSpans(base(), 'col')).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
		expect(axisSpans(base(), 'row')).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
	});
	it('a row merge joins its rows; display index 0 is the header', () => {
		const m = base(); m.merges = [{ anchor: 'r_b.c_a', end: 'r_c.c_a' }];
		expect(axisSpans(m, 'row')).toEqual([[0, 0], [1, 1], [2, 3], [4, 4]]);
		expect(axisSpans(m, 'col')).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
	});
	it('overlapping merges chain into one span', () => {
		const m = base(); m.merges = [{ anchor: 'r_a.c_a', end: 'r_a.c_b' }, { anchor: 'r_b.c_b', end: 'r_b.c_c' }];
		expect(axisSpans(m, 'col')).toEqual([[0, 2], [3, 3]]);
	});
	it('floor sits below the header and below frozen rows / after frozen columns', () => {
		const m = base(); m.freezeRows = 2; m.freezeCols = 1;
		expect(blockFloor(m, 'row')).toBe(3);
		expect(blockFloor(m, 'col')).toBe(1);
		expect(blockFloor(base(), 'row')).toBe(1);
		expect(blockFloor(base(), 'col')).toBe(0);
	});
});

describe('blockReorderBlocker', () => {
	const base = (): TableModelV2 => ({
		version: 2,
		columns: ['a', 'b', 'c', 'd'].map(id => ({ id: 'c_' + id, name: id })),
		rows: ['a', 'b', 'c', 'd'].map(id => ({ id: 'r_' + id, cells: {} })),
		merges: [], styles: [],
	});
	it('allows a plain table on both axes, but never the header row', () => {
		expect(canBlockReorder(base(), 'row', 1, 2)).toBe(true);
		expect(canBlockReorder(base(), 'col', 0, 1)).toBe(true);
		expect(blockReorderBlocker(base(), 'row', 0, 1)).toBe('header');
	});
	it('frozen columns never get in the way of reordering rows, and vice versa', () => {
		const m = base(); m.freezeCols = 2; m.freezeRows = 1;
		expect(canBlockReorder(m, 'row', 2, 3)).toBe(true);
		expect(canBlockReorder(m, 'col', 2, 3)).toBe(true);
	});
	it('refuses a block that sits in the frozen area, allows one outside it', () => {
		const m = base(); m.freezeRows = 2; m.freezeCols = 1;
		expect(blockReorderBlocker(m, 'row', 2, 2)).toBe('freeze');
		expect(blockReorderBlocker(m, 'row', 3, 4)).toBe(null);
		expect(blockReorderBlocker(m, 'col', 0, 1)).toBe('freeze');
		expect(blockReorderBlocker(m, 'col', 1, 2)).toBe(null);
	});
	it('a merge only restricts the axis it spans', () => {
		const m = base(); m.merges = [{ anchor: 'r_b.c_a', end: 'r_c.c_a' }];
		expect(canBlockReorder(m, 'col', 1, 2)).toBe(true);
		expect(canBlockReorder(m, 'row', 4, 4)).toBe(true);
	});
	it('a block covering a merge completely may move; one that cuts it may not', () => {
		const m = base(); m.merges = [{ anchor: 'r_b.c_a', end: 'r_c.c_a' }];
		expect(canBlockReorder(m, 'row', 2, 3)).toBe(true);
		expect(canBlockReorder(m, 'row', 1, 3)).toBe(true);
		expect(canBlockReorder(m, 'row', 1, 2)).toBe(false);
		expect(blockReorderBlocker(m, 'row', 3, 3)).toBe('merge');
		expect(blockReorderBlocker(m, 'row', 3, 4)).toBe('merge');
	});
	it('column merges follow the same rule', () => {
		const m = base(); m.merges = [{ anchor: 'r_a.c_b', end: 'r_a.c_c' }];
		expect(canBlockReorder(m, 'col', 1, 2)).toBe(true);
		expect(canBlockReorder(m, 'col', 0, 2)).toBe(true);
		expect(canBlockReorder(m, 'col', 2, 3)).toBe(false);
	});
	it('rows still refuse under a live sort or hidden rows', () => {
		const sorted = base(); sorted.sort = { colId: 'c_a', dir: 'asc' };
		const hidden = base(); hidden.rows[0]!.hidden = true;
		expect(blockReorderBlocker(sorted, 'row', 1, 1)).toBe('sort');
		expect(blockReorderBlocker(hidden, 'row', 2, 2)).toBe('hidden');
		expect(canBlockReorder(sorted, 'col', 1, 1)).toBe(true);
	});
	it('columns refuse while any column is hidden', () => {
		const m = base(); m.columns[0]!.hidden = true;
		expect(blockReorderBlocker(m, 'col', 1, 1)).toBe('hidden');
	});
});
