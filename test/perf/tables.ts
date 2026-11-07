/**
 * Tables of a chosen size with one feature switched on at a time, so that a cost can be put on a feature. The source
 * is built as YAML text and goes through the real parser. Each feature also names the evidence that it took effect
 * on the page, which a scenario checks before it measures: a feature that quietly did nothing would pass for fast.
 */
export const COLS = 12;
/** Rows and columns frozen by the freeze feature. */
const FREEZE = 2;

export type Feature =
	| 'plain' | 'merges' | 'freeze' | 'styles' | 'filter' | 'hidden' | 'title' | 'rowHeights' | 'viewSize'
	| 'autoLayout' | 'aggregate' | 'sort' | 'formulas' | 'choice' | 'kanban' | 'calendar' | 'all';

/**
 * Features that can be switched on together in `all`. Auto layout and the board views exclude the others, and so does
 * a sort with merges: a live sort is not applied while a merge spans rows (renderSort.ts), so the two cannot both be
 * seen at work; `sort` is measured alone.
 */
const IN_ALL: readonly Feature[] = ['merges', 'freeze', 'styles', 'filter', 'hidden', 'title', 'rowHeights', 'viewSize', 'aggregate', 'formulas', 'choice'];

export const FEATURES: readonly Feature[] = [
	'plain', 'merges', 'freeze', 'styles', 'filter', 'hidden', 'title', 'rowHeights', 'viewSize',
	'autoLayout', 'aggregate', 'sort', 'formulas', 'choice', 'kanban', 'calendar', 'all',
];

export interface Evidence {
	/** A page-side expression, evaluated in the browser, that is true only if the feature is really there. */
	check: string;
	/** What it proves, for the message when it does not hold. */
	what: string;
}

const has = (f: Feature, want: Feature): boolean => f === want || (f === 'all' && IN_ALL.includes(want));

/** Columns, beyond what the feature itself sets, that are hidden, hold choices, or hold dates. */
export interface ColumnKinds { hidden?: readonly number[]; choice?: readonly number[]; date?: readonly number[] }

export function tableSource(rows: number, feature: Feature, kinds: ColumnKinds = {}): string {
	const L: string[] = ['---', 'version: 2'];
	if (has(feature, 'title')) L.push('title: Performance table', 'footer: a footer line');
	L.push('columns:');
	for (let c = 0; c < COLS; c++) {
		const parts = [`id: c_${c}`, `name: C${c}`];
		if (!has(feature, 'autoLayout')) parts.push(`width: ${70 + (c % 4) * 20}`);
		if ((has(feature, 'hidden') && c === COLS - 1) || kinds.hidden?.includes(c)) parts.push('hidden: true');
		if (has(feature, 'filter') && c === 1) parts.push('filter: [keep]');
		if (((has(feature, 'choice') || feature === 'kanban') && c === 2) || kinds.choice?.includes(c)) parts.push('type: task-status');
		if ((feature === 'calendar' && c === 3) || kinds.date?.includes(c)) parts.push('type: date');
		L.push(`  - { ${parts.join(', ')} }`);
	}
	L.push('rows:');
	const statuses = ['todo', 'doing', 'done'];
	for (let r = 0; r < rows; r++) {
		const cells: string[] = [];
		for (let c = 0; c < COLS; c++) {
			let v = `r${r}c${c}`;
			// Column 1 carries the filter: two rows in three match it.
			if (c === 1) v = r % 3 === 0 ? 'drop' : 'keep';
			if (c === 2 && (has(feature, 'choice') || feature === 'kanban')) v = statuses[r % 3]!;
			if (kinds.choice?.includes(c)) v = statuses[(r + c) % 3]!;
				if ((c === 3 && feature === 'calendar') || kinds.date?.includes(c)) v = `2026-11-${String(1 + ((r + c) % 28)).padStart(2, '0')}`;
			if (c === 4 && (has(feature, 'aggregate') || has(feature, 'formulas'))) v = String(r % 97);
			if (c === 5 && has(feature, 'sort')) v = String((r * 7919) % 1009);
			if (c === 6 && has(feature, 'formulas') && r % 4 === 0) v = String((r % 97) * 2);
			cells.push(`c_${c}: ${v}`);
		}
		const extra: string[] = [];
		if (has(feature, 'rowHeights')) extra.push(`height: ${26 + (r % 5) * 6}`);
		if (has(feature, 'hidden') && r % 11 === 5) extra.push('hidden: true');
		if (has(feature, 'formulas') && r % 4 === 0) extra.push(`formulas: { c_6: "=r_${r}.c_4*2" }`);
		L.push(`  - { id: r_${r}, cells: { ${cells.join(', ')} }${extra.length ? ', ' + extra.join(', ') : ''} }`);
	}
	if (has(feature, 'merges')) {
		L.push('merges:');
		// With frozen rows and columns the merges keep clear of the frozen band: a freeze line cannot cut a merge, and
		// the reducer drops one that would, so merges across it would leave the combined table with no frozen columns.
		const band = has(feature, 'freeze') ? FREEZE : 0;
		for (let i = 0; i < Math.floor(rows / 6); i++) {
			const r = Math.max(4, band) + i * 6, c = band + (i * 3) % (COLS - 3 - band);
			const [er, ec] = i % 3 === 0 ? [r, c + 2] : i % 3 === 1 ? [r + 2, c] : [r + 1, c + 1];
			if (er < rows) L.push(`  - { anchor: r_${r}.c_${c}, end: r_${er}.c_${ec} }`);
		}
	}
	if (has(feature, 'styles')) {
		L.push('styles:', '  - { target: header, bg: "#e8f0fe", bold: true }');
		for (let i = 0; i < Math.min(100, Math.floor(rows / 3)); i++) L.push(`  - { target: "r_${i * 3}.c_${i % COLS}", bg: "#fef9c3" }`);
		for (let c = 0; c < COLS; c += 2) L.push(`  - { target: "c_${c}", bold: true, size: 15 }`);
		for (let i = 0; i < Math.min(100, Math.floor(rows / 3)); i++) L.push(`  - { target: "r_${i * 3}.c_0:r_${i * 3 + 1}.c_3", bg: "#dcfce7", italic: true }`);
	}
	if (has(feature, 'freeze')) L.push(`freezeRows: ${FREEZE}`, `freezeCols: ${FREEZE}`);
	if (has(feature, 'viewSize') || has(feature, 'freeze')) L.push('viewWidth: 900', 'viewHeight: 500');
	if (has(feature, 'aggregate')) L.push('aggregate: [sum, avg]');
	if (has(feature, 'sort')) L.push('sort: { colId: c_5, dir: asc }');
	if (feature === 'kanban') L.push('views:', '  - { id: v_k, type: kanban, kanban: { groupByColId: c_2 } }', 'activeViewId: v_k');
	if (feature === 'calendar') L.push('views:', '  - { id: v_c, type: calendar, calendar: { dateColId: c_3 } }', 'activeViewId: v_c');
	L.push('---', '| A |', '| --- |', '');
	return L.join('\n');
}

