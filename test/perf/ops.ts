/**
 * One valid operation of each kind for the tables of tables.ts, for the n-th repetition. Repeating the same operation
 * changes the note only the first time, so each repetition acts on something else: another row, another cell, another
 * value. The table has rows r_0.. and columns c_0..c_11, and an operation never needs more than `reps` rows.
 *
 * Operations are chosen so that none depends on an earlier one having been undone, which keeps every repetition valid
 * and independent of the table's features.
 */
import type { TableOp, TableOpType } from '../../src/tableEdits';

/** The first row and column an operation may act on; the first rows are left alone, being where features sit. */
const FIRST = 20;
const COLS = 12;
/** Repetitions the largest index below allows: row FIRST + 60 + 2 * 4 is the furthest any operation reaches. */
export const MAX_REPS = 4;
/** The fewest rows a table needs for every operation here to act on a row that exists. */
export const MIN_ROWS = FIRST + 60 + 2 * MAX_REPS + 4;

type Make = (i: number, rows: number) => TableOp;

/**
 * Operations that change what they find each time they are applied, so the same one can follow itself: switches, and
 * the transpose, which swaps rows and columns back and forth, and a new sheet, which is a different one each time. Any other, applied twice with the same values, sets what
 * is already set and writes nothing.
 */
export const FLIPS: ReadonlySet<string> = new Set(['toggle-lock', 'toggle-collapse', 'toggle-aggregate', 'transpose', 'create-sheet']);

const r = (i: number, rows: number) => `r_${FIRST + (i % Math.max(1, rows - FIRST - 8))}`;
const c = (i: number) => `c_${i % COLS}`;
const style = { bg: '#ffeeaa', color: null, size: null, bold: true, italic: null };
const AGGS = ['sum', 'avg', 'min', 'max', 'count'] as const;

/**
 * Only the operations that can be written for any table without knowing what is in it. The rest need a table in a
 * state first (stateful.ts).
 */
