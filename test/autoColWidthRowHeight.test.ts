/**
 * set-col-width / set-row-height: a width/height of 0 (or below) CLEARS the
 * field entirely rather than storing a literal 0 — a column/row with no
 * width/height of its own is "auto" (tracks its own content on every
 * render), which is a different thing from "explicitly pinned to 0px".
 *
 * This is checked directly against the reducer's own model output, not just
 * through a serialize/reprocess round trip: serializeTable's `if (c.width)`
 * (falsy-check) happens to make a lingering `col.width = 0` serialize
 * identically to a deleted field, so an e2e test that only reads the
 * rewritten note's text or the eventually-rendered pixel width cannot tell
 * "deleted" apart from "set to 0" — only a direct assertion on the model
 * object right after the reducer runs can.
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [{ id: 'c_0', name: 'A', width: 200 }],
		rows: [{ id: 'r_0', cells: { c_0: 'x' }, height: 80 }],
	};
}

describe('set-col-width', () => {
	it('a positive width sets the field', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-col-width', colId: 'c_0', width: 150 });
		expect(model.columns[0]!.width).toBe(150);
	});

	it('a width of 0 deletes the field rather than storing a literal 0', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-col-width', colId: 'c_0', width: 0 });
		expect(model.columns[0]!.width).toBeUndefined();
		expect('width' in model.columns[0]!).toBe(false);
	});

	it('a negative width also clears the field', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-col-width', colId: 'c_0', width: -10 });
		expect(model.columns[0]!.width).toBeUndefined();
	});
});

describe('set-row-height', () => {
	it('a positive height sets the field', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-row-height', rowId: 'r_0', height: 60 });
		expect(model.rows[0]!.height).toBe(60);
	});

	it('a height of 0 deletes the field rather than storing a literal 0', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-row-height', rowId: 'r_0', height: 0 });
		expect(model.rows[0]!.height).toBeUndefined();
		expect('height' in model.rows[0]!).toBe(false);
	});
});
