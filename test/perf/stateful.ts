/**
 * The operations that act on something the table must already have: a hidden row to show, a merge to take apart, a view
 * to switch to, a second sheet. Each names the table that has it (built from the plain one, with the state added),
 * one valid operation for the n-th repetition, and what to look for on the page to know the state is there.
 */
import type { TableOp, TableOpType } from '../../src/tableEdits';
import { tableSource, type ColumnKinds, type Evidence } from './tables';
import { MAX_REPS } from './ops';

export interface Stateful {
	source: (rows: number) => string;
	op: (i: number, rows: number) => TableOp;
	evidence?: readonly Evidence[];
}

const FIRST = 20;
const AGGS = ['sum', 'avg', 'min', 'max', 'count'] as const;
const rotated = <T,>(xs: readonly T[], by: number): T[] => xs.map((_, k) => xs[(k + by) % xs.length]!);

/** Puts top-level fields into a table source, above the closing rule of its front matter. */
function withFields(src: string, ...lines: string[]): string {
	const at = src.lastIndexOf('\n---\n| A |');
	return src.slice(0, at) + '\n' + lines.join('\n') + src.slice(at);
}

/** The lines of a table source's front matter, without its version line. */
const frontMatter = (src: string): string[] => {
	const lines = src.split('\n');
	return lines.slice(2, lines.indexOf('---', 1));
};

/** A workbook whose first sheet is the table of the given size, with other sheets (full size or small) beside it. */
function workbook(rows: number, extra: { id: string; big: boolean }[]): string {
	const sheet = (id: string, name: string, src: string) => [`  - id: ${id}`, `    name: ${name}`, ...frontMatter(src).map(l => '    ' + l)].join('\n');
	const big = tableSource(rows, 'plain'), small = tableSource(10, 'plain');
	const parts = [sheet('s_a', 'Main', big), ...extra.map(e => sheet(e.id, `Sheet ${e.id}`, e.big ? big : small))];
	return ['---', 'version: 3', 'active_sheet: s_a', 'sheets:', ...parts, '---', '| A |', '| --- |', ''].join('\n');
}

const choiceCols: ColumnKinds = { choice: [6, 7, 8, 9, 10, 11] };
const dateCols: ColumnKinds = { date: [3, 4, 5, 6, 7, 8] };
const viewsSource = (rows: number) => withFields(
	tableSource(rows, 'plain', { ...choiceCols, date: [3, 4, 5] }),
	'views:',
	'  - { id: v_1, type: kanban, kanban: { groupByColId: c_6 } }',
	'  - { id: v_2, type: calendar, calendar: { dateColId: c_3 } }',
	'  - { id: v_3, type: kanban, kanban: { groupByColId: c_7 } }',
	'  - { id: v_4, type: kanban, kanban: { groupByColId: c_8 } }',
	'  - { id: v_5, type: kanban, kanban: { groupByColId: c_9 } }',
	'  - { id: v_6, type: kanban, kanban: { groupByColId: c_10 } }',
);