export const OPS: { [K in TableOpType]?: Make } = {
	'insert-row': (i, n) => ({ type: 'insert-row', afterRowId: r(i, n) }),
	'delete-row': (i, n) => ({ type: 'delete-row', rowId: `r_${FIRST + i}` }),
	'move-row': (i, n) => ({ type: 'move-row', fromRowId: `r_${FIRST + i}`, toRowId: `r_${FIRST + 40 + i}` }),
	'move-rows': (i, n) => ({ type: 'move-rows', rowIds: [`r_${FIRST + i * 2}`, `r_${FIRST + i * 2 + 1}`], beforeRowId: `r_${FIRST + 60 + i}` }),
	'hide-row': (i, n) => ({ type: 'hide-row', rowId: `r_${FIRST + i}` }),
	'insert-col': (i) => ({ type: 'insert-col', afterColId: c(i) }),
	'delete-col': (i) => ({ type: 'delete-col', colId: `c_${6 + i}` }),
	'move-col': (i) => ({ type: 'move-col', fromColId: `c_${6 + i}`, toColId: 'c_0' }),
	'move-cols': (i) => ({ type: 'move-cols', colIds: [`c_${6 + i}`, `c_${7 + i}`], beforeColId: 'c_0' }),
	'hide-col': (i) => ({ type: 'hide-col', colId: `c_${6 + i}` }),
	'set-cell-content': (i, n) => ({ type: 'set-cell-content', rowId: r(i, n), colId: c(i + 3), value: `edited ${i}` }),
	'fill-cells': (i, n) => ({ type: 'fill-cells', cells: [0, 1, 2, 3].map(k => ({ rowId: `r_${FIRST + i * 4 + k}`, colId: 'c_8' })), values: ['a', 'b', 'c', 'd'].map(x => x + i) }),
	'set-cell-formula': (i, n) => ({ type: 'set-cell-formula', rowId: `r_${FIRST + i}`, colId: 'c_9', formula: `=r_${FIRST + i}.c_4*${i + 2}` }),
	'paste-values': (i, n) => ({ type: 'paste-values', anchorRowId: `r_${FIRST + i * 3}`, anchorColId: 'c_6', values: [[`p${i}`, 'q'], ['r', 's']] }),
	'set-col-name': (i) => ({ type: 'set-col-name', colId: c(i), name: `Name ${i}` }),
	'set-col-type': (i) => ({ type: 'set-col-type', colId: `c_${6 + i}`, colType: 'task-status' }),
	'set-col-width': (i) => ({ type: 'set-col-width', colId: 'c_3', width: 100 + i }),
	'set-col-align': (i) => ({ type: 'set-col-align', colId: c(i), align: (['left', 'center', 'right'] as const)[i % 3]! }),
	// Flip back and forth: each repetition changes the note.
	'set-col-wrap': (i) => ({ type: 'set-col-wrap', colId: 'c_3', wrap: i % 2 === 0 ? false : null }),
	'set-table-wrap': (i) => ({ type: 'set-table-wrap', wrap: i % 2 === 0 ? false : null }),
	'set-row-height': (i, n) => ({ type: 'set-row-height', rowId: r(i, n), height: 30 + i }),
	'set-cell-style': (i, n) => ({ type: 'set-cell-style', rowId: r(i, n), colId: c(i), ...style, size: 12 + i }),
	'set-range-style': (i, n) => ({ type: 'set-range-style', target: `${r(i, n)}.${c(i)}:${r(i + 1, n)}.${c(i + 1)}`, ...style, size: 12 + i }),
	'set-align': (i, n) => ({ type: 'set-align', target: `${r(i, n)}.${c(i)}`, align: (['left', 'center', 'right'] as const)[i % 3]! }),
	'set-title': (i) => ({ type: 'set-title', title: `Title ${i}` }),
	'set-footer': (i) => ({ type: 'set-footer', footer: `Footer ${i}` }),
	'set-theme': (i) => ({ type: 'set-theme', theme: i % 2 ? 'grid' : 'academic' }),
	'toggle-collapse': () => ({ type: 'toggle-collapse' }),
	// Between 1 and 2: every table here takes them (a freeze line cannot cut a merge, and the merges of the combined
	// table rule out the counts from 3 to 10), and the freeze feature starts at 2, so the first repetition changes it too.
	'set-freeze-rows': (i) => ({ type: 'set-freeze-rows', count: i % 2 ? 2 : 1 }),
	'set-freeze-cols': (i) => ({ type: 'set-freeze-cols', count: i % 2 ? 2 : 1 }),
	'set-view-width': (i) => ({ type: 'set-view-width', width: 800 + i * 7 }),
	'set-view-height': (i) => ({ type: 'set-view-height', height: 400 + i * 7 }),
	'set-status-bar-mode': (i) => ({ type: 'set-status-bar-mode', mode: i % 2 ? 'pinned' : 'hover' }),
	'set-status-bar-scroll-width': (i) => ({ type: 'set-status-bar-scroll-width', width: 120 + i * 5 }),
	'set-zoom': (i) => ({ type: 'set-zoom', percent: 90 + i * 5 }),
	// The filter keeps what a table's own filter feature keeps: two rows in three (column 1 holds `keep` or `drop`), so
	// the table stays large after it. Each repetition adds one more value that is not in the column, which changes the
	// note (also on the table whose own filter is just `keep`) without changing what is drawn.
	'set-filter': (i) => ({ type: 'set-filter', colId: 'c_1', values: ['keep', ...Array.from({ length: i + 1 }, (_, k) => `none-${k}`)] }),
	'toggle-aggregate': (i) => ({ type: 'toggle-aggregate', agg: AGGS[i % AGGS.length]! }),
	'toggle-lock': () => ({ type: 'toggle-lock' }),
	// A whole permutation of the rows (the operation ignores a list that is not one), turned a little further each time.
	'reorder-rows': (i, n) => ({ type: 'reorder-rows', rowIds: Array.from({ length: n }, (_, k) => `r_${(k + i + 1) % n}`) }),
	'transpose': () => ({ type: 'transpose' }),
	'set-sort': (i) => ({ type: 'set-sort', sort: { colId: c(i + 4), dir: i % 2 ? 'asc' : 'desc' } }),
};
