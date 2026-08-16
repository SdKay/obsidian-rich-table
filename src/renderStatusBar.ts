import type { TableModelV2 } from './model';
import { isRowFiltered } from './renderGridHelpers';

/** A rectangular multi-cell selection, in DISPLAY row/col indices — the same
 *  shape `renderer.ts`'s own `sel` drag-select state and the row/col selector
 *  strips already use. `r1`/`r2` are 1-based data-row display indices (never
 *  0/header — the header row isn't part of any selection this bar reports
 *  on); `c1`/`c2` are 0-based column indices. Order-independent (r1 may be
 *  greater than r2, etc. — same "drag can go either direction" convention as
 *  `sel`). */
export interface SelectionRect {
	r1: number;
	r2: number;
	c1: number;
	c2: number;
}

export interface SelectionStats {
	totalRows: number;
	totalCols: number;
	/** Present only for a genuine multi-cell selection (more than one row or
	 *  column) — a single selected cell (or no selection at all) has nothing
	 *  useful to report beyond the table's own totals, so these three stay
	 *  undefined rather than showing "1 row x 1 col" clutter on every click. */
	selectedRows?: number;
	selectedCols?: number;
	sum?: string;
	avg?: string;
}

/** Round to at most 2 decimal places, stripping trailing zeros — same
 *  convention as renderAggregate.ts's formatAggNumber, so a value that
 *  happens to match a summary row's own reads identically. */
function formatNumber(n: number): string {
	return String(Math.round(n * 100) / 100);
}

/**
 * Row/column totals plus, for a genuine multi-cell selection, the selected
 * row/column count and (if any numeric cells fall inside it) their sum and
 * average. Numeric extraction and visibility rules are the exact same ones
 * `computeAggregateValue` (renderAggregate.ts) already uses — non-numeric and
 * empty cells are skipped, a hidden or filtered-out row contributes nothing,
 * a hidden column contributes nothing — so a value shown here always matches
 * what the equivalent summary row would compute over the same cells.
 */
export function computeSelectionStats(model: TableModelV2, selection: SelectionRect | null): SelectionStats {
	const totalRows = model.rows.filter(r => !r.hidden).length;
	const totalCols = model.columns.filter(c => !c.hidden).length;

	if (!selection) return { totalRows, totalCols };

	const r1 = Math.min(selection.r1, selection.r2);
	const r2 = Math.max(selection.r1, selection.r2);
	const c1 = Math.min(selection.c1, selection.c2);
	const c2 = Math.max(selection.c1, selection.c2);

	// A single cell is not a "selection" worth reporting stats for — see the
	// SelectionStats doc comment.
	if (r1 === r2 && c1 === c2) return { totalRows, totalCols };

	const selectedRows = r2 - r1 + 1;
	const selectedCols = c2 - c1 + 1;

	const nums: number[] = [];
	for (let ri = r1; ri <= r2; ri++) {
		const row = model.rows[ri - 1];
		if (!row || row.hidden || isRowFiltered(ri, model)) continue;
		for (let ci = c1; ci <= c2; ci++) {
			const col = model.columns[ci];
			if (!col || col.hidden) continue;
			const raw = (row.cells[col.id] ?? '').trim();
			if (raw === '') continue;
			const n = Number(raw);
			if (!Number.isNaN(n)) nums.push(n);
		}
	}

	const stats: SelectionStats = { totalRows, totalCols, selectedRows, selectedCols };
	if (nums.length > 0) {
		stats.sum = formatNumber(nums.reduce((a, b) => a + b, 0));
		stats.avg = formatNumber(nums.reduce((a, b) => a + b, 0) / nums.length);
	}
	return stats;
}
