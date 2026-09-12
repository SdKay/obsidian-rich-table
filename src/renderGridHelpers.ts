import type { TableModelV2 } from './model';

// Convenience accessors: convert display index to v2 ID
// di = 1-based data row display index (1 = first data row)
export const rowId = (model: TableModelV2, di: number): string => model.rows[di - 1]?.id ?? '';
export const colId = (model: TableModelV2, ci: number): string => model.columns[ci]?.id ?? '';

export interface MergeBounds { rowLo: number; rowHi: number; colLo: number; colHi: number }

/**
 * Resolves every merge in the model to display-row-index (0=header, 1..N data)
 * / 0-based-column-index bounds, in whichever order anchor/end happen to be —
 * pure and independent of hidden rows/cols (buildOccupied/getMergeOrigin below
 * still own the "effective", hidden-row-promoted anchor for rendering; this is
 * the plain literal resolution shared by callers that just need "does this
 * merge overlap this rectangle", e.g. copy-range HTML export and drag-select
 * expansion).
 */
export function resolveMergeBounds(model: TableModelV2): MergeBounds[] {
	const rowIdxOf = (id: string): number | null => {
		if (id === 'header') return 0;
		const idx = model.rows.findIndex(r => r.id === id);
		return idx >= 0 ? idx + 1 : null;
	};
	const out: MergeBounds[] = [];
	for (const m of model.merges) {
		const dotA = m.anchor.indexOf('.');
		const dotE = m.end.indexOf('.');
		if (dotA < 0 || dotE < 0) continue;
		const r1 = rowIdxOf(m.anchor.slice(0, dotA));
		const r2 = rowIdxOf(m.end.slice(0, dotE));
		const c1 = model.columns.findIndex(c => c.id === m.anchor.slice(dotA + 1));
		const c2 = model.columns.findIndex(c => c.id === m.end.slice(dotE + 1));
		if (r1 === null || r2 === null || c1 < 0 || c2 < 0) continue;
		out.push({ rowLo: Math.min(r1, r2), rowHi: Math.max(r1, r2), colLo: Math.min(c1, c2), colHi: Math.max(c1, c2) });
	}
	return out;
}

/**
 * How many LEADING display rows (the header itself, plus any data rows a
 * header-anchored merge reaches down into) must physically live inside
 * `<thead>` rather than `<tbody>` for their merges to render correctly.
 *
 * `rowspan` cannot cross a `<thead>`/`<tbody>` boundary — confirmed by direct
 * measurement: an identical merge entirely within `<tbody>` gets its full
 * height, one anchored at the header but reaching into `<tbody>` gets
 * silently clipped to just the header's own row height, because `<thead>`
 * and `<tbody>` are independent row groups as far as the table layout
 * algorithm is concerned. The fix isn't a CSS trick — it's hosting whichever
 * data rows a header merge reaches into inside `<thead>` too, so the merge
 * never actually crosses a row-group boundary in the first place. Those rows
 * stay completely normal otherwise (real `model.rows[]` entries, `.bt-td`
 * cells, sortable/filterable/formula-referenceable) — only their DOM parent
 * changes, purely so native `rowspan` has something that works.
 *
 * Returns 1 when nothing is merged into the header (the header is always at
 * least its own one row).
 */
export function computeHeaderRowSpan(model: TableModelV2): number {
	let maxRowHi = 0;
	for (const b of resolveMergeBounds(model)) {
		if (b.rowLo === 0) maxRowHi = Math.max(maxRowHi, b.rowHi);
	}
	return maxRowHi + 1;
}

/**
 * Returns true when displayIdx (1-based, 0=header) should be hidden by active
 * filters. Reads each filtered column's cell through `resolveCellValue`, not
 * the row's own raw cell, because a row covered by a vertical merge on that
 * column has a genuinely empty cell of its own — the value it visibly shows
 * lives only on the merge's anchor. Reported: a merge spanning rows 2-3 on a
 * filtered column, anchored at row 2 which matched the filter, still hid row
 * 3 — its raw (empty) cell never matched anything, even though row 3 visibly
 * shows the exact same value via the merge.
 */
