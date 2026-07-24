import type { TableModelV2 } from './model';

// Convenience accessors: convert display index to v2 ID
// di = 1-based data row display index (1 = first data row)
export const rowId = (model: TableModelV2, di: number): string => model.rows[di - 1]?.id ?? '';
export const colId = (model: TableModelV2, ci: number): string => model.columns[ci]?.id ?? '';

/** Returns true when displayIdx (1-based, 0=header) should be hidden by active filters. */
export function isRowFiltered(displayIdx: number, model: TableModelV2): boolean {
	if (displayIdx === 0) return false;
	const row = model.rows[displayIdx - 1];
	if (!row) return false;
	for (const col of model.columns) {
		const values = col.filter;
		if (!values || values.length === 0) continue;
		const cellValue = (row.cells[col.id] ?? '').trim();
		if (!values.includes(cellValue)) return true;
	}
	return false;
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
		// If the literal anchor row/col is hidden, the merge survives by promoting the
		// effective anchor to the first visible row/col within the range — the merge
		// still displays (with the literal anchor's content, see renderRow) instead of
		// collapsing into empty standalone cells. Only give up if the whole range is hidden.
		let effR1 = r1;
		while (effR1 <= r2 && model.rows[effR1]?.hidden) effR1++;
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
		// Match against the effective anchor (promoted past a hidden literal anchor row/col,
		// same rule as buildOccupied) — see the "Table format versioning"-adjacent comment
		// in buildOccupied for why. anchorRowId/anchorColId stay literal for style targets
		// and unmerge, which key off the merge record's actual identity, not the render position.
		let effR1 = r1;
		while (effR1 <= r2 && model.rows[effR1]?.hidden) effR1++;
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
