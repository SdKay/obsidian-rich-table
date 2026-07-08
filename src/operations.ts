import type { TableModel, MergeRange, StyleRule } from './model';
import { colLetterToIndex, colIndexToLetter } from './utils';

export type StructuralOp =
	| { type: 'insert-row';      afterRowIdx: number }
	| { type: 'delete-row';      rowIdx: number }
	| { type: 'insert-col';      afterColIdx: number }
	| { type: 'delete-col';      colIdx: number }
	| { type: 'hide-col';        colIdx: number }
	| { type: 'show-col-group';  colIndices: number[] }
	| { type: 'hide-row';        rowIdx: number }
	| { type: 'show-row-group';  rowIndices: number[] }
	| { type: 'merge-cells';     startRow: number; startCol: number; endRow: number; endCol: number }
	| { type: 'unmerge-cells';   startRow: number; startCol: number }
	| { type: 'move-row';        fromIdx: number; toIdx: number }
	| { type: 'move-col';        fromIdx: number; toIdx: number }
	| { type: 'set-cell-style';  rowIdx: number;  colIdx: number; bg: string | null; color: string | null; size: number | null; bold: boolean | null; italic: boolean | null }
	| { type: 'set-range-style'; target: string;                 bg: string | null; color: string | null; size: number | null; bold: boolean | null; italic: boolean | null }
	| { type: 'set-title';       title:  string | undefined }
	| { type: 'set-footer';      footer: string | string[] | undefined }
	| { type: 'set-col-width';   colIdx: number; width: number }
	| { type: 'set-row-height';  rowIdx: number; height: number }
	| { type: 'set-filter';      colLetter: string; values: string[] | null }
	| { type: 'toggle-lock' };

