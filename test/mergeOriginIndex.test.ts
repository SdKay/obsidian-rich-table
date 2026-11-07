import { describe, it, expect } from 'vitest';
import { getMergeOrigin, mergeOriginIndex } from '../src/renderGridHelpers';
import type { TableModelV2 } from '../src/model';

// A small deterministic generator, so a failing table can be rebuilt from its seed.
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

function randomTable(seed: number): TableModelV2 {
	const r = rng(seed);
	const nRows = 1 + Math.floor(r() * 14);
	const nCols = 1 + Math.floor(r() * 7);
	const columns = Array.from({ length: nCols }, (_, c) => ({
		id: `c_${c}`, name: `C${c}`, ...(r() < 0.15 ? { hidden: true } : {}),
		...(r() < 0.2 ? { filter: ['keep'] } : {}),
	}));
	const rows = Array.from({ length: nRows }, (_, i) => ({
		id: `r_${i}`,
		cells: Object.fromEntries(columns.map(c => [c.id, r() < 0.7 ? 'keep' : 'drop'])),
		...(r() < 0.2 ? { hidden: true } : {}),
	}));
	const pickRow = () => r() < 0.12 ? 'header' : r() < 0.04 ? 'r_missing' : `r_${Math.floor(r() * nRows)}`;
	const pickCol = () => r() < 0.04 ? 'c_missing' : `c_${Math.floor(r() * nCols)}`;
	const merges = Array.from({ length: Math.floor(r() * 7) }, () => {
		const a = r() < 0.05 ? 'no-dot' : `${pickRow()}.${pickCol()}`;
		const e = r() < 0.05 ? 'no-dot' : `${pickRow()}.${pickCol()}`;
		return { anchor: a, end: e };
	});
	return { version: 2, columns, rows, merges, styles: [] } as unknown as TableModelV2;
}

describe('mergeOriginIndex', () => {
	it('answers every cell of every table exactly as getMergeOrigin does, hidden, filtered, overlapping and invalid merges included', () => {
		let cells = 0, withMerge = 0;
		for (let seed = 1; seed <= 2500; seed++) {
			const model = randomTable(seed);
			const index = mergeOriginIndex(model);
			for (let row = 0; row <= model.rows.length; row++) {
				for (let col = 0; col < model.columns.length; col++) {
					const want = getMergeOrigin(row, col, model);
					const got = index.at(row, col);
					cells++;
					if (want) withMerge++;
					expect(got, `seed ${seed} cell ${row},${col}`).toEqual(want);
				}
			}
		}
		// The comparison must have met merges, or it proved nothing.
		expect(cells).toBeGreaterThan(20000);
		expect(withMerge).toBeGreaterThan(500);
	});

	it('answers undefined outside the table', () => {
		const model = randomTable(7);
		const index = mergeOriginIndex(model);
		expect(index.at(model.rows.length + 5, 0)).toBeUndefined();
		expect(index.at(0, model.columns.length + 5)).toBeUndefined();
		expect(index.at(-1, 0)).toBeUndefined();
	});

	it('a column past the last one is not the first column of the next row', () => {
		// Keys are row * width + col, so column 2 of row 1 in a two-column table would be column 0 of row 2.
		const model = { version: 2, columns: [{ id: 'c_0', name: 'A' }, { id: 'c_1', name: 'B' }],
			rows: [{ id: 'r_0', cells: {} }, { id: 'r_1', cells: {} }, { id: 'r_2', cells: {} }],
			merges: [{ anchor: 'r_1.c_0', end: 'r_2.c_0' }], styles: [] } as unknown as TableModelV2;
		const index = mergeOriginIndex(model);
		expect(index.at(2, 0)).toBeDefined();
		expect(index.at(1, 2)).toBeUndefined();
		expect(index.at(1, 2)).toEqual(getMergeOrigin(1, 2, model));
	});

	it('with two merges whose effective anchor is the same cell, the first listed wins, as before', () => {
		const model = { version: 2, columns: [{ id: 'c_0', name: 'A' }, { id: 'c_1', name: 'B' }],
			rows: [{ id: 'r_0', cells: {} }, { id: 'r_1', cells: {} }, { id: 'r_2', cells: {} }],
			merges: [{ anchor: 'r_0.c_0', end: 'r_0.c_1' }, { anchor: 'r_0.c_0', end: 'r_2.c_0' }], styles: [] } as unknown as TableModelV2;
		expect(mergeOriginIndex(model).at(1, 0)).toEqual(getMergeOrigin(1, 0, model));
		expect(mergeOriginIndex(model).at(1, 0)?.endCol).toBe(1);
	});
});