/** Evidence, per feature, that it took effect in the rendered table. `plain` and `all` need none of their own. */
export const EVIDENCE: Record<Feature, readonly Evidence[]> = {
	plain: [],
	merges: [{ check: `document.querySelectorAll('td[rowspan], td[colspan], th[colspan]').length > 0`, what: 'a merged cell (rowspan or colspan) is drawn' }],
	freeze: [
		{ check: `document.querySelectorAll('.bt-frozen-row').length > 0`, what: 'frozen rows are marked' },
		{ check: `document.querySelectorAll('.bt-frozen-col').length > 0`, what: 'frozen columns are marked' },
	],
	styles: [{ check: `Array.from(document.querySelectorAll('td.bt-td')).some(e => e.style.backgroundColor !== '')`, what: 'a styled cell has its colour' }],
	filter: [{ check: `(() => { const v = Array.from(document.querySelectorAll('tbody tr:not([data-agg]):not(.bt-row-indicator) td.bt-td[data-col="1"]')); return v.length > 0 && v.every(e => e.textContent.trim() === 'keep'); })()`, what: 'only rows matching the filter are drawn' }],
	hidden: [{ check: `document.querySelectorAll('.bt-row-indicator, .bt-col-indicator').length > 0`, what: 'hidden rows or columns leave an indicator' }],
	title: [{ check: `document.querySelector('.bt-table-title') !== null && document.querySelector('.bt-table-footer') !== null`, what: 'the title and the footer are drawn' }],
	rowHeights: [{ check: `new Set(Array.from(document.querySelectorAll('td.bt-td[data-col="0"]')).slice(0, 10).map(e => Math.round(e.getBoundingClientRect().height))).size > 1`, what: 'rows have different heights' }],
	viewSize: [{ check: `document.querySelector('.bt-table-wrapper.bt-view-fixed-w.bt-view-fixed-h') !== null`, what: 'the view has a fixed width and height' }],
	autoLayout: [{ check: `document.querySelector('table.bt-table').style.tableLayout !== 'fixed'`, what: 'the table is in auto layout' }],
	aggregate: [{ check: `document.querySelectorAll('tr[data-agg]').length >= 2`, what: 'summary rows are drawn' }],
	sort: [{ check: `(() => { const v = Array.from(document.querySelectorAll('td.bt-td[data-col="5"]')).slice(0, 20).map(e => Number(e.textContent)); return v.length > 5 && v.every((x, i) => i === 0 || v[i - 1] <= x); })()`, what: 'rows are in sorted order' }],
	formulas: [{ check: `Array.from(document.querySelectorAll('td.bt-td[data-col="6"]')).some(e => /^\\d+$/.test(e.textContent.trim()) && e.textContent.trim() !== '')`, what: 'a formula cell shows its result' }],
	choice: [{ check: `document.querySelectorAll('.bt-choice').length > 0`, what: 'a choice column is drawn as pills' }],
	kanban: [{ check: `document.querySelector('.bt-kanban-board') !== null`, what: 'the board view is drawn' }],
	calendar: [{ check: `document.querySelector('.bt-cal-nav') !== null`, what: 'the calendar view is drawn' }],
	all: [],
};

/** What a combined table must show: the evidence of every feature in it. */
export function evidenceFor(feature: Feature): readonly Evidence[] {
	if (feature !== 'all') return EVIDENCE[feature];
	return IN_ALL.flatMap(f => EVIDENCE[f]);
}