export function applyStructuralOp(model: TableModel, op: StructuralOp): void {
	switch (op.type) {
		case 'insert-row':     insertRow(model, op.afterRowIdx); break;
		case 'delete-row':     deleteRow(model, op.rowIdx);      break;
		case 'insert-col':     insertCol(model, op.afterColIdx);  break;
		case 'delete-col':     deleteCol(model, op.colIdx);       break;
		case 'hide-col': {
			const idx = op.colIdx;
			const col = model.columns[idx];
			// Replace the column object entirely to avoid any mutation-related issues
			if (col !== undefined) model.columns[idx] = { ...col, hidden: true };
			break;
		}
		case 'show-col-group': {
			for (const idx of op.colIndices) {
				const col = model.columns[idx];
				if (col !== undefined) {
					// eslint-disable-next-line @typescript-eslint/no-unused-vars -- _h is intentionally discarded to remove the hidden key via rest spread
				const { hidden: _h, ...rest } = col;
					model.columns[idx] = rest;
				}
			}
			break;
		}
		case 'hide-row': {
			const hrs = model.hiddenRows ?? (model.hiddenRows = []);
			if (!hrs.includes(op.rowIdx)) {
				hrs.push(op.rowIdx);
				hrs.sort((a, b) => a - b);
			}
			break;
		}
		case 'show-row-group': {
			model.hiddenRows = (model.hiddenRows ?? []).filter(r => !op.rowIndices.includes(r));
			break;
		}
		case 'merge-cells': {
			// Expand the selection bounding box to absorb any overlapping existing
			// merges, iterating until the box stabilises.  This prevents partial
			// overlaps that would leave the model in an invalid state.
			let r1 = op.startRow, c1 = op.startCol;
			let r2 = op.endRow,   c2 = op.endCol;

			let expanded = true;
			while (expanded) {
				expanded = false;
				for (const m of model.merges) {
					const overlaps = !(m.endRow < r1 || m.startRow > r2 ||
					                   m.endCol < c1 || m.startCol > c2);
					if (overlaps) {
						const nr1 = Math.min(r1, m.startRow), nc1 = Math.min(c1, m.startCol);
						const nr2 = Math.max(r2, m.endRow),   nc2 = Math.max(c2, m.endCol);
						if (nr1 !== r1 || nc1 !== c1 || nr2 !== r2 || nc2 !== c2) {
							r1 = nr1; c1 = nc1; r2 = nr2; c2 = nc2;
							expanded = true;
						}
					}
				}
			}

			// Remove every merge that falls inside or overlaps the final bounding box
			model.merges = model.merges.filter(m =>
				m.endRow < r1 || m.startRow > r2 || m.endCol < c1 || m.startCol > c2,
			);
			model.merges.push({ startRow: r1, startCol: c1, endRow: r2, endCol: c2 });
			break;
		}
		case 'unmerge-cells': {
			model.merges = model.merges.filter(
				m => !(m.startRow === op.startRow && m.startCol === op.startCol),
			);
			break;
		}
		case 'move-row': {
			const { fromIdx, toIdx } = op;
			if (fromIdx === toIdx || fromIdx < 1 || toIdx < 1) break;
			const [row] = model.rows.splice(fromIdx, 1);
			if (row !== undefined) model.rows.splice(toIdx, 0, row);
			model.merges = model.merges.map(m => {
				// All cells of this merge are inside the moved row (single-row merge)
				if (m.startRow === fromIdx && m.endRow === fromIdx) {
					return { ...m, startRow: toIdx, endRow: toIdx };
				}
				// Merge spans the moved row AND other rows (partial) → stay put
				return m;
			});
			if (model.hiddenRows) {
				model.hiddenRows = model.hiddenRows.map(r => remapMoveIndex(r, fromIdx, toIdx));
			}
			model.styles = model.styles
				.map(s => ({ ...s, target: targetRowMove(s.target, fromIdx, toIdx) }))
				.filter(s => s.target !== '');
			break;
		}
		case 'set-cell-style': {
			const { rowIdx, colIdx, bg, color, size, bold, italic } = op;
			const target = `${colIndexToLetter(colIdx)}${rowIdx + 1}`;
			let rule: StyleRule | undefined = model.styles.find(s => s.target === target);
			if (!rule) {
				const newRule: StyleRule = { target };
				model.styles.push(newRule);
				rule = newRule;
			}
			if (bg !== null) rule.bg = bg; else delete rule.bg;
			if (color !== null) rule.color = color; else delete rule.color;
			if (size !== null) rule.size = size; else delete rule.size;
			if (bold) rule.bold = true; else delete rule.bold;
			if (italic) rule.italic = true; else delete rule.italic;
			if (!rule.bg && !rule.color && !rule.bold && !rule.italic && !rule.size) {
				model.styles = model.styles.filter(s => s.target !== target);
			}
			break;
		}
		case 'set-title': {
			if (op.title) model.title = op.title;
			else delete model.title;
			break;
		}
		case 'set-footer': {
			if (op.footer !== undefined) model.footer = op.footer;
			else delete model.footer;
			break;
		}
		case 'set-col-width': {
			const col = model.columns[op.colIdx];
			if (col) col.width = op.width;
			break;
		}
		case 'set-row-height': {
			const heights = model.rowHeights ?? (model.rowHeights = []);
			while (heights.length <= op.rowIdx) heights.push(0);
			heights[op.rowIdx] = op.height;
			// Trim trailing zeros
			while (heights.length > 0 && heights[heights.length - 1] === 0) heights.pop();
			if (heights.length === 0) delete model.rowHeights;
			break;
		}
		case 'set-range-style': {
			const { target, bg, color, size, bold, italic } = op;
			let rule: StyleRule | undefined = model.styles.find(s => s.target === target);
			if (!rule) {
				const newRule: StyleRule = { target };
				model.styles.push(newRule);
				rule = newRule;
			}
			if (bg !== null) rule.bg = bg; else delete rule.bg;
			if (color !== null) rule.color = color; else delete rule.color;
			if (size !== null) rule.size = size; else delete rule.size;
			if (bold) rule.bold = true; else delete rule.bold;
			if (italic) rule.italic = true; else delete rule.italic;
			if (!rule.bg && !rule.color && !rule.bold && !rule.italic && !rule.size) {
				model.styles = model.styles.filter(s => s.target !== target);
			}
			break;
		}
		case 'set-filter': {
			const { colLetter, values } = op;
			if (!values || values.length === 0) {
				if (model.filter) {
					delete model.filter[colLetter];
					if (Object.keys(model.filter).length === 0) delete model.filter;
				}
			} else {
				(model.filter ??= {})[colLetter] = values;
			}
			break;
		}
		case 'toggle-lock':
			model.locked = !model.locked || undefined;
			break;
		case 'move-col': {
			const { fromIdx, toIdx } = op;
			if (fromIdx === toIdx) break;
			const [col] = model.columns.splice(fromIdx, 1);
			if (col !== undefined) model.columns.splice(toIdx, 0, col);
			for (const row of model.rows) {
				const [cell] = row.splice(fromIdx, 1);
				row.splice(toIdx, 0, cell ?? '');
			}
			model.merges = model.merges.map(m => {
				// All cells of this merge are inside the moved column (single-col merge)
				if (m.startCol === fromIdx && m.endCol === fromIdx) {
					return { ...m, startCol: toIdx, endCol: toIdx };
				}
				// Merge spans the moved column AND other columns (partial) → stay put
				return m;
			});
			model.styles = model.styles
				.map(s => ({ ...s, target: targetColMove(s.target, fromIdx, toIdx) }))
				.filter(s => s.target !== '');
			break;
		}
	}
}

