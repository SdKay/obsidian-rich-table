import { describe, it, expect } from 'vitest';
import { planFreeze, resolveFreeze, type CellSnapshot, type TableSnapshot } from '../src/renderFreezePlan';
import type { TableModelV2 } from '../src/model';

/**
 * Unit tests for the DECIDING half of frozen rows/columns.
 *
 * These exist because the whole of this logic used to be reachable only through
 * a real browser: it was one function that read the DOM, decided, and wrote,
 * so every rule inside it — which edge is a boundary, which line is synthetic,
 * what order the box-shadow layers compose in — could only be checked by
 * rendering a table and inspecting pixels. Several real bugs lived in exactly
 * those rules (a merged cell's true edge, a theme's own line being replaced by
 * a fainter one) and none of them needed a browser to catch, once the decision
 * was separated from the DOM access.
 *
 * `Ref` is opaque to the planner, so a plain string stands in for a cell here.
 */

const model = (over: Partial<TableModelV2> = {}): TableModelV2 => ({
	version: 2,
	columns: [
		{ id: 'c_0', name: 'A' }, { id: 'c_1', name: 'B' },
		{ id: 'c_2', name: 'C' }, { id: 'c_3', name: 'D' },
	],
	rows: [
		{ id: 'r_0', cells: {} }, { id: 'r_1', cells: {} },
		{ id: 'r_2', cells: {} }, { id: 'r_3', cells: {} },
	],
	merges: [],
	styles: [],
	...over,
});

const cell = (over: Partial<CellSnapshot<string>> & { rowIdx: number; colIdx?: number }): CellSnapshot<string> => ({
	ref: `r${over.rowIdx}c${over.colIdx ?? 'x'}`,
	rowIdx: over.rowIdx,
	colIdx: over.colIdx,
	rowSpan: 1,
	colSpan: 1,
	isHeader: over.rowIdx === 0,
	isAgg: false,
	inLastDataRow: false,
	themeShadow: null,
	hasRealBorder: { bottom: true, right: true },
	...over,
});

/** A 4x4 table (header + 3 data rows) with the given freeze counts snapshotted. */
const snapshot = (
	freezeRows: number | undefined, freezeCols: number | undefined,
	over: Partial<TableSnapshot<string>> = {},
	cellOver: (rowIdx: number, colIdx: number) => Partial<CellSnapshot<string>> = () => ({}),
): TableSnapshot<string> => {
	const rowOffsets = new Map<number, number>();
	const colOffsets = new Map<number, number>();
	if (freezeRows !== undefined) for (let r = 0; r <= freezeRows; r++) rowOffsets.set(r, r * 30);
	if (freezeCols !== undefined) for (let c = 0; c < freezeCols; c++) colOffsets.set(c, c * 50);
	const cells: CellSnapshot<string>[] = [];
	for (let r = 0; r <= 3; r++) {
		for (let c = 0; c <= 3; c++) {
			if (!rowOffsets.has(r) && !colOffsets.has(c)) continue;
			cells.push(cell({ rowIdx: r, colIdx: c, ...cellOver(r, c) }));
		}
	}
	return {
		rowOffsets, colOffsets, cells,
		outer: { topColor: 'rgb(17, 17, 17)', topWidth: 2, leftColor: 'rgb(17, 17, 17)', leftWidth: 2 },
		tbodyShadow: null,
		...over,
	};
};

const find = <R>(plan: { cells: { ref: R }[] }, ref: R) => plan.cells.find(c => c.ref === ref);

describe('resolveFreeze', () => {
	it('passes through valid counts', () => {
		expect(resolveFreeze(model({ freezeRows: 2, freezeCols: 1 }))).toEqual({ freezeRows: 2, freezeCols: 1 });
	});

	it('rejects a count whose boundary would cut a merge in half', () => {
		// r_1..r_2 is data rows 1-2 → display rows 2-3, so freezing 2 rows would
		// put the boundary through the middle of it. Freeze then has no defined
		// meaning, so it's dropped entirely rather than applied half-way.
		const m = model({ freezeRows: 2, merges: [{ anchor: 'r_1.c_0', end: 'r_2.c_0' }] });
		expect(resolveFreeze(m).freezeRows).toBeUndefined();
	});

	it('accepts a merge that sits entirely inside the frozen band', () => {
		const m = model({ freezeRows: 3, merges: [{ anchor: 'r_1.c_0', end: 'r_2.c_0' }] });
		expect(resolveFreeze(m).freezeRows).toBe(3);
	});
});

