/**
 * paste-values (anchored on a DATA cell, fills cell values only) and
 * paste-values-with-header (anchored on a HEADER cell — table-format
 * conversion: values[0] becomes column names, values[1..] become data rows
 * starting at the table's first row). Neither had direct test coverage
 * before — both grow rows/columns as needed from the anchor, same pattern as
 * every other grid-mutating op in operations.ts.
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
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

describe('paste-values', () => {
	it('fills cell values starting at the anchor, leaving other cells untouched', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'paste-values', anchorRowId: 'r_0', anchorColId: 'c_0', values: [['x', 'y']] });
		expect(model.rows[0]!.cells).toEqual({ c_0: 'x', c_1: 'y' });
		expect(model.rows[1]!.cells).toEqual({ c_0: 'a1', c_1: 'b1' });
	});

	it('grows rows and columns past the current table size', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'paste-values', anchorRowId: 'r_1', anchorColId: 'c_1', values: [['b1v', 'c1v'], ['b2v', 'c2v']] });
		expect(model.rows).toHaveLength(3);
		expect(model.columns).toHaveLength(3);
		const newCol = model.columns[2]!;
		expect(model.rows[1]!.cells).toMatchObject({ c_1: 'b1v', [newCol.id]: 'c1v' });
		expect(model.rows[2]!.cells).toMatchObject({ c_1: 'b2v', [newCol.id]: 'c2v' });
	});

	it('an empty pasted string clears an existing cell rather than writing an empty string', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'paste-values', anchorRowId: 'r_0', anchorColId: 'c_0', values: [['']] });
		expect(model.rows[0]!.cells).toEqual({ c_1: 'b0' });
	});

	it('a no-op anchor (unknown row/col id) leaves the model untouched', () => {
		const model = baseModel();
		const before = JSON.parse(JSON.stringify(model));
		applyStructuralOpV2(model, { type: 'paste-values', anchorRowId: 'nope', anchorColId: 'c_0', values: [['x']] });
		expect(model.rows).toEqual(before.rows);
	});
});

describe('paste-values-with-header', () => {
	it('sets column names from the first row and data from the rest, starting at row 0', () => {
		const model = baseModel();
		applyStructuralOpV2(model, {
			type: 'paste-values-with-header', anchorColId: 'c_0',
			values: [['Name', 'Age'], ['Alice', '30'], ['Bob', '25']],
		});
		expect(model.columns[0]!.name).toBe('Name');
		expect(model.columns[1]!.name).toBe('Age');
		expect(model.rows[0]!.cells).toEqual({ c_0: 'Alice', c_1: '30' });
		expect(model.rows[1]!.cells).toEqual({ c_0: 'Bob', c_1: '25' });
	});

	it('grows columns when the pasted header is wider than the table, and rows when there are more data rows than exist', () => {
		const model = baseModel();
		applyStructuralOpV2(model, {
			type: 'paste-values-with-header', anchorColId: 'c_0',
			values: [['A', 'B', 'C'], ['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']],
		});
		expect(model.columns).toHaveLength(3);
		expect(model.columns[2]!.name).toBe('C');
		expect(model.rows).toHaveLength(3);
		expect(model.rows[2]!.cells[model.columns[2]!.id]).toBe('9');
	});

	it('starting at a non-first column only renames/fills columns from the anchor onward', () => {
		const model = baseModel();
		applyStructuralOpV2(model, {
			type: 'paste-values-with-header', anchorColId: 'c_1',
			values: [['Renamed'], ['x']],
		});
		expect(model.columns[0]!.name).toBe('A'); // untouched
		expect(model.columns[1]!.name).toBe('Renamed');
		expect(model.rows[0]!.cells).toEqual({ c_0: 'a0', c_1: 'x' });
	});

	it('overwrites existing data rows rather than inserting new ones when rows already exist', () => {
		const model = baseModel();
		applyStructuralOpV2(model, {
			type: 'paste-values-with-header', anchorColId: 'c_0',
			values: [['A', 'B'], ['new-a0', 'new-b0']],
		});
		expect(model.rows).toHaveLength(2); // no new row appended past the pasted single data row
		expect(model.rows[0]!.cells).toEqual({ c_0: 'new-a0', c_1: 'new-b0' });
		expect(model.rows[1]!.cells).toEqual({ c_0: 'a1', c_1: 'b1' }); // untouched
	});

	it('a no-op anchor (unknown column id) leaves the model untouched', () => {
		const model = baseModel();
		const before = JSON.parse(JSON.stringify(model));
		applyStructuralOpV2(model, { type: 'paste-values-with-header', anchorColId: 'nope', values: [['x']] });
		expect(model.columns).toEqual(before.columns);
		expect(model.rows).toEqual(before.rows);
	});
});
