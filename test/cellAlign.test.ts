/**
 * Per-cell/header-cell alignment, layered on top of the existing whole-column
 * default (`ColumnDefV2.align`, set via the column-selector strip's menu):
 *
 *  - resolveStylesV2/resolveHeaderStylesV2 (styleTarget.ts) now also resolve
 *    an `align` StyleRuleV2 property through the normal per-attribute cascade,
 *    falling back to the column's own `align` only when nothing more specific
 *    set one.
 *  - `set-align` (operations.ts) is a single-property upsert on whatever
 *    StyleRuleV2 already exists for a target — independent of set-cell-style/
 *    set-range-style's bg/color/etc, which it never touches.
 *  - `insert-row` copies a plain new row's cell-specific align from the row
 *    directly above it, column by column — but only an explicit per-cell
 *    override, never the column default (which the new row already tracks
 *    automatically via the fallback above, with no copying needed).
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import { resolveStylesV2, resolveHeaderStylesV2 } from '../src/styleTarget';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_0', name: 'A' },
			{ id: 'c_1', name: 'B', align: 'right' },
		],
		rows: [
			{ id: 'r_0', cells: { c_0: 'a0', c_1: 'b0' } },
			{ id: 'r_1', cells: { c_0: 'a1', c_1: 'b1' } },
		],
		merges: [],
		styles: [],
	};
}

describe('align resolution — column-default fallback', () => {
	it('a column with no align and no style rule resolves to no align', () => {
		const model = baseModel();
		expect(resolveStylesV2(model.styles, 'r_0', 'c_0', model).align).toBeUndefined();
	});

	it('a data cell falls back to its column\'s whole-column align', () => {
		const model = baseModel();
		expect(resolveStylesV2(model.styles, 'r_0', 'c_1', model).align).toBe('right');
	});

	it('the header cell also falls back to the column\'s whole-column align', () => {
		const model = baseModel();
		expect(resolveHeaderStylesV2(model.styles, 'c_1', model).align).toBe('right');
	});

	it('a cell-specific rule overrides the column default for that cell only', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_1', align: 'left' });
		expect(resolveStylesV2(model.styles, 'r_0', 'c_1', model).align).toBe('left');
		// The other row in the same column is untouched — still the column default.
		expect(resolveStylesV2(model.styles, 'r_1', 'c_1', model).align).toBe('right');
	});

	it('a header-cell-specific rule overrides the column default for the header only', () => {
		const model = baseModel();
		model.styles.push({ target: 'header.c_1', align: 'center' });
		expect(resolveHeaderStylesV2(model.styles, 'c_1', model).align).toBe('center');
		// Data rows in that column are untouched — still the column default.
		expect(resolveStylesV2(model.styles, 'r_0', 'c_1', model).align).toBe('right');
	});

	it('align cascades independently of bg — a range rule\'s bg still applies where a higher-priority cell rule only overrides align', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0:r_1', bg: '#eee', align: 'left' }); // row-range
		model.styles.push({ target: 'r_0.c_0', align: 'center' }); // cell-specific, higher priority
		const resolved = resolveStylesV2(model.styles, 'r_0', 'c_0', model);
		expect(resolved.align).toBe('center');
		expect(resolved.bg).toBe('#eee'); // untouched by the cell rule, still inherited from the range
	});
});

describe('set-align op', () => {
	it('creates a new rule for a target with no existing style', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-align', target: 'r_0.c_0', align: 'center' });
		expect(model.styles).toContainEqual({ target: 'r_0.c_0', align: 'center' });
	});

	it('sets align on an existing rule without touching its other properties', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_0', bg: '#fff', bold: true });
		applyStructuralOpV2(model, { type: 'set-align', target: 'r_0.c_0', align: 'right' });
		expect(model.styles).toContainEqual({ target: 'r_0.c_0', bg: '#fff', bold: true, align: 'right' });
	});

	it('clearing align on a rule that has other properties keeps the rule, drops only align', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_0', bg: '#fff', align: 'right' });
		applyStructuralOpV2(model, { type: 'set-align', target: 'r_0.c_0', align: null });
		expect(model.styles).toContainEqual({ target: 'r_0.c_0', bg: '#fff' });
	});

	it('clearing align on a rule that has ONLY align removes the rule entirely', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_0', align: 'right' });
		applyStructuralOpV2(model, { type: 'set-align', target: 'r_0.c_0', align: null });
		expect(model.styles.find(s => s.target === 'r_0.c_0')).toBeUndefined();
	});

	it('clearing align on a target with no rule at all is a no-op', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-align', target: 'r_0.c_0', align: null });
		expect(model.styles).toEqual([]);
	});

	it('works on a header-cell target', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-align', target: 'header.c_0', align: 'center' });
		expect(model.styles).toContainEqual({ target: 'header.c_0', align: 'center' });
	});

	it('works on a range target', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-align', target: 'r_0.c_0:r_1.c_0', align: 'left' });
		expect(model.styles).toContainEqual({ target: 'r_0.c_0:r_1.c_0', align: 'left' });
	});
});

describe('set-cell-style / set-range-style no longer clobber an unrelated align (regression)', () => {
	it('applying a new bg via set-cell-style preserves an existing align on the same cell', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_0', align: 'right' });
		applyStructuralOpV2(model, { type: 'set-cell-style', rowId: 'r_0', colId: 'c_0', bg: '#abc', color: null, size: null, bold: null, italic: null });
		expect(model.styles).toContainEqual({ target: 'r_0.c_0', bg: '#abc', align: 'right' });
	});

	it('clearing bg/color/etc via set-cell-style (all null) on a cell that ALSO has an align no longer silently deletes the align', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_0', bg: '#abc', align: 'right' });
		// Simulates unchecking the bg checkbox and clicking Apply — every OTHER
		// property was already unset, so this call is effectively "clear bg".
		applyStructuralOpV2(model, { type: 'set-cell-style', rowId: 'r_0', colId: 'c_0', bg: null, color: null, size: null, bold: null, italic: null });
		expect(model.styles).toContainEqual({ target: 'r_0.c_0', align: 'right' });
	});
});

describe('insert-row inherits align from the row above', () => {
	it('copies a cell-specific align from the row above onto the new row, per column', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_0', align: 'center' });
		applyStructuralOpV2(model, { type: 'insert-row', afterRowId: 'r_0' });
		const newRowId = model.rows[1]!.id;
		expect(model.styles).toContainEqual({ target: `${newRowId}.c_0`, align: 'center' });
	});

	it('does not copy a column\'s whole-column default — the new row already tracks it via the normal fallback', () => {
		const model = baseModel(); // c_1 has align: 'right' at the column level, no per-cell rule
		applyStructuralOpV2(model, { type: 'insert-row', afterRowId: 'r_0' });
		const newRowId = model.rows[1]!.id;
		expect(model.styles.find(s => s.target === `${newRowId}.c_1`)).toBeUndefined();
		// Still resolves correctly, via the column default, with no copied rule.
		const rowIdxNew = model.rows.findIndex(r => r.id === newRowId);
		expect(resolveStylesV2(model.styles, model.rows[rowIdxNew]!.id, 'c_1', model).align).toBe('right');
	});

	it('does not copy bg/color/bold/italic/size — only align was asked for', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_0', bg: '#abc', bold: true, align: 'left' });
		applyStructuralOpV2(model, { type: 'insert-row', afterRowId: 'r_0' });
		const newRowId = model.rows[1]!.id;
		expect(model.styles).toContainEqual({ target: `${newRowId}.c_0`, align: 'left' });
	});

	it('a row inserted with no row above it (afterRowId: null) has nothing to inherit from', () => {
		const model = baseModel();
		model.styles.push({ target: 'r_0.c_0', align: 'center' });
		applyStructuralOpV2(model, { type: 'insert-row', afterRowId: null });
		const newRowId = model.rows[0]!.id;
		expect(model.styles.find(s => s.target === `${newRowId}.c_0`)).toBeUndefined();
	});
});
