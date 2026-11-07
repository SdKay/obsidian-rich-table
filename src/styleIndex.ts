/**
 * The style rules of a table worked out once, to be asked cell by cell: `style(row, col)` answers exactly what
 * `resolveStylesV2` (a data cell) or `resolveHeaderStylesV2` (the header) does. Those resolve every rule again for
 * each cell they are asked about: parse its target, find the rows and columns it names by walking the table, and
 * compare. A table of hundreds of rows with a few hundred rules spent most of the time it took to draw on that.
 *
 * Built for a table that does not change while it is used (one render); build another after a change.
 *
 * What it must keep, not tidy: a rule that names a row or column that is not there still matches the cells inside the
 * range its other end makes, as the lookups answer -1 for it and the range is taken between that and the other end.
 */
import type { ColumnDefV2, StyleRuleV2, TableModelV2 } from './model';
import { parseStyleTarget, type ResolvedStyleV2, type StyleTargetV2 } from './styleTarget';

interface Rule {
	rule: StyleRuleV2;
	priority: number;
	/** Whether it can apply to a data cell, and to the header. */
	data: (ri: number, ci: number) => boolean;
	header: (ci: number) => boolean;
	order: number;
}

const priorityOf = (t: StyleTargetV2): number => {
	switch (t.kind) {
		case 'header': case 'row': case 'col': return 1;
		case 'row-range': case 'col-range': return 2;
		case 'rect': return 3;
		case 'cell': case 'header-cell': return 4;
	}
};

/** First position of each id, as `findIndex` finds it. */
const firstIndexes = (items: readonly { id: string }[]): Map<string, number> => {
	const m = new Map<string, number>();
	items.forEach((x, i) => { if (!m.has(x.id)) m.set(x.id, i); });
	return m;
};

const between = (x: number, a: number, b: number) => x >= Math.min(a, b) && x <= Math.max(a, b);

export function compileStyles(model: TableModelV2): (rowIdx: number, colIdx: number) => ResolvedStyleV2 {
	const rowAt = firstIndexes(model.rows);
	const colAt = firstIndexes(model.columns);
	const row = (id: string) => rowAt.get(id) ?? -1;
	const col = (id: string) => colAt.get(id) ?? -1;
	// The position a row id has for a header corner: the header is above the first row.
	const rowOrHeader = (id: string) => (id === 'header' ? -1 : row(id));

	const rules: Rule[] = [];
	model.styles.forEach((rule, order) => {
		const t = parseStyleTarget(rule.target);
		if (!t) return;
		let data: Rule['data'] = () => false;
		let header: Rule['header'] = () => false;
		switch (t.kind) {
			case 'header': header = () => true; break;
			case 'header-cell': header = ci => model.columns[ci]?.id === t.colId; break;
			case 'cell': data = (ri, ci) => model.rows[ri]?.id === t.rowId && model.columns[ci]?.id === t.colId; break;
			case 'row': data = ri => model.rows[ri]?.id === t.rowId; break;
			case 'col':
				data = (_ri, ci) => model.columns[ci]?.id === t.colId;
				header = ci => model.columns[ci]?.id === t.colId;
				break;
			case 'row-range': {
				const s = row(t.startRowId), e = row(t.endRowId);
				data = ri => between(ri, s, e);
				break;
			}
			case 'col-range': {
				const s = col(t.startColId), e = col(t.endColId);
				data = (_ri, ci) => between(ci, s, e);
				break;
			}
			case 'rect': {
				const sr = row(t.startRowId), er = row(t.endRowId), sc = col(t.startColId), ec = col(t.endColId);
				// ri and ci are positions of rows and columns that exist (the cell asked about is in the table), so
				// unlike with an id that may be anywhere, they are never -1 here.
				data = (ri, ci) => between(ri, sr, er) && between(ci, sc, ec);
				const hsr = rowOrHeader(t.startRowId), her = rowOrHeader(t.endRowId);
				header = ci => -1 >= Math.min(hsr, her) && -1 <= Math.max(hsr, her) && between(ci, sc, ec);
				break;
			}
		}
		rules.push({ rule, priority: priorityOf(t), data, header, order });
	});
	// Lowest priority first so a higher one overwrites it; among equals the one listed later wins.
	const byPriority = [...rules].sort((a, b) => a.priority - b.priority || a.order - b.order);

	const columns: readonly ColumnDefV2[] = model.columns;

	return (rowIdx, colIdx) => {
		const column = columns[colIdx];
		if (!column) return {};
		const isHeader = rowIdx === 0;
		if (!isHeader && !model.rows[rowIdx - 1]) return {};
		// Matching is done on the position of the cell's id, as resolveStylesV2 does, which for a repeated id is the first.
		const ri = isHeader ? -1 : row(model.rows[rowIdx - 1]!.id);
		const ci = col(column.id);
		const out: ResolvedStyleV2 = {};
		for (const r of byPriority) {
			if (isHeader ? !r.header(ci) : !r.data(ri, ci)) continue;
			const s = r.rule;
			if (s.bg) out.bg = s.bg;
			if (s.color) out.color = s.color;
			if (s.bold) out.bold = s.bold;
			if (s.italic) out.italic = s.italic;
			if (s.size) out.size = s.size;
			if (s.align) out.align = s.align;
		}
		// The column default is the first column with this id's, as resolveStylesV2 finds it by id.
		const named = columns[ci];
		if (out.align === undefined && named?.align) out.align = named.align;
		return out;
	};
}
