/**
 * Which display rows a table has. Display row 0 is the header and rows 1..N are `model.rows[0..N-1]`; a table with
 * `header: false` has no row 0. Everything that asks "is this row the header", "what is row 0's id" or "where does the
 * grid start" asks here, so none of it needs to know whether the header is drawn.
 */
import type { TableModelV2 } from './model';

export const HEADER_ROW_ID = 'header';

export interface RowSpace {
	/** The first display row there is: 0 with a header, 1 without. */
	readonly firstRow: number;
	/** The last display row (0 for a header-only table). */
	readonly lastRow: number;
	hasHeader: boolean;
	isHeaderRow(row: number): boolean;
	contains(row: number): boolean;
	/** The id a merge or a style addresses the row by; '' when the row does not exist. */
	idAt(row: number): string;
	/** The display row of an id, or -1 when this table has no such row. */
	rowOf(id: string): number;
}

type HeaderFlag = Pick<TableModelV2, 'header' | 'rows'>;

export function rowSpace(model: HeaderFlag): RowSpace {
	const hasHeader = model.header !== false;
	const firstRow = hasHeader ? 0 : 1;
	const lastRow = model.rows.length;
	return {
		firstRow,
		lastRow,
		hasHeader,
		isHeaderRow: row => hasHeader && row === 0,
		contains: row => Number.isInteger(row) && row >= firstRow && row <= lastRow,
		idAt: row => {
			if (hasHeader && row === 0) return HEADER_ROW_ID;
			return row >= 1 ? model.rows[row - 1]?.id ?? '' : '';
		},
		rowOf: id => {
			if (id === HEADER_ROW_ID) return hasHeader ? 0 : -1;
			const at = model.rows.findIndex(r => r.id === id);
			return at < 0 ? -1 : at + 1;
		},
	};
}
