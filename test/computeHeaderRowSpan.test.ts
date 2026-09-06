/**
 * computeHeaderRowSpan: how many leading display rows (header + any data rows
 * a header-anchored merge reaches into) must be hosted in <thead> rather than
 * <tbody> — see its own doc comment in renderGridHelpers.ts for why this is
 * necessary at all (rowspan cannot cross a thead/tbody boundary).
 */
import { describe, it, expect } from 'vitest';
import { computeHeaderRowSpan } from '../src/renderGridHelpers';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_0', name: 'A' },
			{ id: 'c_1', name: 'B' },
		],
		rows: [
			{ id: 'r_0', cells: { c_0: 'a0', c_1: 'b0' } },
			{ id: 'r_1', cells: { c_0: 'a1', c_1: 'b1' } },
		],
		merges: [],
		styles: [],
	};
}

describe('computeHeaderRowSpan', () => {
	it('is 1 with no merges at all', () => {
		expect(computeHeaderRowSpan(baseModel())).toBe(1);
	});

	it('is 1 for a purely horizontal header merge (no vertical extent)', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_0', end: 'header.c_1' });
		expect(computeHeaderRowSpan(model)).toBe(1);
	});

	it('is 2 when a header merge reaches into the first data row', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_1', end: 'r_0.c_1' });
		expect(computeHeaderRowSpan(model)).toBe(2);
	});

	it('is 3 when a header merge reaches into the second data row', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_1', end: 'r_1.c_1' });
		expect(computeHeaderRowSpan(model)).toBe(3);
	});

	it('takes the max across multiple header-anchored merges', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_2', name: 'C' });
		model.rows.forEach(r => { r.cells.c_2 = ''; });
		model.merges.push({ anchor: 'header.c_1', end: 'r_0.c_1' }); // reaches row 1
		model.merges.push({ anchor: 'header.c_2', end: 'r_1.c_2' }); // reaches row 2 — the max
		expect(computeHeaderRowSpan(model)).toBe(3);
	});

	it('ignores a merge that does not touch the header at all', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'r_0.c_1', end: 'r_1.c_1' }); // ordinary data-row merge
		expect(computeHeaderRowSpan(model)).toBe(1);
	});
});