export const STATEFUL: { [K in TableOpType]?: Stateful } = {
	'show-row-group': {
		source: rows => tableSource(rows, 'hidden'),
		op: i => ({ type: 'show-row-group', rowIds: [`r_${5 + 11 * i}`] }),
		evidence: [{ check: `document.querySelectorAll('.bt-row-indicator').length > 0`, what: 'hidden rows leave an indicator' }],
	},
	'show-col-group': {
		source: rows => tableSource(rows, 'plain', { hidden: [6, 7, 8, 9, 10] }),
		op: i => ({ type: 'show-col-group', colIds: [`c_${6 + i}`] }),
		evidence: [{ check: `document.querySelectorAll('.bt-col-indicator').length > 0`, what: 'hidden columns leave an indicator' }],
	},
	'merge-cells': {
		source: rows => tableSource(rows, 'plain'),
		op: i => ({ type: 'merge-cells', anchorRowId: `r_${FIRST + 4 * i}`, anchorColId: 'c_0', endRowId: `r_${FIRST + 4 * i + 1}`, endColId: 'c_1' }),
	},
	'unmerge-cells': {
		source: rows => withFields(tableSource(rows, 'plain'), 'merges:', ...Array.from({ length: MAX_REPS + 1 }, (_, i) => `  - { anchor: r_${FIRST + 4 * i}.c_0, end: r_${FIRST + 4 * i + 1}.c_1 }`)),
		op: i => ({ type: 'unmerge-cells', anchorRowId: `r_${FIRST + 4 * i}`, anchorColId: 'c_0' }),
		evidence: [{ check: `document.querySelectorAll('td[rowspan], td[colspan]').length > 0`, what: 'a merged cell is drawn' }],
	},
	'split-cell-row': {
		source: rows => tableSource(rows, 'plain'),
		op: i => ({ type: 'split-cell-row', rowId: `r_${FIRST + i}`, colId: 'c_3' }),
	},
	'split-cell-col': {
		source: rows => tableSource(rows, 'plain'),
		op: i => ({ type: 'split-cell-col', rowId: `r_${FIRST + i}`, colId: `c_${3 + i}` }),
	},
	'split-range-style': {
		source: rows => withFields(tableSource(rows, 'plain'), 'styles:', ...Array.from({ length: MAX_REPS + 1 }, (_, i) => `  - { target: "r_${FIRST + 12 * i}.c_0:r_${FIRST + 12 * i + 8}.c_3", bg: "#dcfce7" }`)),
		op: i => ({ type: 'split-range-style', rangeTarget: `r_${FIRST + 12 * i}.c_0:r_${FIRST + 12 * i + 8}.c_3`, excludeRowId: `r_${FIRST + 12 * i + 4}`, excludeColId: 'c_1' }),
		evidence: [{ check: `Array.from(document.querySelectorAll('td.bt-td')).some(e => e.style.backgroundColor !== '')`, what: 'a styled cell has its colour' }],
	},
	'clear-aggregate': {
		source: rows => tableSource(rows, 'aggregate').replace('aggregate: [sum, avg]', `aggregate: [${AGGS.join(', ')}]`),
		op: i => ({ type: 'clear-aggregate', agg: AGGS[i % AGGS.length]! }),
		evidence: [{ check: `document.querySelectorAll('tr[data-agg]').length >= 5`, what: 'five summary rows are drawn' }],
	},
	'reorder-aggregate': {
		source: rows => tableSource(rows, 'aggregate').replace('aggregate: [sum, avg]', `aggregate: [${AGGS.join(', ')}]`),
		op: i => ({ type: 'reorder-aggregate', order: rotated(AGGS, i + 1) }),
		evidence: [{ check: `document.querySelectorAll('tr[data-agg]').length >= 5`, what: 'five summary rows are drawn' }],
	},
	'create-view': {
		source: rows => tableSource(rows, 'plain', choiceCols),
		op: i => ({ type: 'create-view', viewType: 'kanban', groupByColId: `c_${6 + i}` }),
		evidence: [{ check: `document.querySelectorAll('.bt-choice').length > 0`, what: 'choice columns are drawn as pills' }],
	},
	'delete-view': {
		source: viewsSource,
		op: i => ({ type: 'delete-view', viewId: `v_${2 + i}` }),
	},
	'rename-view': {
		source: viewsSource,
		op: i => ({ type: 'rename-view', viewId: 'v_1', name: `Board ${i}` }),
	},
	// Opens on the table view: a block that opens on a board has no table for the harness to wait for.
	'set-view-group': {
		source: viewsSource,
		op: i => ({ type: 'set-view-group', viewId: 'v_1', groupByColId: `c_${7 + i}` }),
		evidence: [{ check: `document.querySelector('table.bt-table') !== null`, what: 'the table is drawn' }],
	},
	'set-view-date-col': {
		source: rows => withFields(tableSource(rows, 'plain', dateCols), 'views:', '  - { id: v_2, type: calendar, calendar: { dateColId: c_3 } }'),
		op: i => ({ type: 'set-view-date-col', viewId: 'v_2', dateColId: `c_${4 + i}` }),
		evidence: [{ check: `document.querySelector('table.bt-table') !== null`, what: 'the table is drawn' }],
	},
	'set-active-view': {
		source: viewsSource,
		op: i => ({ type: 'set-active-view', viewId: i % 2 === 0 ? 'v_1' : 'v_2' }),
	},
	'paste-values-with-header': {
		source: rows => tableSource(rows, 'plain'),
		op: i => ({ type: 'paste-values-with-header', anchorColId: 'c_0', values: [[`H${i}a`, `H${i}b`, `H${i}c`], [`x${i}`, 'y', 'z'], ['p', `q${i}`, 'r']] }),
	},
	'create-sheet': {
		source: rows => workbook(rows, [{ id: 's_b', big: false }]),
		op: () => ({ type: 'create-sheet' }),
		evidence: [{ check: `document.querySelector('.bt-sheet-tabbar') !== null`, what: 'the sheet tabs are drawn' }],
	},
	'delete-sheet': {
		source: rows => workbook(rows, ['s_c', 's_d', 's_e', 's_f', 's_g'].map(id => ({ id, big: false }))),
		op: i => ({ type: 'delete-sheet', sheetId: ['s_c', 's_d', 's_e', 's_f', 's_g'][i]! }),
	},
	'rename-sheet': {
		source: rows => workbook(rows, [{ id: 's_b', big: false }]),
		op: i => ({ type: 'rename-sheet', sheetId: 's_a', name: `Renamed ${i}` }),
	},
	'reorder-sheets': {
		source: rows => workbook(rows, ['s_b', 's_c', 's_d'].map(id => ({ id, big: false }))),
		op: i => ({ type: 'reorder-sheets', sheetIds: rotated(['s_a', 's_b', 's_c', 's_d'], i + 1) }),
	},
	'set-active-sheet': {
		source: rows => workbook(rows, [{ id: 's_b', big: true }]),
		op: i => ({ type: 'set-active-sheet', sheetId: i % 2 === 0 ? 's_b' : 's_a' }),
	},
	'set-sheet-tab-style': {
		source: rows => workbook(rows, [{ id: 's_b', big: false }]),
		op: i => ({ type: 'set-sheet-tab-style', sheetId: 's_a', tabColor: ['#e8f0fe', '#fef9c3', '#dcfce7', '#fee2e2', '#f3e8ff'][i % 5]!, tabTextColor: null }),
	},
};
