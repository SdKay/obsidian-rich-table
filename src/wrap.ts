import type { ColumnDefV2, TableModelV2 } from './model';

/** The narrowest a column with a width of its own may be. */
export const COL_MIN_WIDTH = 40;

/** Whether a column's text wraps: the column's `wrap`, else the table's, else yes. */
export function columnWraps(col: Pick<ColumnDefV2, 'wrap'>, model: Pick<TableModelV2, 'wrap'>): boolean {
	return col.wrap ?? model.wrap ?? true;
}

/** A column's own width as drawn, or null when the browser sizes it. */
export function fixedWidthOf(col: Pick<ColumnDefV2, 'width'>): number | null {
	return (col.width ?? 0) > 0 ? Math.max(COL_MIN_WIDTH, col.width!) : null;
}

/** An auto-width column that wraps takes whatever room the view leaves, rather than the width of its longest line. */
export function isFlexColumn(col: Pick<ColumnDefV2, 'width' | 'wrap' | 'hidden'>, model: Pick<TableModelV2, 'wrap'>): boolean {
	return !col.hidden && fixedWidthOf(col) === null && columnWraps(col, model);
}

export interface CellSizing {
	/** The cell's pinned width; null leaves it to the browser. */
	width: number | null;
	nowrap: boolean;
}

/**
 * How a cell covering columns `from`..`to` is sized. It is pinned only when every visible column it covers has a
 * width (the sum), so a merge reaching into an auto column leaves the browser to share it out. It keeps to one line
 * when its first column does not wrap.
 */
export function cellSizing(model: Pick<TableModelV2, 'columns' | 'wrap'>, from: number, to = from): CellSizing {
	let width = 0;
	let pinned = true;
	for (let ci = from; ci <= to; ci++) {
		const col = model.columns[ci];
		if (!col || col.hidden) continue;
		const w = fixedWidthOf(col);
		if (w === null) { pinned = false; break; }
		width += w;
	}
	const first = model.columns[from];
	return { width: pinned && width > 0 ? width : null, nowrap: first ? !columnWraps(first, model) : false };
}