describe('planFreeze — nothing to do', () => {
	it('produces no writes at all when neither axis is frozen', () => {
		const plan = planFreeze(snapshot(undefined, undefined), model());
		expect(plan.cells).toEqual([]);
		expect(plan.table).toEqual({});
	});

	it('suppresses the table\'s own border only on the axis that is frozen', () => {
		expect(planFreeze(snapshot(1, undefined), model({ freezeRows: 1 })).table)
			.toEqual({ 'border-top-color': 'transparent' });
		expect(planFreeze(snapshot(undefined, 1), model({ freezeCols: 1 })).table)
			.toEqual({ 'border-left-color': 'transparent' });
	});
});

describe('planFreeze — boundary detection', () => {
	it('treats a merge spanning INTO the boundary as a boundary cell on both axes', () => {
		// Anchored at row 1 / column 0 and spanning 2x2, so its true edges are row 2
		// (=== freezeRows) and column 1 (=== freezeCols - 1) while neither of its
		// own anchor indices is. A merged cell exists in the DOM only at its anchor,
		// so an anchor-only test misses this entirely — which is exactly the bug.
		const plan = planFreeze(
			snapshot(2, 2, {}, (r, c) => (r === 1 && c === 0 ? { rowSpan: 2, colSpan: 2 } : {})),
			model({ freezeRows: 2, freezeCols: 2 }),
		);
		const merged = find(plan, 'r1c0');
		expect(merged?.shadow.some(l => l.includes('--bt-frozen-row-shadow'))).toBe(true);
		expect(merged?.shadow.some(l => l.includes('--bt-frozen-col-shadow'))).toBe(true);
	});

	it('does not treat a merge that stops short of the boundary as one', () => {
		const plan = planFreeze(
			snapshot(3, 3, {}, (r, c) => (r === 1 && c === 0 ? { rowSpan: 2, colSpan: 2 } : {})),
			model({ freezeRows: 3, freezeCols: 3 }),
		);
		const merged = find(plan, 'r1c0');
		expect(merged?.shadow.some(l => l.includes('--bt-frozen-row-shadow'))).toBe(false);
		expect(merged?.shadow.some(l => l.includes('--bt-frozen-col-shadow'))).toBe(false);
	});

	it('marks a plain cell whose own index is the boundary', () => {
		const plan = planFreeze(snapshot(2, 2), model({ freezeRows: 2, freezeCols: 2 }));
		expect(find(plan, 'r2c3')?.shadow.some(l => l.includes('--bt-frozen-row-shadow'))).toBe(true);
		expect(find(plan, 'r3c1')?.shadow.some(l => l.includes('--bt-frozen-col-shadow'))).toBe(true);
		// One row above / one column left of the boundary: not a seam.
		expect(find(plan, 'r1c3')?.shadow.some(l => l.includes('--bt-frozen-row-shadow'))).toBe(false);
		expect(find(plan, 'r3c0')?.shadow.some(l => l.includes('--bt-frozen-col-shadow'))).toBe(false);
	});
});

describe('planFreeze — the seam line belongs to the theme when there is one', () => {
	it('adds no synthetic line where the theme paints a real border', () => {
		const plan = planFreeze(snapshot(2, 2), model({ freezeRows: 2, freezeCols: 2 }));
		// Replacing a real border here swapped a near-black themed rule for a pale
		// grey one, one pixel out of place — reported as the line having vanished.
		const seam = find(plan, 'r2c3');
		expect(seam?.shadow.filter(l => l.includes('--bt-frozen-divider'))).toEqual([]);
	});

	it('synthesizes one where the theme paints nothing, so the block still has an edge', () => {
		const plan = planFreeze(
			snapshot(2, 2, {}, () => ({ hasRealBorder: { bottom: false, right: false } })),
			model({ freezeRows: 2, freezeCols: 2 }),
		);
		expect(find(plan, 'r2c3')?.shadow).toContain('0 1px 0 0 var(--bt-frozen-divider, var(--background-modifier-border))');
		expect(find(plan, 'r3c1')?.shadow).toContain('1px 0 0 0 var(--bt-frozen-divider, var(--background-modifier-border))');
	});
});

