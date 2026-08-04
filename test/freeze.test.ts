/**
 * freezeRows/freezeCols — freezes a position (header + first N data rows /
 * first N columns), not a set of row/column IDs, matching Excel's own freeze
 * panes semantics: reordering changes which rows/columns end up in the
 * frozen region, the count itself doesn't move.
 *
 * A freeze boundary that would split a merge across it is rejected outright
 * (model left unchanged) rather than silently adjusted — see canFreezeRows/
 * canFreezeCols in operations.ts. Only the axis being frozen matters: a
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
