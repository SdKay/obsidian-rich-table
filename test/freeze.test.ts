/**
 * freezeRows/freezeCols — freezes a position (header + first N data rows /
 * first N columns), not a set of row/column IDs, matching Excel's own freeze
 * panes semantics: reordering changes which rows/columns end up in the
 * frozen region, the count itself doesn't move.
 *
 * A freeze boundary that would split a merge across it is rejected outright when
 * the freeze is being SET (model left unchanged) — see canFreezeRows/
 * canFreezeCols in operations.ts. The reverse order is reconciled instead: an
 * operation performed later that would invalidate an existing freeze keeps the
 * operation and shrinks the freeze, since that operation is the newer intent. Only the axis being frozen matters: a
 * merge confined to a single row can span any number of columns and never
 * blocks a row freeze, and vice versa for columns.
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2, canFreezeRows, canFreezeCols } from '../src/operations';
import { parseTable } from '../src/parser';
import { serializeTable } from '../src/serializer';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
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
			{ id: 'r_2', cells: {} },
		],
		merges: [],
		styles: [],
	};
}

describe('canFreezeRows', () => {
	it('allows any count within range when there are no merges', () => {
		const model = baseModel();
		expect(canFreezeRows(model, 0)).toBe(true);
		expect(canFreezeRows(model, 3)).toBe(true);
	});

	it('rejects a count that would split a vertical merge', () => {
		const model = baseModel();
		model.merges = [{ anchor: 'r_0.c_a', end: 'r_1.c_a' }]; // spans rows 0-1
		expect(canFreezeRows(model, 1)).toBe(false); // would freeze row 0 only, splitting the merge
		expect(canFreezeRows(model, 0)).toBe(true);  // boundary before the merge — fine
		expect(canFreezeRows(model, 2)).toBe(true);  // boundary after the merge — fine
	});

	it('a merge confined to one row (however many columns) never blocks a row freeze', () => {
		const model = baseModel();
		model.merges = [{ anchor: 'r_0.c_a', end: 'r_0.c_c' }]; // horizontal, single row
		expect(canFreezeRows(model, 1)).toBe(true);
	});

	it('a header-to-data vertical merge is treated the same as any other row-crossing merge', () => {
		const model = baseModel();
		model.merges = [{ anchor: 'header.c_a', end: 'r_0.c_a' }];
		expect(canFreezeRows(model, 0)).toBe(false); // header is always frozen — this would split it from r_0
	});

	it('rejects an out-of-range count', () => {
		const model = baseModel();
		expect(canFreezeRows(model, -1)).toBe(false);
		expect(canFreezeRows(model, 4)).toBe(false);
	});
});

describe('canFreezeCols', () => {
	it('rejects a count that would split a horizontal merge', () => {
		const model = baseModel();
		model.merges = [{ anchor: 'r_0.c_a', end: 'r_0.c_b' }]; // spans cols 0-1
		expect(canFreezeCols(model, 1)).toBe(false);
		expect(canFreezeCols(model, 0)).toBe(true);
		expect(canFreezeCols(model, 2)).toBe(true);
	});

	it('a merge confined to one column (however many rows) never blocks a column freeze', () => {
		const model = baseModel();
		model.merges = [{ anchor: 'r_0.c_a', end: 'r_2.c_a' }]; // vertical, single column
		expect(canFreezeCols(model, 1)).toBe(true);
	});
});

describe('set-freeze-rows / set-freeze-cols reducer', () => {
	it('sets freezeRows when valid', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-freeze-rows', count: 2 });
		expect(model.freezeRows).toBe(2);
	});

	it('leaves the model unchanged when the count would split a merge', () => {
		const model = baseModel();
		model.merges = [{ anchor: 'r_0.c_a', end: 'r_1.c_a' }];
		applyStructuralOpV2(model, { type: 'set-freeze-rows', count: 1 });
		expect(model.freezeRows).toBeUndefined();
	});

	it('null unfreezes rows', () => {
		const model = baseModel();
		model.freezeRows = 2;
		applyStructuralOpV2(model, { type: 'set-freeze-rows', count: null });
		expect(model.freezeRows).toBeUndefined();
	});

	it('set-freeze-cols mirrors the same behavior', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-freeze-cols', count: 1 });
		expect(model.freezeCols).toBe(1);

		applyStructuralOpV2(model, { type: 'set-freeze-cols', count: null });
		expect(model.freezeCols).toBeUndefined();
	});
});

describe('freezeRows/freezeCols round-trip through parse/serialize', () => {
	it('preserves 0 (a meaningful value: header-only frozen), not just truthy counts', () => {
		const model = baseModel();
		model.freezeRows = 0;
		model.freezeCols = 2;
		const reparsed = parseTable(serializeTable(model));
		expect(reparsed.freezeRows).toBe(0);
		expect(reparsed.freezeCols).toBe(2);
	});

	it('a table with no freeze fields at all round-trips without gaining them', () => {
		const model = baseModel();
		const reparsed = parseTable(serializeTable(model));
		expect(reparsed.freezeRows).toBeUndefined();
		expect(reparsed.freezeCols).toBeUndefined();
	});
});

describe('view width/height (manual view size)', () => {
	it('set-view-width/height store a rounded positive px value', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-view-width', width: 320.7 });
		applyStructuralOpV2(model, { type: 'set-view-height', height: 200.2 });
		expect(model.viewWidth).toBe(321);
		expect(model.viewHeight).toBe(200);
	});

	it('null (or non-positive) resets to auto by removing the field', () => {
		const model = baseModel();
		model.viewWidth = 300;
		model.viewHeight = 150;
		applyStructuralOpV2(model, { type: 'set-view-width', width: null });
		applyStructuralOpV2(model, { type: 'set-view-height', height: null });
		expect(model.viewWidth).toBeUndefined();
		expect(model.viewHeight).toBeUndefined();
	});

	it('round-trips through parse/serialize; absent stays absent (auto)', () => {
		const model = baseModel();
		model.viewWidth = 420;
		model.viewHeight = 260;
		const reparsed = parseTable(serializeTable(model));
		expect(reparsed.viewWidth).toBe(420);
		expect(reparsed.viewHeight).toBe(260);

		const bare = parseTable(serializeTable(baseModel()));
		expect(bare.viewWidth).toBeUndefined();
		expect(bare.viewHeight).toBeUndefined();
	});
});

describe('freeze survives operations that would invalidate it', () => {
	const model = (over: Partial<TableModelV2> = {}): TableModelV2 => ({
		version: 2,
		columns: [{ id: 'c_0', name: 'A' }, { id: 'c_1', name: 'B' }, { id: 'c_2', name: 'C' }],
		rows: [{ id: 'r_0', cells: {} }, { id: 'r_1', cells: {} }, { id: 'r_2', cells: {} }, { id: 'r_3', cells: {} }],
		merges: [],
		styles: [],
		...over,
	});

	// A freeze boundary can't cut through a merged cell, which is checked when the
	// count is set — but an operation performed later can invalidate it just as
	// easily, and nothing used to notice. The count stayed in the saved table while
	// the renderer quietly refused to apply it: the rows simply stopped being frozen.
	it('shrinks the frozen rows when a merge is made across the boundary', () => {
		const m = model({ freezeRows: 2 });
		expect(canFreezeRows(m, 2)).toBe(true);
		// r_1..r_2 are display rows 2..3, so a merge over them straddles a boundary
		// drawn after row 2.
		applyStructuralOpV2(m, { type: 'merge-cells', anchorRowId: 'r_1', anchorColId: 'c_0', endRowId: 'r_2', endColId: 'c_0' });
		// The merge is kept — it's what the user just asked for — and freeze gives way.
		expect(m.merges).toHaveLength(1);
		expect(m.freezeRows).toBe(1);
		expect(canFreezeRows(m, m.freezeRows!)).toBe(true);
	});

	it('shrinks the frozen columns likewise', () => {
		const m = model({ freezeCols: 2 });
		expect(canFreezeCols(m, 2)).toBe(true);
		applyStructuralOpV2(m, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_1', endRowId: 'r_0', endColId: 'c_2' });
		expect(m.merges).toHaveLength(1);
		expect(m.freezeCols).toBe(1);
		expect(canFreezeCols(m, m.freezeCols!)).toBe(true);
	});

	it('leaves a valid freeze alone', () => {
		// The merge sits entirely inside the frozen band, so nothing needs to give.
		const m = model({ freezeRows: 3 });
		applyStructuralOpV2(m, { type: 'merge-cells', anchorRowId: 'r_1', anchorColId: 'c_0', endRowId: 'r_2', endColId: 'c_0' });
		expect(m.freezeRows).toBe(3);
	});

	it('drops the setting entirely when no count would work', () => {
		// A merge starting at the very first data row leaves nothing to freeze but
		// the header, and for columns nothing at all.
		const m = model({ freezeCols: 1 });
		applyStructuralOpV2(m, { type: 'merge-cells', anchorRowId: 'r_0', anchorColId: 'c_0', endRowId: 'r_0', endColId: 'c_1' });
		expect(m.freezeCols).toBeUndefined();
	});

	it('reconciles after a split too, not just a merge', () => {
		// Splitting a cell grows the merges around it, which can push one past a
		// boundary — the reason this is reconciled centrally rather than per op.
		const m = model({ freezeRows: 2 });
		applyStructuralOpV2(m, { type: 'split-cell-row', rowId: 'r_1', colId: 'c_0' });
		if (m.freezeRows !== undefined) expect(canFreezeRows(m, m.freezeRows)).toBe(true);
	});
});