describe('planFreeze — the block\'s outer frame', () => {
	it('reproduces the theme\'s own outer border colour and width, drawn outset', () => {
		const plan = planFreeze(snapshot(1, 1), model({ freezeRows: 1, freezeCols: 1 }));
		const top = find(plan, 'r0c1');
		expect(top?.hideBorders).toContain('top');
		// Outset (no `inset`), and at the theme's own 2px, so it lands where the
		// table's real border was instead of one border-width inside the block.
		expect(top?.shadow).toContain('0 -2px 0 0 var(--bt-frozen-divider, rgb(17, 17, 17))');

		const left = find(plan, 'r1c0');
		expect(left?.hideBorders).toContain('left');
		expect(left?.shadow).toContain('-2px 0 0 0 var(--bt-frozen-divider, rgb(17, 17, 17))');
	});

	it('falls back to the generic divider for a theme with no outer border', () => {
		const plan = planFreeze(
			snapshot(1, 1, { outer: { topColor: null, topWidth: 1, leftColor: null, leftWidth: 1 } }),
			model({ freezeRows: 1, freezeCols: 1 }),
		);
		expect(find(plan, 'r0c1')?.shadow)
			.toContain('0 -1px 0 0 var(--bt-frozen-divider, var(--background-modifier-border))');
	});

	it('patches the corner square the two outset lines both miss', () => {
		// Each spread-less outset line covers only the strip directly above / left
		// of its own cell, leaving the diagonal square where they meet uncovered.
		const both = planFreeze(snapshot(1, 1), model({ freezeRows: 1, freezeCols: 1 }));
		expect(find(both, 'r0c0')?.shadow).toContain('-2px -2px 0 0 var(--bt-frozen-divider, rgb(17, 17, 17))');
		// Meaningless without column freeze — there is no left strip to complete.
		const rowsOnly = planFreeze(snapshot(1, undefined), model({ freezeRows: 1 }));
		expect(find(rowsOnly, 'r0c0')?.shadow.some(l => l.startsWith('-2px -2px'))).toBe(false);
	});
});

describe('planFreeze — composition and offsets', () => {
	it('keeps the theme\'s own box-shadow as the first layer', () => {
		// box-shadow is a single property, so ours have to compose onto the theme's
		// rather than replace it — academic draws its horizontal rules this way and
		// they vanished on exactly the cells that got a line of ours.
		const plan = planFreeze(
			snapshot(1, 1, {}, () => ({ themeShadow: 'inset 0 -1.5px 0 rgb(1, 2, 3)' })),
			model({ freezeRows: 1, freezeCols: 1 }),
		);
		expect(find(plan, 'r0c0')?.shadow[0]).toBe('inset 0 -1.5px 0 rgb(1, 2, 3)');
	});

	it('gives a corner cell both classes and both sticky offsets', () => {
		const plan = planFreeze(snapshot(2, 2), model({ freezeRows: 2, freezeCols: 2 }));
		const corner = find(plan, 'r1c1');
		expect(corner?.classes).toEqual(['bt-frozen-row', 'bt-frozen-col']);
		expect(corner?.vars).toEqual({ '--bt-frozen-top': '30px', '--bt-frozen-left': '50px' });
	});

	it('emits exactly one write per cell even when both axes claim it', () => {
		const plan = planFreeze(snapshot(2, 2), model({ freezeRows: 2, freezeCols: 2 }));
		expect(new Set(plan.cells.map(c => c.ref)).size).toBe(plan.cells.length);
	});

	it('redraws a tbody-drawn bottom rule only on the last data row', () => {
		// A theme may draw the table's bottom rule on <tbody> rather than the cells;
		// the opaque frozen cells paint over it, and it can't be read from a cell.
		const plan = planFreeze(
			snapshot(undefined, 2, { tbodyShadow: 'inset 0 -1.5px 0 rgb(9, 9, 9)' },
				(r) => ({ inLastDataRow: r === 3 })),
			model({ freezeCols: 2 }),
		);
		expect(find(plan, 'r3c0')?.shadow).toContain('inset 0 -1.5px 0 rgb(9, 9, 9)');
		expect(find(plan, 'r2c0')?.shadow).not.toContain('inset 0 -1.5px 0 rgb(9, 9, 9)');
	});
});

describe('planFreeze — background', () => {
	it('forces an opaque background, header and data cells differing', () => {
		const plan = planFreeze(snapshot(1, 1), model({ freezeRows: 1, freezeCols: 1 }));
		expect(find(plan, 'r0c0')?.background).toBe('var(--bt-frozen-header-bg, var(--background-secondary))');
		expect(find(plan, 'r1c0')?.background).toBe('var(--bt-frozen-bg, var(--background-primary))');
	});

	it('leaves an aggregate row\'s own background alone', () => {
		const plan = planFreeze(
			snapshot(undefined, 1, {}, (r) => (r === 3 ? { isAgg: true } : {})),
			model({ freezeCols: 1 }),
		);
		expect(find(plan, 'r3c0')?.background).toBeNull();
	});

	it('keeps a background the user set on the cell', () => {
		// This runs on every geometry change, so a generic fill would overwrite the
		// user's colour each time — the job is to guarantee opacity, not to pick it.
		const plan = planFreeze(snapshot(undefined, 1), model({
			freezeCols: 1,
			styles: [{ target: 'r_0.c_0', bg: '#c39292' }],
		}));
		expect(find(plan, 'r1c0')?.background).toBe('#c39292');
	});
});
