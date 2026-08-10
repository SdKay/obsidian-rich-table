import type { TableModelV2 } from './model';
import { colLetterToIndex, colIndexToLetter } from './utils';

export interface CellIds { rowId: string; colId: string; }
export interface RangeIds { start: CellIds; end: CellIds; }

const LABEL_RE = /^([A-Za-z]+)(\d+)$/;

/** "A2" -> ids, using row 1 = first DATA row (no header offset) — matches
 *  what the row-selector strip already shows on screen. Deliberately NOT
 *  utils.ts's parseCellCoord (that's the v1-legacy "row 1 = header" scheme,
 *  one row off from the current UI). */
export function labelToCellIds(model: TableModelV2, label: string): CellIds | null {
	const m = LABEL_RE.exec(label.trim());
	if (!m) return null;
	const letters = m[1], digits = m[2];
	if (!letters || !digits) return null;
	const col = model.columns[colLetterToIndex(letters)];
	const row = model.rows[parseInt(digits, 10) - 1];
	if (!col || !row) return null;
	return { rowId: row.id, colId: col.id };
}

export function cellIdsToLabel(model: TableModelV2, rowId: string, colId: string): string | null {
	const rowIdx = model.rows.findIndex(r => r.id === rowId);
	const colIdx = model.columns.findIndex(c => c.id === colId);
	if (rowIdx < 0 || colIdx < 0) return null;
	return colIndexToLetter(colIdx) + String(rowIdx + 1);
}

export function labelToRangeIds(model: TableModelV2, rangeLabel: string): RangeIds | null {
	const [startLabel, endLabel] = rangeLabel.split(':', 2);
	if (!startLabel || !endLabel) return null;
	const start = labelToCellIds(model, startLabel);
	const end   = labelToCellIds(model, endLabel);
	if (!start || !end) return null;
	return { start, end };
}

export function rangeIdsToLabel(
	model: TableModelV2, startRowId: string, startColId: string, endRowId: string, endColId: string,
): string | null {
	const start = cellIdsToLabel(model, startRowId, startColId);
	const end   = cellIdsToLabel(model, endRowId, endColId);
	if (!start || !end) return null;
	return `${start}:${end}`;
}

// Matches an id-based reference or range embedded in a larger formula string:
// "r_abc.c_def" or "r_abc.c_def:r_xyz.c_ghi".
const ID_REF_RE = /r_[0-9a-z]+\.c_[0-9a-z]+(?::r_[0-9a-z]+\.c_[0-9a-z]+)?/g;

/** Converts every id-based reference/range in a formula's stored source into
 *  its current friendly-label form, for display in the editor. An id that no
 *  longer resolves (row/col deleted) becomes the literal text "#REF!" — the
 *  same code the evaluator would produce, so a broken reference reads the
 *  same whether you're looking at the formula bar or the cell's value. */
export function idFormulaToLabel(model: TableModelV2, source: string): string {
	return source.replace(ID_REF_RE, token => {
		if (token.includes(':')) {
			const [a, b] = token.split(':', 2) as [string, string];
			const [r1, c1] = a.split('.', 2) as [string, string];
			const [r2, c2] = b.split('.', 2) as [string, string];
			return rangeIdsToLabel(model, r1, c1, r2, c2) ?? '#REF!';
		}
		const [r, c] = token.split('.', 2) as [string, string];
		return cellIdsToLabel(model, r, c) ?? '#REF!';
	});
}

// Matches a friendly-label reference or range embedded in formula text the
// user typed/clicked-in: "A2" or "A2:B5".
const LABEL_REF_RE = /\b[A-Za-z]+\d+(?::[A-Za-z]+\d+)?\b/g;

/** Reverse of idFormulaToLabel — used at confirm time. A label that doesn't
 *  resolve to a current row/column is left AS-IS (not rewritten): the
 *  evaluator's own reference-parsing step will fail to recognize it as an
 *  id-shaped token and surface a syntax/#REF! error consistently, rather
 *  than this function silently guessing. */
export function labelFormulaToIds(model: TableModelV2, source: string): string {
	return source.replace(LABEL_REF_RE, token => {
		if (token.includes(':')) {
			const range = labelToRangeIds(model, token);
			if (!range) return token;
			return `${range.start.rowId}.${range.start.colId}:${range.end.rowId}.${range.end.colId}`;
		}
		const ids = labelToCellIds(model, token);
		if (!ids) return token;
		return `${ids.rowId}.${ids.colId}`;
	});
}
