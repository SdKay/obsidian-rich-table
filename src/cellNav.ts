/**
 * Where does the keyboard selection go next? — the pure, DOM-free decision half
 * of keyboard cell navigation, split out for the same reason renderFreezePlan.ts
 * is split out of renderFreeze.ts: every rule here (which edge wraps, which
 * clamps, what a merge or a hidden row does to a landing coordinate) is
 * checkable without a browser once it stops touching the DOM, and those rules
 * are exactly where the bugs live.
 *
 * Coordinates are DISPLAY indices throughout: row 0 is the header, rows 1..N are
 * data rows (display row N is model.rows[N-1]), col is 0-based. That's the same
 * convention rowId()/getMergeOrigin()/renderRow() already use, so a coordinate
 * from here can be handed straight to any of them.
 */
import type { TableModelV2 } from './model';
import { rowId, colId, isRowFiltered, getMergeOrigin } from './renderGridHelpers';
import { findMergeCoveringCell } from './operations';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

export interface NavCell {
	/** 0 = header, 1..N = data rows (1-based). */
	row: number;
	/** 0-based column index. */
	col: number;
}

/**
 * Row 0 maps to the literal `'header'` sentinel, matching resolveMergeRowIndex's
 * convention in renderGridHelpers.ts/operations.ts — that's how a header-only
 * merge's anchor/end are addressed. Generated row IDs are always `r_xxxxxx`, so
 * they can never collide with the sentinel.
 */
function rowIdOrHeader(model: TableModelV2, row: number): string {
	return row === 0 ? 'header' : rowId(model, row);
}

/** Visible = exists, not `hidden`, and not filtered out. The header is always visible. */
function isRowVisible(model: TableModelV2, row: number): boolean {
	if (row === 0) return true;
	const r = model.rows[row - 1];
	if (!r || r.hidden) return false;
	return !isRowFiltered(row, model);
}

function isColVisible(model: TableModelV2, col: number): boolean {
	const c = model.columns[col];
	return !!c && !c.hidden;
}

/** Row 0 (header) through model.rows.length (last data row, 1-based). */
function inRowBounds(model: TableModelV2, row: number): boolean {
	return row >= 0 && row <= model.rows.length;
}

function inColBounds(model: TableModelV2, col: number): boolean {
	return col >= 0 && col < model.columns.length;
}

/**
 * If (row, col) is COVERED by a merge rather than being its anchor, redirects to
 * that merge's anchor. A covered coordinate has no rendered `<td>` at all (see
 * buildOccupied — those cells are skipped, the anchor carries the rowspan/colspan
 * instead), so it's not a place the mouse could land either; the keyboard has to
 * agree. Returns the cell unchanged when nothing covers it, including when it IS
 * the anchor.
 */
function redirectToAnchor(model: TableModelV2, cell: NavCell): NavCell {
	const covering = findMergeCoveringCell(model, rowIdOrHeader(model, cell.row), colId(model, cell.col));
	if (!covering) return cell;
	const dot = covering.anchor.indexOf('.');
	if (dot < 0) return cell;
	const anchorRowId = covering.anchor.slice(0, dot);
	const anchorColId = covering.anchor.slice(dot + 1);
	const anchorCol = model.columns.findIndex(c => c.id === anchorColId);
	if (anchorCol < 0) return cell;
	if (anchorRowId === 'header') return { row: 0, col: anchorCol };
	const rowsIdx = model.rows.findIndex(r => r.id === anchorRowId);
	if (rowsIdx < 0) return cell; // anchor row no longer exists — leave the cell as-is
	return { row: rowsIdx + 1, col: anchorCol };
}

/**
 * One step out of `from`, accounting for `from` being a merge anchor: moving
 * right/down has to clear the merge's FULL span, or it would land on a cell the
 * same merge already covers (which redirectToAnchor would then bounce straight
 * back, making the key look dead). Moving left/up needs no such adjustment —
 * `from` is the anchor, i.e. already the span's top-left corner.
 */
function exitSpan(model: TableModelV2, from: NavCell, direction: NavDirection): NavCell {
	if (direction === 'left') return { row: from.row, col: from.col - 1 };
	if (direction === 'up')   return { row: from.row - 1, col: from.col };
	const merge = getMergeOrigin(from.row, from.col, model);
	if (direction === 'right') return { row: from.row, col: (merge?.endCol ?? from.col) + 1 };
	return { row: (merge?.endRow ?? from.row) + 1, col: from.col };
}

/**
 * Keeps stepping in `direction` past hidden/filtered rows (or hidden columns)
 * until a visible one is found. Returns null when that walks off the grid — the
 * caller decides whether that means "wrap to the adjacent row" or "clamp".
 */
function skipHidden(model: TableModelV2, cell: NavCell, direction: NavDirection): NavCell | null {
	let { row, col } = cell;
	const horizontal = direction === 'left' || direction === 'right';
	for (;;) {
		if (horizontal) {
			if (!inColBounds(model, col)) return null;
			if (isColVisible(model, col)) return { row, col };
			col += direction === 'right' ? 1 : -1;
		} else {
			if (!inRowBounds(model, row)) return null;
			if (isRowVisible(model, row)) return { row, col };
			row += direction === 'down' ? 1 : -1;
		}
	}
}

/** The first/last visible column, or null if every column is hidden. */
function edgeCol(model: TableModelV2, side: 'first' | 'last'): number | null {
	const from: NavCell = side === 'first'
		? { row: 0, col: 0 }
		: { row: 0, col: model.columns.length - 1 };
	const found = skipHidden(model, from, side === 'first' ? 'right' : 'left');
	return found ? found.col : null;
}

/**
 * The next selected cell in `direction`, or null for "nothing to move to" (an
 * edge — the caller should leave the selection where it is).
 *
 * Horizontal movement wraps between rows (typewriter/Excel convention: Tab at
 * the last column continues on the next row); vertical movement clamps and never
 * wraps around to the opposite end.
 */
export function moveCell(model: TableModelV2, occupied: Set<string>, from: NavCell, direction: NavDirection): NavCell | null {
	const raw = exitSpan(model, from, direction);

	if (direction === 'up' || direction === 'down') {
		const landing = skipHidden(model, raw, direction);
		return landing ? redirectToAnchor(model, landing) : null;
	}

	const sameRow = skipHidden(model, raw, direction);
	if (sameRow) return redirectToAnchor(model, sameRow);

	// Ran off this row's end — wrap onto the adjacent row, skipping any hidden
	// rows in the same direction of travel, and land on that row's far column.
	const wrapRow = skipHidden(
		model,
		{ row: from.row + (direction === 'right' ? 1 : -1), col: from.col },
		direction === 'right' ? 'down' : 'up',
	);
	if (!wrapRow) return null; // absolute first/last cell of the table — clamp
	const col = edgeCol(model, direction === 'right' ? 'first' : 'last');
	if (col === null) return null;
	return redirectToAnchor(model, { row: wrapRow.row, col });
}

/**
 * Re-validates a remembered coordinate against the CURRENT model — used after a
 * write-back rebuild, where the very operation that triggered the rebuild may
 * have deleted the row or column the selection was on. Returns null when the
 * coordinate no longer exists at all; otherwise redirects through a merge anchor
 * the same way moveCell does.
 */
export function clampToValidCell(model: TableModelV2, occupied: Set<string>, cell: NavCell): NavCell | null {
	if (!inRowBounds(model, cell.row) || !inColBounds(model, cell.col)) return null;
	return redirectToAnchor(model, cell);
}