/** Maps a single index after a move operation (fromIdx → toIdx). */
function remapMoveIndex(idx: number, fromIdx: number, toIdx: number): number {
	if (idx === fromIdx) return toIdx;
	if (fromIdx < toIdx) {
		return (idx > fromIdx && idx <= toIdx) ? idx - 1 : idx;
	} else {
		return (idx >= toIdx && idx < fromIdx) ? idx + 1 : idx;
	}
}

/** Remap style target coordinates after a row move (0-indexed). */
function targetRowMove(target: string, fromIdx: number, toIdx: number): string {
	// Targets use 1-indexed rows; convert before/after remapping.
	const from1 = fromIdx + 1;
	const to1   = toIdx   + 1;
	return mapTarget(target, (r, c) => ({ r: remapMoveIndex(r, from1, to1), c }));
}

/** Remap style target coordinates after a column move (0-indexed). */
function targetColMove(target: string, fromIdx: number, toIdx: number): string {
	// Column indices in mapTarget callbacks are already 0-indexed.
	return mapTarget(target, (r, c) => ({ r, c: remapMoveIndex(c, fromIdx, toIdx) }));
}

// ── Row operations ────────────────────────────────────────────────────────────

function insertRow(model: TableModel, afterRowIdx: number): void {
	const numCols = model.columns.length;
	const newRow  = Array.from({ length: numCols }, () => '');
	model.rows.splice(afterRowIdx + 1, 0, newRow);

	const at = afterRowIdx + 1; // 0-indexed position of the new row
	model.merges = model.merges.flatMap(m => mergeRowInsert(m, at));
	model.styles = model.styles.map(s => ({ ...s, target: targetRowInsert(s.target, at) }));
}

function deleteRow(model: TableModel, rowIdx: number): void {
	if (rowIdx <= 0 || rowIdx >= model.rows.length) return; // can't delete header
	model.rows.splice(rowIdx, 1);
	model.merges = model.merges.flatMap(m => mergeRowDelete(m, rowIdx));
	model.styles = model.styles
		.map(s => ({ ...s, target: targetRowDelete(s.target, rowIdx) }))
		.filter(s => s.target !== '');
}

// ── Column operations ─────────────────────────────────────────────────────────

function insertCol(model: TableModel, afterColIdx: number): void {
	const at    = afterColIdx + 1;
	const label = colIndexToLetter(at);
	model.columns.splice(at, 0, { name: label });
	for (const row of model.rows) row.splice(at, 0, '');
	model.merges = model.merges.flatMap(m => mergeColInsert(m, at));
	model.styles = model.styles.map(s => ({ ...s, target: targetColInsert(s.target, at) }));
}

function deleteCol(model: TableModel, colIdx: number): void {
	if (colIdx < 0 || colIdx >= model.columns.length) return;
	model.columns.splice(colIdx, 1);
	for (const row of model.rows) row.splice(colIdx, 1);
	model.merges = model.merges.flatMap(m => mergeColDelete(m, colIdx));
	model.styles = model.styles
		.map(s => ({ ...s, target: targetColDelete(s.target, colIdx) }))
		.filter(s => s.target !== '');
}

// ── Merge remapping ───────────────────────────────────────────────────────────

function mergeRowInsert(m: MergeRange, at: number): MergeRange[] {
	if (m.startRow >= at) return [{ ...m, startRow: m.startRow + 1, endRow: m.endRow + 1 }];
	if (m.endRow   >= at) return [{ ...m, endRow: m.endRow + 1 }];
	return [m];
}

function mergeRowDelete(m: MergeRange, at: number): MergeRange[] {
	if (m.startRow > at) return [{ ...m, startRow: m.startRow - 1, endRow: m.endRow - 1 }];
	const newEnd = m.endRow >= at ? m.endRow - 1 : m.endRow;
	if (m.startRow === at && newEnd < at) return []; // single-row merge deleted
	return [{ ...m, endRow: newEnd }];
}

function mergeColInsert(m: MergeRange, at: number): MergeRange[] {
	if (m.startCol >= at) return [{ ...m, startCol: m.startCol + 1, endCol: m.endCol + 1 }];
	if (m.endCol   >= at) return [{ ...m, endCol: m.endCol + 1 }];
	return [m];
}

function mergeColDelete(m: MergeRange, at: number): MergeRange[] {
	if (m.startCol > at) return [{ ...m, startCol: m.startCol - 1, endCol: m.endCol - 1 }];
	const newEnd = m.endCol >= at ? m.endCol - 1 : m.endCol;
	if (m.startCol === at && newEnd < at) return [];
	return [{ ...m, endCol: newEnd }];
}

