import { aggLabel } from './i18n';
import type { AggType, ColumnDefV2, RowDefV2, TableModelV2 } from './model';
import { applyColStyle } from './renderCellStyle';

/** Fixed presentation order for the "More statistics" flyout menu only — table-wide
 *  active summary rows themselves are ordered by `model.aggregate` directly. */
export const AGG_ORDER: AggType[] = ['sum', 'avg', 'min', 'max', 'count'];

/** Table-wide active summary rows, in render order — `model.aggregate` is the
 *  single source of truth for both which rows exist and what order they render in. */
export function activeAggTypes(model: TableModelV2): AggType[] {
	return model.aggregate ?? [];
}

/** A row counts toward a summary if it isn't hidden and passes every column's filter. */
function isRowVisible(row: RowDefV2, model: TableModelV2): boolean {
	if (row.hidden) return false;
	for (const col of model.columns) {
		const values = col.filter;
		if (!values || values.length === 0) continue;
		if (!values.includes((row.cells[col.id] ?? '').trim())) return false;
	}
	return true;
}

/** Round to at most 2 decimal places, stripping trailing zeros. */
function formatAggNumber(n: number): string {
	return String(Math.round(n * 100) / 100);
}

/**
 * Computed value for one column's one active statistic, over currently-visible
 * (non-hidden, non-filtered) data rows. Non-numeric cells are excluded from
 * sum/avg/min/max; 'count' counts non-empty cells regardless of numeric-ness.
 * Returns '' when there's nothing to compute (e.g. no numeric cells for sum/avg).
 */
export function computeAggregateValue(model: TableModelV2, col: ColumnDefV2, agg: AggType): string {
	const visibleRows = model.rows.filter(r => isRowVisible(r, model));

	if (agg === 'count') {
		return String(visibleRows.filter(r => (r.cells[col.id] ?? '').trim() !== '').length);
	}

	const nums = visibleRows
		.map(r => (r.cells[col.id] ?? '').trim())
		.filter(v => v !== '')
		.map(v => Number(v))
		.filter(n => !Number.isNaN(n));
	if (nums.length === 0) return '';

	switch (agg) {
		case 'sum': return formatAggNumber(nums.reduce((a, b) => a + b, 0));
		case 'avg': return formatAggNumber(nums.reduce((a, b) => a + b, 0) / nums.length);
		case 'min': return formatAggNumber(Math.min(...nums));
		case 'max': return formatAggNumber(Math.max(...nums));
	}
}

/**
 * Renders one summary <tr> per active AggType at the bottom of tbody. The
 * leftmost VISIBLE cell always shows the statistic's label so every summary
 * row is identifiable at a glance; every other visible column shows whatever
 * computeAggregateValue can compute for it, blank if nothing applies.
 */
export function renderAggregateRows(tbody: HTMLElement, model: TableModelV2): void {
	for (const agg of activeAggTypes(model)) {
		const tr = tbody.createEl('tr', { cls: 'bt-agg-row' });
		tr.dataset.agg = agg;
		let labelPlaced = false;
		let c = 0;
		while (c < model.columns.length) {
			const col = model.columns[c];
			if (!col) { c++; continue; }

			if (col.hidden) {
				while (c < model.columns.length && model.columns[c]?.hidden) c++;
				tr.createEl('td', { cls: 'bt-td bt-col-indicator bt-agg-td' });
				continue;
			}

			const el = tr.createEl('td', { cls: 'bt-td bt-agg-td' });
			el.dataset.col = String(c);
			applyColStyle(el, col);
			if (!labelPlaced) {
				labelPlaced = true;
				el.createSpan({ cls: 'bt-agg-label', text: aggLabel(agg) });
			} else {
				el.setText(computeAggregateValue(model, col, agg));
			}
			c++;
		}
	}
}