export function isRowFiltered(displayIdx: number, model: TableModelV2): boolean {
	if (displayIdx === 0) return false;
	const row = model.rows[displayIdx - 1];
	if (!row) return false;
	for (const col of model.columns) {
		const values = col.filter;
		if (!values || values.length === 0) continue;
		const cellValue = resolveCellValue(model, row.id, col.id).trim();
		if (!values.includes(cellValue)) return true;
	}
	return false;
}

/**
 * Effective value of a cell, resolving through a merge to its anchor when
 * this cell is a COVERED (non-anchor) member — a merge's value lives only on
 * the anchor cell; every other row/col it visually spans has a genuinely
 * empty cell in the model, because the plain table never needs to "resolve"
 * this itself (it just skips rendering covered cells outright, via rowspan/
 * colspan on the anchor — see buildOccupied). A non-tabular view like Kanban,
 * where every row becomes an independent card with no shared visual span,
 * needs the actual resolved value instead — reported as: a table with a
 * vertically-merged column only showed that value on the first of the
 * merged rows' cards, the rest showed nothing.
 */
export function resolveCellValue(model: TableModelV2, rowId: string, colId: string): string {
	const own = model.rows.find(r => r.id === rowId)?.cells[colId] ?? '';
	if (own) return own; // has its own content — either unmerged or the anchor itself
	const rowIdx = resolveMergeRowIndex(model, rowId);
	const colIdx = model.columns.findIndex(c => c.id === colId);
	if (rowIdx === undefined || colIdx < 0) return '';
	for (const m of model.merges) {
		const dotA = m.anchor.indexOf('.');
		const dotE = m.end.indexOf('.');
		if (dotA < 0 || dotE < 0) continue;
		const anchorRowId = m.anchor.slice(0, dotA);
		const anchorColId = m.anchor.slice(dotA + 1);
		const endRowId = m.end.slice(0, dotE);
		const endColId = m.end.slice(dotE + 1);
		const r1 = resolveMergeRowIndex(model, anchorRowId);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const r2 = resolveMergeRowIndex(model, endRowId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (r1 === undefined || c1 < 0 || r2 === undefined || c2 < 0) continue;
		if (rowIdx >= Math.min(r1, r2) && rowIdx <= Math.max(r1, r2)
			&& colIdx >= Math.min(c1, c2) && colIdx <= Math.max(c1, c2)) {
			return model.rows.find(r => r.id === anchorRowId)?.cells[anchorColId] ?? '';
		}
	}
	return '';
}

export interface ResolvedMerge {
	anchorRowId: string; anchorColId: string;
	endRowId:    string; endColId:    string;
	startRow:    number; endRow:      number;  // 1-based display indices
	startCol:    number; endCol:      number;  // 0-based column indices
}

/**
 * Resolves a merge anchor/end row-ID string to a 0-based row index, treating the
 * literal sentinel `'header'` (used by header-only merges, see `renderer.ts`'s
 * header drag-to-select) as index -1 — one position before the first data row.
 * This lets header cells and data rows share the same range-comparison logic
 * below instead of needing a parallel header-only code path. Real row IDs are
 * never the string `'header'` (they're generated as `r_xxxxxx`), so there's no
 * collision. Returns undefined when the ID matches no row and isn't the sentinel.
 */
function resolveMergeRowIndex(model: TableModelV2, id: string): number | undefined {
	if (id === 'header') return -1;
	const idx = model.rows.findIndex(r => r.id === id);
	return idx >= 0 ? idx : undefined;
}

/**
 * True when 0-based row index `ri` (-1 = header) gets no `<tr>` of its own —
 * either genuinely hidden or filtered out by another column's active filter.
 * Both cases must promote a merge's effective anchor the same way: a filtered
 * row vanishes from the render loop exactly like a hidden one (see
 * `isRowFiltered`'s call site in renderer.ts), so an anchor sitting on a
 * filtered row is just as unrenderable as one sitting on a hidden row.
 */
function rowHasNoTr(model: TableModelV2, ri: number): boolean {
	return !!model.rows[ri]?.hidden || isRowFiltered(ri + 1, model);
}

/** Build the set of "rowId.colId" keys that are COVERED (not anchor) by a merge. */
export function buildOccupied(model: TableModelV2): Set<string> {
	const occupied = new Set<string>();
	for (const m of model.merges) {
		const dotA = m.anchor.indexOf('.');
		const dotE = m.end.indexOf('.');
		if (dotA < 0 || dotE < 0) continue;
		const anchorRowId = m.anchor.slice(0, dotA);
		const anchorColId = m.anchor.slice(dotA + 1);
		const endRowId    = m.end.slice(0, dotE);
		const endColId    = m.end.slice(dotE + 1);
		const r1 = resolveMergeRowIndex(model, anchorRowId);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const r2 = resolveMergeRowIndex(model, endRowId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (r1 === undefined || c1 < 0 || r2 === undefined || c2 < 0) continue;
		// If the literal anchor row/col is hidden (or, for rows, filtered out), the merge
		// survives by promoting the effective anchor to the first row/col within the range
		// that actually gets a <tr>/rendered cell — the merge still displays (with the
		// literal anchor's content, see renderRow) instead of collapsing into empty
		// standalone cells. Only give up if the whole range is hidden/filtered.
		let effR1 = r1;
		while (effR1 <= r2 && rowHasNoTr(model, effR1)) effR1++;
		let effC1 = c1;
		while (effC1 <= c2 && model.columns[effC1]?.hidden) effC1++;
		if (effR1 > r2 || effC1 > c2) continue;
		for (let ri = effR1; ri <= r2; ri++) {
			for (let ci = effC1; ci <= c2; ci++) {
				if (ri === effR1 && ci === effC1) continue; // effective anchor is not occupied
				const rId = ri === -1 ? 'header' : (model.rows[ri]?.id ?? '');
				const cId = model.columns[ci]?.id ?? '';
				if (rId && cId) occupied.add(`${rId}.${cId}`);
			}
		}
	}
	return occupied;
}

/** Number of visible cells per row (visible cols + one indicator per hidden group). */
export function countVisibleCells(model: TableModelV2): number {
	let count = 0;
	let inHiddenGroup = false;
	for (const col of model.columns) {
		if (col.hidden) {
			if (!inHiddenGroup) { count++; inHiddenGroup = true; }
		} else {
			count++;
			inHiddenGroup = false;
		}
	}
	return count;
}

/**
 * Finds the merge whose effective (hidden-row/col-promoted) anchor is this cell.
 * `rowIdx === 0` (header) is a valid origin too — a header-only merge's anchor/end
 * row IDs are the `'header'` sentinel, which `resolveMergeRowIndex` maps to -1, one
 * position before the first data row; `rowIdx - 1 === -1` for the header makes the
 * same comparison below work for both header and data rows without a special case.
 */
export function getMergeOrigin(rowIdx: number, colIdx: number, model: TableModelV2): ResolvedMerge | undefined {
	const col = model.columns[colIdx];
	if (!col) return undefined;
	if (rowIdx > 0 && !model.rows[rowIdx - 1]) return undefined;
	for (const m of model.merges) {
		const dotA = m.anchor.indexOf('.');
		const dotE = m.end.indexOf('.');
		if (dotA < 0 || dotE < 0) continue;
		const anchorRowId = m.anchor.slice(0, dotA);
		const anchorColId = m.anchor.slice(dotA + 1);
		const endRowId = m.end.slice(0, dotE);
		const endColId = m.end.slice(dotE + 1);
		const r1 = resolveMergeRowIndex(model, anchorRowId);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const r2 = resolveMergeRowIndex(model, endRowId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (r1 === undefined || c1 < 0 || r2 === undefined || c2 < 0) continue;
		// Match against the effective anchor (promoted past a hidden or filtered-out literal
		// anchor row, or hidden literal anchor column, same rule as buildOccupied) — see the
		// "Table format versioning"-adjacent comment in buildOccupied for why. anchorRowId/
		// anchorColId stay literal for style targets and unmerge, which key off the merge
		// record's actual identity, not the render position.
		let effR1 = r1;
		while (effR1 <= r2 && rowHasNoTr(model, effR1)) effR1++;
		let effC1 = c1;
		while (effC1 <= c2 && model.columns[effC1]?.hidden) effC1++;
		if (effR1 > r2 || effC1 > c2) continue;
		if (rowIdx - 1 !== effR1 || colIdx !== effC1) continue;
		return {
			anchorRowId, anchorColId, endRowId, endColId,
			startRow: rowIdx, startCol: colIdx,
			endRow:   r2 + 1, endCol:   c2,  // 1-based
		};
	}
	return undefined;
}
