import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2, findMergeCoveringCell } from '../src/operations';
import type { TableModelV2, MergeRangeV2 } from '../src/model';

// The merge bookkeeping of splitting a cell, done again here the way it was before the merges were indexed (every
// question to `findMergeCoveringCell`), as the thing the real reducer must agree with on any table.
const splitAnchor = (t: string): [string, string] => { const i = t.indexOf('.'); return [t.slice(0, i), t.slice(i + 1)]; };

function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

function randomTable(seed: number): TableModelV2 {
	const r = rng(seed);
	const nRows = 2 + Math.floor(r() * 9), nCols = 2 + Math.floor(r() * 5);
	const columns = Array.from({ length: nCols }, (_, c) => ({ id: c > 0 && r() < 0.06 ? `c_${c - 1}` : `c_${c}`, name: `C${c}` }));
	const rows = Array.from({ length: nRows }, (_, i) => ({ id: i > 0 && r() < 0.06 ? `r_${i - 1}` : `r_${i}`, cells: {} }));
	const row = () => (r() < 0.05 ? 'r_missing' : r() < 0.1 ? 'header' : `r_${Math.floor(r() * nRows)}`);
	const col = () => (r() < 0.05 ? 'c_missing' : `c_${Math.floor(r() * nCols)}`);
	// Reversed corners, one-cell merges, header merges, merges that share cells, merges naming what is not there.
	const merges: MergeRangeV2[] = Array.from({ length: Math.floor(r() * 7) }, () => ({ anchor: `${row()}.${col()}`, end: `${row()}.${col()}` }));
	return { version: 2, columns, rows, merges, styles: [] } as unknown as TableModelV2;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Ids the reducer makes are random; the new ones are compared by position instead. */
function shape(model: TableModelV2, fresh: Set<string>): unknown {
	const name = (id: string) => (fresh.has(id) ? 'NEW' : id);
	const t = (s: string) => { const [a, b] = splitAnchor(s); return `${name(a)}.${name(b)}`; };
	return {
		rows: model.rows.map(r => name(r.id)), columns: model.columns.map(c => name(c.id)),
		merges: model.merges.map(m => `${t(m.anchor)}>${t(m.end)}`),
	};
}

function ids(model: TableModelV2): Set<string> {
	return new Set([...model.rows.map(r => r.id), ...model.columns.map(c => c.id)]);
}

/** The reducer as it was: the covering merge asked for by a search of the merges for every row or column. */
function splitColBefore(model: TableModelV2, rowId: string, colId: string): void {
	const covering0 = findMergeCoveringCell(model, rowId, colId);
	if (covering0) return;
	const colIdx = model.columns.findIndex(c => c.id === colId);
	if (colIdx < 0) return;
	model.columns.splice(colIdx + 1, 0, { id: 'c_new', name: '' });
	for (const rId of ['header', ...model.rows.map(r => r.id)]) {
		if (rId === rowId) continue;
		const covering = findMergeCoveringCell(model, rId, colId);
		if (!covering) model.merges.push({ anchor: `${rId}.${colId}`, end: `${rId}.c_new` });
		else { const [er, ec] = splitAnchor(covering.end); if (ec === colId) covering.end = `${er}.c_new`; }
	}
}
function splitRowBefore(model: TableModelV2, rowId: string, colId: string): void {
	const covering0 = findMergeCoveringCell(model, rowId, colId);
	if (covering0) return;
	const rowIdx = rowId === 'header' ? -1 : model.rows.findIndex(r => r.id === rowId);
	if (rowId !== 'header' && rowIdx < 0) return;
	model.rows.splice(rowIdx + 1, 0, { id: 'r_new', cells: {} });
	for (const col of model.columns) {
		if (col.id === colId) continue;
		const covering = findMergeCoveringCell(model, rowId, col.id);
		if (!covering) model.merges.push({ anchor: `${rowId}.${col.id}`, end: `r_new.${col.id}` });
		else { const [er, ec] = splitAnchor(covering.end); if (er === rowId) covering.end = `r_new.${ec}`; }
	}
}

const rowIndex = (m: TableModelV2, id: string): number | undefined => (id === 'header' ? -1 : (m.rows.findIndex(r => r.id === id) >= 0 ? m.rows.findIndex(r => r.id === id) : undefined));

/** The merged-cell split as it was: eligible only for a one-row merge across columns (rows) or a one-column merge down rows (cols). */
function splitMergedBefore(model: TableModelV2, covering: MergeRangeV2, axis: 'split-cell-row' | 'split-cell-col'): void {
	const [aR, aC] = splitAnchor(covering.anchor), [eR, eC] = splitAnchor(covering.end);
	const r1 = rowIndex(model, aR), r2 = rowIndex(model, eR);
	const c1 = model.columns.findIndex(c => c.id === aC), c2 = model.columns.findIndex(c => c.id === eC);
	if (r1 === undefined || r2 === undefined || c1 < 0 || c2 < 0) return;
	if (axis === 'split-cell-row') {
		if (Math.abs(r2 - r1) + 1 > 1 || Math.abs(c2 - c1) + 1 <= 1) return;
		const rowIdx = aR === 'header' ? -1 : model.rows.findIndex(r => r.id === aR);
		if (aR !== 'header' && rowIdx < 0) return;
		model.rows.splice(rowIdx + 1, 0, { id: 'r_new', cells: {} });
		model.merges.push({ anchor: `r_new.${aC}`, end: `r_new.${eC}` });
		const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
		for (let ci = 0; ci < model.columns.length; ci++) {
			if (ci >= lo && ci <= hi) continue;
			const col = model.columns[ci];
			if (!col) continue;
			const other = findMergeCoveringCell(model, aR, col.id);
			if (!other) model.merges.push({ anchor: `${aR}.${col.id}`, end: `r_new.${col.id}` });
			else { const [oR, oC] = splitAnchor(other.end); if (oR === aR) other.end = `r_new.${oC}`; }
		}
	} else {
		if (Math.abs(c2 - c1) + 1 > 1 || Math.abs(r2 - r1) + 1 <= 1) return;
		const colIdx = model.columns.findIndex(c => c.id === aC);
		if (colIdx < 0) return;
		model.columns.splice(colIdx + 1, 0, { id: 'c_new', name: '' });
		model.merges.push({ anchor: `${aR}.c_new`, end: `${eR}.c_new` });
		const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
		for (const rId of ['header', ...model.rows.map(r => r.id)]) {
			const ri = rowIndex(model, rId);
			if (ri === undefined || (ri >= lo && ri <= hi)) continue;
			const other = findMergeCoveringCell(model, rId, aC);
			if (!other) model.merges.push({ anchor: `${rId}.${aC}`, end: `${rId}.c_new` });
			else { const [oR, oC] = splitAnchor(other.end); if (oC === aC) other.end = `${oR}.c_new`; }
		}
	}
}

describe('splitting a cell keeps the merges it always did', () => {
	for (const axis of ['split-cell-col', 'split-cell-row'] as const) {
		it(`${axis} leaves the merges as the search-per-row version did, on random tables`, () => {
			let compared = 0, withMerges = 0, covered = 0, reversed = 0, extended = 0;
			for (let seed = 1; seed <= 4000; seed++) {
				const base = randomTable(seed);
				const r = rng(seed * 7 + 1);
				const rowId = r() < 0.15 ? 'header' : r() < 0.05 ? 'r_missing' : `r_${Math.floor(r() * base.rows.length)}`;
				const colId = `c_${Math.floor(r() * base.columns.length)}`;
				// Only plain cells: one that a merge covers is split another way, which this does not touch.
				if (findMergeCoveringCell(base, rowId, colId)) { covered++; continue; }
				const expected = clone(base), actual = clone(base);
				(axis === 'split-cell-col' ? splitColBefore : splitRowBefore)(expected, rowId, colId);
				const known = ids(actual);
				applyStructuralOpV2(actual, { type: axis, rowId, colId } as never);
				const fresh = new Set([...ids(actual)].filter(i => !known.has(i)));
				const renamed = clone(actual);
				// The one new id the reducer made stands for the new row or column, which the oracle calls r_new / c_new.
				const expectedShape = shape(expected, new Set(['r_new', 'c_new']));
				expect(shape(renamed, fresh), `seed ${seed}`).toEqual(expectedShape);
				compared++;
				if (base.merges.length > 0) withMerges++;
				if (base.merges.some(m => { const [, a] = splitAnchor(m.anchor); const [, b] = splitAnchor(m.end); return a > b; })) reversed++;
				if (expected.merges.length > base.merges.length + 1) extended++;
			}
			// The comparison met what makes the lookup hard: merges to find, ranges written backwards, merges to add.
			expect(compared).toBeGreaterThan(2000);
			expect(withMerges).toBeGreaterThan(1000);
			expect(reversed).toBeGreaterThan(100);
			expect(extended).toBeGreaterThan(500);
			expect(covered).toBeGreaterThan(0);
		}, 60_000);
	}
});

describe('splitting a merged cell keeps the merges it always did', () => {
	for (const axis of ['split-cell-row', 'split-cell-col'] as const) {
		it(`${axis} on a one-row or one-column merge leaves the merges as the search-per-row version did`, () => {
			let compared = 0, split = 0;
			for (let seed = 1; seed <= 4000; seed++) {
				const base = randomTable(seed + 50_000);
				const r = rng(seed * 13 + 5);
				// A merge to split: wide for rows, tall for columns, its first cell the one asked about.
				const nR = base.rows.length, nC = base.columns.length;
				const ar = Math.floor(r() * nR), ac = Math.floor(r() * nC);
				const er = axis === 'split-cell-row' ? ar : Math.min(nR - 1, ar + 1 + Math.floor(r() * 3));
				const ec = axis === 'split-cell-col' ? ac : Math.min(nC - 1, ac + 1 + Math.floor(r() * 3));
				const mine: MergeRangeV2 = { anchor: `${base.rows[ar]!.id}.${base.columns[ac]!.id}`, end: `${base.rows[er]!.id}.${base.columns[ec]!.id}` };
				base.merges.unshift(mine);
				const [rowId, colId] = splitAnchor(mine.anchor);
				const expected = clone(base), actual = clone(base);
				const covering = findMergeCoveringCell(expected, rowId, colId);
				if (!covering) continue;
				splitMergedBefore(expected, covering, axis);
				const known = ids(actual);
				applyStructuralOpV2(actual, { type: axis, rowId, colId } as never);
				const fresh = new Set([...ids(actual)].filter(i => !known.has(i)));
				expect(shape(clone(actual), fresh), `seed ${seed}`).toEqual(shape(expected, new Set(['r_new', 'c_new'])));
				compared++;
				if (fresh.size > 0) split++;
			}
			expect(compared).toBeGreaterThan(2500);
			// Enough of them really split (were eligible), or the comparison would be of nothing happening.
			expect(split).toBeGreaterThan(800);
		}, 60_000);
	}
});
