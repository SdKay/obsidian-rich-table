/**
 * Which of the two selector strips has to be rebuilt after the layout changed. Rebuilding a strip reads the
 * geometry of every column or row and replaces every cell, so a column drag on a table with hundreds of rows
 * must not rebuild the row strip on every move.
 *
 * The column strip is stale when a column was resized, the table got wider, or any column is somewhere else than
 * where the strip was built for it: the browser shares the room out among auto columns, so one can grow as another
 * shrinks at the same table width (an image in one of them finished loading). The row strip is stale when a row
 * was resized, or when any row is somewhere else than where the strip was built for it. A column resize can do
 * that: narrower text wraps and its row grows, wider text unwraps and its row shrinks, and a merged cell spanning
 * rows shares its height out among them again. The total height is no stand-in for that, since one row can grow
 * as another shrinks, so the rows themselves are compared.
 */
export type StripAxis = 'col' | 'row';

export interface TableSize { w: number; h: number }

/** Sizes within this many pixels are the same size. */
const SAME = 0.5;

/**
 * @param stale      the axes something said have changed (a column or a row was dragged); empty when nothing did
 * @param built      the table's size when the strips were last rebuilt, or null when they never were or were marked stale outright
 * @param now        the table's size now
 * @param rowsMoved  whether any row is not where the row strip was built for it; asked only when the answer can matter
 * @param colsMoved  the same for the columns
 */
export function stripsToRebuild(
	stale: ReadonlySet<StripAxis>,
	built: TableSize | null,
	now: TableSize,
	rowsMoved: () => boolean,
	colsMoved: () => boolean = () => false,
): ReadonlySet<StripAxis> {
	if (built === null) return new Set<StripAxis>(['col', 'row']);
	const out = new Set<StripAxis>(stale);
	const resized = Math.abs(now.w - built.w) >= SAME || Math.abs(now.h - built.h) >= SAME;
	if (Math.abs(now.w - built.w) >= SAME) out.add('col');
	if (!out.has('col') && (out.size > 0 || resized) && colsMoved()) out.add('col');
	// Nothing was dragged and the table is the size it was: no row can have moved, and reading them all is not free.
	if (!out.has('row') && (out.size > 0 || resized) && rowsMoved()) out.add('row');
	return out;
}

/** Flat [top, height, top, height, …] of the rows (or [left, width, …] of the columns), in the order they appear. */
export type RowGeometry = readonly number[];

/** Whether two readings of the rows are the same rows in the same places. */
export function sameRowGeometry(a: RowGeometry, b: RowGeometry): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) >= SAME) return false;
	return true;
}
