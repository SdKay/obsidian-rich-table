/**
 * transpose: a literal transpose of the whole grid (header included), then
 * the result's own first column is promoted to be the new header — old
 * column 0 becomes the new table's header text; every other old column
 * becomes a new row. See transposeModel's doc comment (operations.ts).
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_0', name: 'Name' },
			{ id: 'c_1', name: 'Age' },
			{ id: 'c_2', name: 'City' },
		],
		rows: [
			{ id: 'r_0', cells: { c_0: 'Alice', c_1: '30', c_2: 'NYC' } },
			{ id: 'r_1', cells: { c_0: 'Bob', c_1: '25', c_2: 'LA' } },
		],
		merges: [],
		styles: [],
	};
}

describe('transpose', () => {
	it('promotes old column 0 to the new header, and every other old column to a new row', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'transpose' });

		// Old column 0 (Name) -> the new header: 3 new columns (Name, Alice, Bob).
		expect(model.columns.map(c => c.name)).toEqual(['Name', 'Alice', 'Bob']);
		// Old columns 1, 2 (Age, City) -> 2 new rows.
		expect(model.rows).toHaveLength(2);

		const nameColId  = model.columns[0]!.id;
		const aliceColId = model.columns[1]!.id;
		const bobColId   = model.columns[2]!.id;
		const ageRow  = model.rows.find(r => r.cells[nameColId] === 'Age');
		const cityRow = model.rows.find(r => r.cells[nameColId] === 'City');
		expect(ageRow?.cells).toEqual({ [nameColId]: 'Age', [aliceColId]: '30', [bobColId]: '25' });
		expect(cityRow?.cells).toEqual({ [nameColId]: 'City', [aliceColId]: 'NYC', [bobColId]: 'LA' });
	});

	it('is its own inverse — transposing twice restores every value to its original cell', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'transpose' });
		applyStructuralOpV2(model, { type: 'transpose' });

		expect(model.columns.map(c => c.name)).toEqual(['Name', 'Age', 'City']);
		expect(model.rows).toHaveLength(2);
		const nameColId = model.columns[0]!.id;
		const ageColId  = model.columns[1]!.id;
		const cityColId = model.columns[2]!.id;
		const aliceRow = model.rows.find(r => r.cells[nameColId] === 'Alice');
		const bobRow   = model.rows.find(r => r.cells[nameColId] === 'Bob');
		expect(aliceRow?.cells).toEqual({ [nameColId]: 'Alice', [ageColId]: '30', [cityColId]: 'NYC' });
		expect(bobRow?.cells).toEqual({ [nameColId]: 'Bob', [ageColId]: '25', [cityColId]: 'LA' });
	});

	it('is stable under repeated application — always returns to (R, C) after two transposes, for any shape', () => {
		for (const [R, C] of [[2, 3], [4, 2], [1, 5], [3, 1]] as const) {
			const model: TableModelV2 = {
				version: 2,
				columns: Array.from({ length: C }, (_, j) => ({ id: `c_${j}`, name: `col${j}` })),
				rows: Array.from({ length: R }, (_, i) => ({ id: `r_${i}`, cells: {} as Record<string, string> })),
				merges: [], styles: [],
			};
			applyStructuralOpV2(model, { type: 'transpose' });
			applyStructuralOpV2(model, { type: 'transpose' });
			expect([model.rows.length, model.columns.length]).toEqual([R, C]);
		}
	});

	it('drops column type/filter and row formulas — nothing to carry them to', () => {
		const model = baseModel();
		model.columns[1]!.type = 'rating';
		model.columns[1]!.filter = ['30'];
		model.rows[0]!.formulas = { c_1: '=1+2' };
		applyStructuralOpV2(model, { type: 'transpose' });
		expect(model.columns.some(c => c.type)).toBe(false);
		expect(model.columns.some(c => c.filter)).toBe(false);
		expect(model.rows.some(r => r.formulas)).toBe(false);
	});

	it('drops sort/views/activeViewId/aggregate — all keyed to an old column identity', () => {
		const model = baseModel();
		model.sort = { colId: 'c_1', dir: 'asc' };
		model.views = [{ id: 'v_0', type: 'kanban', kanban: { groupByColId: 'c_1' } }];
		model.activeViewId = 'v_0';
		model.aggregate = ['sum'];
		applyStructuralOpV2(model, { type: 'transpose' });
		expect(model.sort).toBeUndefined();
		expect(model.views).toBeUndefined();
		expect(model.activeViewId).toBeUndefined();
		expect(model.aggregate).toBeUndefined();
	});

	it('maps freezeRows <-> freezeCols with the header/label-column offset', () => {
		// freezeRows=1 (header + 1 data row) -> new column-axis positions
		// 0..1 frozen -> freezeCols=2.
		const a = baseModel();
		a.freezeRows = 1;
		applyStructuralOpV2(a, { type: 'transpose' });
		expect(a.freezeCols).toBe(2);
		expect(a.freezeRows).toBeUndefined();

		// freezeCols=2 (old columns 0,1) -> column 0 becomes the header
		// (nothing to freeze as a row), column 1 becomes 1 new row -> freezeRows=1.
		const b = baseModel();
		b.freezeCols = 2;
		applyStructuralOpV2(b, { type: 'transpose' });
		expect(b.freezeRows).toBe(1);
		expect(b.freezeCols).toBeUndefined();
	});

	it('carries a hidden data row into a hidden new column, and a hidden non-label old column into a hidden new row', () => {
		const model = baseModel();
		model.rows[0]!.hidden = true;    // old row 0 (Alice)
		model.columns[1]!.hidden = true; // old column 1 (Age) — not the label column
		applyStructuralOpV2(model, { type: 'transpose' });
		// old row 0 -> new column 1 (new column 0 is the label/header-derived column).
		expect(model.columns[1]!.hidden).toBe(true);
		expect(model.columns[0]!.hidden).toBeFalsy();
		expect(model.columns[2]!.hidden).toBeFalsy();
		// old column 1 (Age) -> new row 0 (old column 0 became the header, not a row).
		expect(model.rows[0]!.hidden).toBe(true);
		expect(model.rows[1]!.hidden).toBeFalsy();
	});

	it('turns a vertical merge confined to non-label columns into a horizontal merge', () => {
		const model = baseModel();
		// City column (c_2) merged across both rows — neither corner touches column 0.
		model.merges.push({ anchor: 'r_0.c_2', end: 'r_1.c_2' });
		applyStructuralOpV2(model, { type: 'transpose' });

		expect(model.merges).toHaveLength(1);
		const m = model.merges[0]!;
		const [anchorRowId, anchorColId] = m.anchor.split('.');
		const [endRowId, endColId] = m.end.split('.');
		expect(anchorRowId).toBe(endRowId);
		expect(anchorColId).not.toBe(endColId);
		// The merge spans Alice's and Bob's columns on the City row (neither is
		// column 0, which holds the row's own "City" label, untouched by this merge).
		const cityRow = model.rows.find(r => r.id === anchorRowId);
		const nameColId = model.columns[0]!.id;
		expect(cityRow?.cells[nameColId]).toBe('City');
		expect(cityRow?.cells[anchorColId!]).toBe('NYC');
	});

	it('maps a merge/style with a corner inside old column 0 onto the new header, rather than dropping it', () => {
		const model = baseModel();
		// header.c_0 -> r_0.c_0: old column 0 (Name), header down to Alice's row.
		model.merges.push({ anchor: 'header.c_0', end: 'r_0.c_0' });
		model.styles = [
			{ target: 'c_0', bg: '#111111' },        // whole old column 0
			{ target: 'header.c_0', bg: '#222222' }, // old column 0's header cell
			{ target: 'r_0.c_0', bg: '#333333' },    // old column 0's data cell (Alice)
		];
		applyStructuralOpV2(model, { type: 'transpose' });

		const nameColId  = model.columns[0]!.id;
		const aliceColId = model.columns[1]!.id;

		// Old column 0 -> the new header; both corners of the merge land there
		// too — a horizontal merge WITHIN the new header row.
		expect(model.merges).toHaveLength(1);
		expect(model.merges[0]).toEqual({ anchor: `header.${nameColId}`, end: `header.${aliceColId}` });

		expect(model.styles).toHaveLength(3);
		// 'c_0' (whole old column) -> the whole new header row.
		expect(model.styles.find(s => s.bg === '#111111')?.target).toBe('header');
		// 'header.c_0' (old column 0's own header cell) -> new header cell at new column 0.
		expect(model.styles.find(s => s.bg === '#222222')?.target).toBe(`header.${nameColId}`);
		// 'r_0.c_0' (old column 0's cell at Alice's row) -> new header cell at Alice's new column.
		expect(model.styles.find(s => s.bg === '#333333')?.target).toBe(`header.${aliceColId}`);
	});

	// A table combining a header-row horizontal merge, a vertical merge on
	// column 2 reaching down through two data rows, a horizontal merge on the
	// last data row, and a second vertical merge confined to old column 0
	// alone — every merge here has at least one corner in old column 0.
	it('preserves every merge, correctly transposed, for a table combining header and column-0 merges', () => {
		const model: TableModelV2 = {
			version: 2,
			columns: [
				{ id: 'c_0', name: '1' },
				{ id: 'c_1', name: '' },
				{ id: 'c_2', name: '2' },
			],
			rows: [
				{ id: 'r_0', cells: {} },
				{ id: 'r_1', cells: {} },
				{ id: 'r_2', cells: { c_0: '3', c_2: '4' } },
			],
			merges: [
				{ anchor: 'header.c_2', end: 'r_1.c_2' },    // vertical: column 2, header through row1
				{ anchor: 'header.c_0', end: 'header.c_1' }, // horizontal: header row, columns 0-1
				{ anchor: 'r_2.c_0', end: 'r_2.c_1' },       // horizontal: row2, columns 0-1
				{ anchor: 'r_0.c_0', end: 'r_1.c_0' },       // vertical: column 0, rows 0-1
			],
			styles: [],
		};
		applyStructuralOpV2(model, { type: 'transpose' });

		// Old column 0 ("1") -> new header; old columns 1, 2 -> 2 new rows.
		expect(model.columns.map(c => c.name)).toEqual(['1', '', '', '3']);
		expect(model.rows).toHaveLength(2);
		expect(model.merges).toHaveLength(4);

		const col0 = model.columns[0]!.id; // "1" — the header-derived column
		const col1 = model.columns[1]!.id; // old row 0
		const col2 = model.columns[2]!.id; // old row 1
		const col3 = model.columns[3]!.id; // old row 2 — its column-0 value, "3"
		const row0 = model.rows.find(r => Object.keys(r.cells).length === 0)!.id; // old column 1 ("")
		const row1 = model.rows.find(r => r.cells[col0] === '2')!.id;             // old column 2 ("2")

		// header.c_2 -> r_1.c_2 (column 2, header through row1) -> a horizontal
		// merge on row1 (old column 2's own row), from the header-derived
		// column across to old row1's column.
		expect(model.merges).toContainEqual({ anchor: `${row1}.${col0}`, end: `${row1}.${col2}` });
		// header.c_0 -> header.c_1 (header row, columns 0-1) -> a vertical merge
		// from the new header down to row0 (old column 1's row), at column 0.
		expect(model.merges).toContainEqual({ anchor: `header.${col0}`, end: `${row0}.${col0}` });
		// r_2.c_0 -> r_2.c_1 (row2, columns 0-1) -> a vertical merge from the
		// new header down to row0, at column 3 (old row2's column-0 value, "3").
		expect(model.merges).toContainEqual({ anchor: `header.${col3}`, end: `${row0}.${col3}` });
		// r_0.c_0 -> r_1.c_0 (column 0, rows 0-1) -> a horizontal merge WITHIN
		// the new header row, spanning columns 1-2 (old rows 0 and 1).
		expect(model.merges).toContainEqual({ anchor: `header.${col1}`, end: `header.${col2}` });
	});

	it('remaps every other style-target kind to its transposed equivalent', () => {
		const model = baseModel();
		model.styles = [
			{ target: 'header', bg: '#111111' },          // whole header row
			{ target: 'header.c_1', bg: '#222222' },       // single header cell (Age)
			{ target: 'r_0', bg: '#333333' },               // whole data row (Alice)
			{ target: 'c_1', bg: '#444444' },               // whole column (Age)
			{ target: 'r_0.c_1', bg: '#555555' },           // single cell (Alice's Age)
			{ target: 'header.c_1:r_1.c_1', bg: '#666666' }, // rect (Age column, header through Bob)
		];
		applyStructuralOpV2(model, { type: 'transpose' });
		expect(model.styles).toHaveLength(6);

		const nameColId  = model.columns[0]!.id; // the header-derived column
		const aliceColId = model.columns[1]!.id;
		const bobColId   = model.columns[2]!.id;
		const ageRowId   = model.rows.find(r => r.cells[nameColId] === 'Age')!.id;

		// 'header' (whole header row) -> whole new COLUMN style on the header-derived column.
		expect(model.styles.find(s => s.bg === '#111111')?.target).toBe(nameColId);
		// 'header.c_1' (Age's header cell) -> single cell at (Age row, header-derived col).
		expect(model.styles.find(s => s.bg === '#222222')?.target).toBe(`${ageRowId}.${nameColId}`);
		// 'r_0' (Alice's whole row) -> whole new COLUMN style on Alice's column.
		expect(model.styles.find(s => s.bg === '#333333')?.target).toBe(aliceColId);
		// 'c_1' (whole Age column) -> whole new ROW style on Age's row.
		expect(model.styles.find(s => s.bg === '#444444')?.target).toBe(ageRowId);
		// 'r_0.c_1' (Alice's Age cell) -> single cell at (Age row, Alice col).
		expect(model.styles.find(s => s.bg === '#555555')?.target).toBe(`${ageRowId}.${aliceColId}`);
		// rect header.c_1:r_1.c_1 (Age column, header through Bob) -> rect
		// spanning Age's row from the header-derived column to Bob's column.
		const rect = model.styles.find(s => s.bg === '#666666')!.target;
		expect(rect).toBe(`${ageRowId}.${nameColId}:${ageRowId}.${bobColId}`);
	});
});