// ── Style target remapping ────────────────────────────────────────────────────
// Targets use 1-indexed rows (row 1 = header = array index 0)
// and column letters (A = index 0).  "" return value = remove the style.

function targetRowInsert(target: string, atIdx: number): string {
	// atIdx: 0-indexed; in 1-indexed: rows >= atIdx+1 shift up by 1
	const thr = atIdx + 1;
	return mapTarget(target, (r, c) => ({ r: r >= thr ? r + 1 : r, c }));
}

function targetRowDelete(target: string, atIdx: number): string {
	// atIdx: 0-indexed; 1-indexed deleted row = atIdx+1
	const del = atIdx + 1;
	return mapTarget(target, (r, c) => {
		if (r === del) return null;
		return { r: r > del ? r - 1 : r, c };
	});
}

function targetColInsert(target: string, atIdx: number): string {
	// atIdx: 0-indexed; columns with index >= atIdx shift right
	return mapTarget(target, (r, c) => ({ r, c: c >= atIdx ? c + 1 : c }));
}

function targetColDelete(target: string, atIdx: number): string {
	// atIdx: 0-indexed; deleted column index = atIdx
	return mapTarget(target, (r, c) => {
		if (c === atIdx) return null;
		return { r, c: c > atIdx ? c - 1 : c };
	});
}

/** Applies a transform to all row/col references within a target string.
 *  The callback returns null to signal "this reference should be removed". */
function mapTarget(
	target: string,
	fn: (r: number, c: number) => { r: number; c: number } | null,
): string {
	// B* → whole column
	const colWild = /^([A-Z]+)\*$/.exec(target);
	if (colWild) {
		const c = colLetterToIndex(colWild[1] ?? '');
		const mapped = fn(1, c); // pass dummy row; only c matters
		if (!mapped) return '';
		return `${colIndexToLetter(mapped.c)}*`;
	}

	// *2 → whole row
	const rowWild = /^\*(\d+)$/.exec(target);
	if (rowWild) {
		const r = parseInt(rowWild[1] ?? '0');
		const mapped = fn(r, 0); // pass dummy col; only r matters
		if (!mapped) return '';
		return `*${mapped.r}`;
	}

	// 1:3 → row range (purely numeric)
	const rowRange = /^(\d+):(\d+)$/.exec(target);
	if (rowRange) {
		const r1 = parseInt(rowRange[1] ?? '0');
		const r2 = parseInt(rowRange[2] ?? '0');
		const m1 = fn(r1, 0);
		const m2 = fn(r2, 0);
		const nr1 = m1 ? m1.r : (r1 < (m2?.r ?? r2) ? r1 : null);
		const nr2 = m2 ? m2.r : null;
		if (nr1 === null || nr2 === null || nr1 > nr2) return '';
		return `${nr1}:${nr2}`;
	}

	// A:B → column range (all rows in columns A through B)
	const colRange = /^([A-Z]+):([A-Z]+)$/.exec(target);
	if (colRange) {
		const c1 = colLetterToIndex(colRange[1] ?? '');
		const c2 = colLetterToIndex(colRange[2] ?? '');
		const m1 = fn(1, c1); // dummy row; only c matters
		const m2 = fn(1, c2);
		const nc1 = m1 ? m1.c : (c1 < (m2?.c ?? c2) ? c1 : null);
		const nc2 = m2 ? m2.c : null;
		if (nc1 === null || nc2 === null || nc1 > nc2) return '';
		return `${colIndexToLetter(nc1)}:${colIndexToLetter(nc2)}`;
	}

	// A1:B3 → cell range
	const cellRange = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(target);
	if (cellRange) {
		const c1 = colLetterToIndex(cellRange[1] ?? '');
		const r1 = parseInt(cellRange[2] ?? '0');
		const c2 = colLetterToIndex(cellRange[3] ?? '');
		const r2 = parseInt(cellRange[4] ?? '0');
		const m1 = fn(r1, c1);
		const m2 = fn(r2, c2);
		if (!m1 || !m2) return '';
		if (m1.r > m2.r || m1.c > m2.c) return '';
		return `${colIndexToLetter(m1.c)}${m1.r}:${colIndexToLetter(m2.c)}${m2.r}`;
	}

	// A1 → single cell
	const single = /^([A-Z]+)(\d+)$/.exec(target);
	if (single) {
		const c = colLetterToIndex(single[1] ?? '');
		const r = parseInt(single[2] ?? '0');
		const mapped = fn(r, c);
		if (!mapped) return '';
		return `${colIndexToLetter(mapped.c)}${mapped.r}`;
	}

	return target; // unrecognised — leave as-is
}
